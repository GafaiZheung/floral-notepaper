use crate::{
    desktop::{apply_macos_window_behavior, set_webview_memory_usage_level},
    services::notes::AppError,
};
use serde::Serialize;
use std::{collections::HashMap, sync::Mutex};
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Url, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};
use uuid::Uuid;

/// 事件名：任何浏览器状态变更后统一 emit 完整 BrowserState，前端以其为唯一数据源。
pub const BROWSER_EVENT: &str = "browser-state-changed";

/// 主窗口标题栏高度（逻辑像素）。与前端 h-11 标题栏（44px）对齐，子窗口顶部贴在此线之下。
const TITLEBAR_HEIGHT: f64 = 44.0;

/// 浏览列默认宽度（逻辑像素）。
const DEFAULT_DOCK_WIDTH: f64 = 420.0;

/// 浏览列最小宽度（逻辑像素）。
const MIN_DOCK_WIDTH: f64 = 300.0;

/// 主窗口宽度比例上限（浏览列最大宽度 = 主窗口内宽 × 该比例）。
const MAX_DOCK_WIDTH_RATIO: f64 = 0.6;

/// 浮窗默认尺寸（逻辑像素）。
const FLOAT_WIDTH: f64 = 360.0;
const FLOAT_HEIGHT: f64 = 520.0;

/// 字号缩放范围与步进。
const MIN_ZOOM: f64 = 0.5;
const MAX_ZOOM: f64 = 2.0;
const ZOOM_STEP: f64 = 0.1;

/// 子窗口背景色（浅色纸色，创建时固定）。
const WINDOW_BACKGROUND: tauri::webview::Color = tauri::webview::Color(246, 243, 236, 255);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTab {
    pub tab_id: String,
    pub url: String,
    pub title: String,
    pub zoom: f64,
    pub floating: bool,
    pub active: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub loading: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserState {
    pub tabs: Vec<BrowserTab>,
    pub active_tab_id: Option<String>,
    pub dock_width: f64,
    pub visible: bool,
}

#[derive(Debug, Clone, PartialEq)]
struct BrowserEntry {
    tab_id: String,
    url: String,
    title: String,
    zoom: f64,
    floating: bool,
    active: bool,
}

/// 单标签 URL 历史栈：entries[cursor] 为当前页。
#[derive(Debug, Clone, Default)]
struct HistoryStack {
    entries: Vec<String>,
    cursor: usize,
}

impl HistoryStack {
    fn record(&mut self, url: &str) {
        if self.entries.get(self.cursor).is_some_and(|e| e == url) {
            return;
        }
        self.entries.truncate(self.cursor + 1);
        self.entries.push(url.to_string());
        self.cursor = self.entries.len() - 1;
    }

    fn back(&mut self) -> Option<String> {
        if self.cursor == 0 {
            return None;
        }
        self.cursor -= 1;
        Some(self.entries[self.cursor].clone())
    }

    fn forward(&mut self) -> Option<String> {
        if self.cursor + 1 >= self.entries.len() {
            return None;
        }
        self.cursor += 1;
        Some(self.entries[self.cursor].clone())
    }

    fn can_go_back(&self) -> bool {
        self.cursor > 0
    }

    fn can_go_forward(&self) -> bool {
        self.cursor + 1 < self.entries.len()
    }
}

#[derive(Default)]
pub struct BrowserRegistry {
    tabs: Mutex<Vec<BrowserEntry>>,
    histories: Mutex<HashMap<String, HistoryStack>>,
    loading: Mutex<HashMap<String, bool>>,
    dock_width: Mutex<f64>,
    visible: Mutex<bool>,
}

impl BrowserRegistry {
    fn entry(&self, tab_id: &str) -> Option<BrowserEntry> {
        self.tabs
            .lock()
            .ok()
            .and_then(|tabs| tabs.iter().find(|t| t.tab_id == tab_id).cloned())
    }

    fn set_title(&self, tab_id: &str, title: String) {
        if let Ok(mut tabs) = self.tabs.lock() {
            if let Some(entry) = tabs.iter_mut().find(|t| t.tab_id == tab_id) {
                entry.title = title;
            }
        }
    }

    fn set_url(&self, tab_id: &str, url: String) {
        if let Ok(mut tabs) = self.tabs.lock() {
            if let Some(entry) = tabs.iter_mut().find(|t| t.tab_id == tab_id) {
                entry.url = url;
            }
        }
    }

    fn set_zoom(&self, tab_id: &str, zoom: f64) {
        if let Ok(mut tabs) = self.tabs.lock() {
            if let Some(entry) = tabs.iter_mut().find(|t| t.tab_id == tab_id) {
                entry.zoom = zoom;
            }
        }
    }

    fn set_floating(&self, tab_id: &str, floating: bool) {
        if let Ok(mut tabs) = self.tabs.lock() {
            if let Some(entry) = tabs.iter_mut().find(|t| t.tab_id == tab_id) {
                entry.floating = floating;
            }
        }
    }

    fn record_navigation(&self, tab_id: &str, url: &str) {
        if let Ok(mut histories) = self.histories.lock() {
            let history = histories.entry(tab_id.to_string()).or_default();
            history.record(url);
        }
    }

    fn navigation_target(&self, tab_id: &str, direction: NavigationDirection) -> Option<String> {
        self.histories.lock().ok().and_then(|mut histories| {
            let history = histories.entry(tab_id.to_string()).or_default();
            match direction {
                NavigationDirection::Back => history.back(),
                NavigationDirection::Forward => history.forward(),
            }
        })
    }

    fn set_loading(&self, tab_id: &str, loading: bool) {
        if let Ok(mut map) = self.loading.lock() {
            map.insert(tab_id.to_string(), loading);
        }
    }

    fn upsert_tab(&self, mut entry: BrowserEntry, activate: bool) {
        if let Ok(mut tabs) = self.tabs.lock() {
            if activate {
                for tab in tabs.iter_mut() {
                    tab.active = false;
                }
            }
            entry.active = activate;
            match tabs.iter_mut().find(|t| t.tab_id == entry.tab_id) {
                Some(existing) => *existing = entry,
                None => tabs.push(entry),
            }
        }
    }

    fn remove_tab(&self, tab_id: &str) {
        if let Ok(mut tabs) = self.tabs.lock() {
            tabs.retain(|t| t.tab_id != tab_id);
            // 被移除的是活跃标签时，自动激活剩余最后一个标签
            if !tabs.iter().any(|t| t.active) {
                if let Some(last) = tabs.last_mut() {
                    last.active = true;
                }
            }
        }
        if let Ok(mut histories) = self.histories.lock() {
            histories.remove(tab_id);
        }
        if let Ok(mut loading) = self.loading.lock() {
            loading.remove(tab_id);
        }
    }

    fn set_active(&self, tab_id: &str) {
        if let Ok(mut tabs) = self.tabs.lock() {
            for tab in tabs.iter_mut() {
                tab.active = tab.tab_id == tab_id;
            }
        }
    }

    fn active_tab_id(&self) -> Option<String> {
        self.tabs
            .lock()
            .ok()
            .and_then(|tabs| tabs.iter().find(|t| t.active).map(|t| t.tab_id.clone()))
    }

    fn dock_width(&self) -> f64 {
        self.dock_width
            .lock()
            .map(|w| *w)
            .unwrap_or(DEFAULT_DOCK_WIDTH)
    }

    fn set_dock_width(&self, width: f64) {
        if let Ok(mut guard) = self.dock_width.lock() {
            *guard = width.max(MIN_DOCK_WIDTH);
        }
    }

    fn is_visible(&self) -> bool {
        self.visible.lock().map(|v| *v).unwrap_or(false)
    }

    fn set_visible(&self, visible: bool) {
        if let Ok(mut guard) = self.visible.lock() {
            *guard = visible;
        }
    }

    fn loading_of(&self, tab_id: &str) -> bool {
        self.loading
            .lock()
            .map(|map| map.get(tab_id).copied().unwrap_or(false))
            .unwrap_or(false)
    }
}

#[derive(Debug, Clone, Copy)]
enum NavigationDirection {
    Back,
    Forward,
}

pub fn get_state(app: &AppHandle) -> BrowserState {
    let Some(registry) = app.try_state::<BrowserRegistry>() else {
        return empty_state();
    };

    let tabs = registry
        .tabs
        .lock()
        .map(|tabs| {
            tabs.iter()
                .map(|entry| {
                    let (can_go_back, can_go_forward) = registry
                        .histories
                        .lock()
                        .map(|histories| {
                            let history = histories.get(&entry.tab_id).cloned().unwrap_or_default();
                            (history.can_go_back(), history.can_go_forward())
                        })
                        .unwrap_or((false, false));

                    BrowserTab {
                        tab_id: entry.tab_id.clone(),
                        url: entry.url.clone(),
                        title: entry.title.clone(),
                        zoom: entry.zoom,
                        floating: entry.floating,
                        active: entry.active,
                        can_go_back,
                        can_go_forward,
                        loading: registry.loading_of(&entry.tab_id),
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    BrowserState {
        tabs,
        active_tab_id: registry.active_tab_id(),
        dock_width: registry.dock_width(),
        visible: registry.is_visible(),
    }
}

fn empty_state() -> BrowserState {
    BrowserState {
        tabs: Vec::new(),
        active_tab_id: None,
        dock_width: DEFAULT_DOCK_WIDTH,
        visible: false,
    }
}

fn emit_state(app: &AppHandle) {
    let _ = app.emit(BROWSER_EVENT, get_state(app));
}

fn app_error(code: &str, message: impl Into<String>) -> AppError {
    AppError::new(code, message)
}

fn tab_window(app: &AppHandle, tab_id: &str) -> Option<WebviewWindow> {
    app.get_webview_window(&browser_window_label(tab_id))
}

fn browser_window_label(tab_id: &str) -> String {
    format!("browser-{tab_id}")
}

pub fn tab_id_from_label(label: &str) -> Option<&str> {
    label.strip_prefix("browser-")
}

fn clamp_zoom(zoom: f64) -> f64 {
    (zoom.clamp(MIN_ZOOM, MAX_ZOOM) * 10.0).round() / 10.0
}

fn hostname_of(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(String::from))
        .unwrap_or_else(|| url.to_string())
}

fn normalize_external_url(url: &str) -> Result<String, AppError> {
    let trimmed = url.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        Ok(trimmed.to_string())
    } else {
        Err(app_error(
            "invalid_url",
            "browser window requires an http(s) URL",
        ))
    }
}

/// 停靠矩形（物理像素）。子窗口贴主窗口右缘，顶部对齐主窗口标题栏下沿。
fn dock_rect_for(
    main_x: i32,
    main_y: i32,
    main_width: u32,
    main_height: u32,
    scale: f64,
    dock_width: f64,
) -> (i32, i32, u32, u32) {
    let titlebar_px = (TITLEBAR_HEIGHT * scale).round() as u32;
    let width = (dock_width * scale).round().max(1.0) as u32;
    let height = main_height.saturating_sub(titlebar_px).max(1);
    (
        main_x + main_width as i32,
        main_y + titlebar_px as i32,
        width,
        height,
    )
}

/// 按活跃标签同步窗口显示：停靠窗口只显示活跃标签（重叠不可见），
/// 非活跃停靠窗口隐藏并降内存（Windows）；浮窗标签始终可见。
pub fn sync_window_visibility(app: &AppHandle) {
    let Some(registry) = app.try_state::<BrowserRegistry>() else {
        return;
    };
    let tabs = registry
        .tabs
        .lock()
        .map(|tabs| tabs.clone())
        .unwrap_or_default();
    for entry in &tabs {
        let Some(window) = tab_window(app, &entry.tab_id) else {
            continue;
        };
        if entry.floating || entry.active {
            set_webview_memory_usage_level(&window, false);
            let _ = window.show();
        } else {
            let _ = window.hide();
            set_webview_memory_usage_level(&window, true);
        }
    }
}

/// 把可见停靠子窗口同步到主窗口右缘。浮窗标签跳过。
pub fn sync_dock(app: &AppHandle) {
    let Some(registry) = app.try_state::<BrowserRegistry>() else {
        return;
    };
    if !registry.is_visible() {
        return;
    }
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Ok(position) = main.outer_position() else {
        return;
    };
    let Ok(size) = main.inner_size() else {
        return;
    };
    let scale = main.scale_factor().unwrap_or(1.0);
    let dock_width = registry.dock_width();

    let tabs = registry
        .tabs
        .lock()
        .map(|tabs| tabs.clone())
        .unwrap_or_default();
    for entry in &tabs {
        if entry.floating {
            continue;
        }
        let Some(window) = tab_window(app, &entry.tab_id) else {
            continue;
        };
        let (x, y, width, height) = dock_rect_for(
            position.x,
            position.y,
            size.width,
            size.height,
            scale,
            dock_width,
        );
        let _ = window.set_position(PhysicalPosition::new(x, y));
        let _ = window.set_size(PhysicalSize::new(width, height));
    }
}

/// 打开一个 URL：新标签或激活同 URL 的活跃标签；自动展开浏览区并停靠。
pub async fn open(app: AppHandle, url: String) -> Result<BrowserState, AppError> {
    let url = normalize_external_url(&url)?;

    let registry = app
        .try_state::<BrowserRegistry>()
        .ok_or_else(|| app_error("state", "browser registry unavailable"))?;

    if let Some(active) = registry.active_tab_id() {
        if let Some(entry) = registry.entry(&active) {
            if entry.url == url && !entry.floating {
                registry.set_visible(true);
                registry.set_active(&active);
                sync_window_visibility(&app);
                sync_dock(&app);
                if let Some(window) = tab_window(&app, &active) {
                    let _ = window.set_focus();
                }
                emit_state(&app);
                return Ok(get_state(&app));
            }
        }
    }

    let tab_id = Uuid::new_v4().to_string();
    let label = browser_window_label(&tab_id);
    let title = hostname_of(&url);

    registry.upsert_tab(
        BrowserEntry {
            tab_id: tab_id.clone(),
            url: url.clone(),
            title: title.clone(),
            zoom: 1.0,
            floating: false,
            active: false,
        },
        true,
    );
    registry.record_navigation(&tab_id, &url);
    registry.set_visible(true);

    let parsed_url = Url::parse(&url)
        .map_err(|_| app_error("invalid_url", "browser window requires a valid URL"))?;

    let handler_app = app.clone();
    let handler_tab = tab_id.clone();
    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed_url))
        .title(&title)
        .inner_size(DEFAULT_DOCK_WIDTH, 600.0)
        .resizable(false)
        .decorations(false)
        .shadow(false)
        .transparent(false)
        .always_on_top(false)
        .skip_taskbar(true)
        .visible(false)
        .background_color(WINDOW_BACKGROUND)
        .on_new_window(move |target, _features| {
            // 拦截 window.open / target="_blank"：Deny 后同窗导航。
            if let Ok(target) = Url::parse(target.as_str()) {
                if let Some(window) =
                    handler_app.get_webview_window(&browser_window_label(&handler_tab))
                {
                    let _ = window.navigate(target);
                }
            }
            NewWindowResponse::Deny
        })
        .on_document_title_changed({
            let handler_app = app.clone();
            let handler_tab = tab_id.clone();
            move |window, title| {
                let fallback = handler_app
                    .try_state::<BrowserRegistry>()
                    .and_then(|registry| registry.entry(&handler_tab))
                    .map(|entry| hostname_of(&entry.url))
                    .unwrap_or_default();
                let effective = if title.trim().is_empty() {
                    fallback
                } else {
                    title
                };
                if let Some(registry) = handler_app.try_state::<BrowserRegistry>() {
                    registry.set_title(&handler_tab, effective.clone());
                }
                let _ = window.set_title(&effective);
                emit_state(&handler_app);
            }
        })
        .on_navigation({
            let handler_app = app.clone();
            let handler_tab = tab_id.clone();
            move |navigation_url| {
                if let Some(registry) = handler_app.try_state::<BrowserRegistry>() {
                    registry.record_navigation(&handler_tab, navigation_url.as_str());
                    registry.set_url(&handler_tab, navigation_url.to_string());
                }
                emit_state(&handler_app);
                true
            }
        })
        .on_page_load({
            let handler_app = app.clone();
            let handler_tab = tab_id.clone();
            move |_window, payload| {
                let loading = matches!(payload.event(), PageLoadEvent::Started);
                if let Some(registry) = handler_app.try_state::<BrowserRegistry>() {
                    registry.set_loading(&handler_tab, loading);
                }
                emit_state(&handler_app);
            }
        });

    let window = builder.build()?;

    apply_macos_window_behavior(&window, true);

    sync_dock(&app);
    sync_window_visibility(&app);
    let _ = window.set_focus();
    emit_state(&app);
    Ok(get_state(&app))
}

pub async fn activate(app: AppHandle, tab_id: String) -> Result<BrowserState, AppError> {
    let registry = app
        .try_state::<BrowserRegistry>()
        .ok_or_else(|| app_error("state", "browser registry unavailable"))?;
    let Some(window) = tab_window(&app, &tab_id) else {
        return Err(app_error("tab_not_found", "browser tab not found"));
    };
    registry.set_active(&tab_id);
    registry.set_visible(true);
    sync_dock(&app);
    sync_window_visibility(&app);
    let _ = window.set_focus();
    emit_state(&app);
    Ok(get_state(&app))
}

pub async fn close(app: AppHandle, tab_id: String) -> Result<BrowserState, AppError> {
    if let Some(window) = tab_window(&app, &tab_id) {
        let _ = window.close();
    }
    // 窗口 Destroyed 事件里会移除注册表并 emit；此处兜底（窗口可能已不存在）。
    if app
        .try_state::<BrowserRegistry>()
        .is_some_and(|r| r.entry(&tab_id).is_some())
    {
        if let Some(registry) = app.try_state::<BrowserRegistry>() {
            registry.remove_tab(&tab_id);
        }
        sync_window_visibility(&app);
        emit_state(&app);
    }
    Ok(get_state(&app))
}

/// 标签窗口被销毁（关闭/应用退出）时调用：移除注册表并通知前端。
pub fn handle_window_destroyed(app: &AppHandle, label: &str) {
    if let Some(tab_id) = tab_id_from_label(label) {
        if let Some(registry) = app.try_state::<BrowserRegistry>() {
            registry.remove_tab(tab_id);
        }
        sync_window_visibility(app);
        emit_state(app);
    }
}

pub async fn navigate(
    app: AppHandle,
    tab_id: String,
    url: String,
) -> Result<BrowserState, AppError> {
    let url = normalize_external_url(&url)?;
    let Some(window) = tab_window(&app, &tab_id) else {
        return Err(app_error("tab_not_found", "browser tab not found"));
    };
    let parsed = Url::parse(&url)
        .map_err(|_| app_error("invalid_url", "browser window requires a valid URL"))?;
    window.navigate(parsed)?;
    emit_state(&app);
    Ok(get_state(&app))
}

pub async fn back(app: AppHandle, tab_id: String) -> Result<BrowserState, AppError> {
    navigate_from_history(app, tab_id, NavigationDirection::Back).await
}

pub async fn forward(app: AppHandle, tab_id: String) -> Result<BrowserState, AppError> {
    navigate_from_history(app, tab_id, NavigationDirection::Forward).await
}

async fn navigate_from_history(
    app: AppHandle,
    tab_id: String,
    direction: NavigationDirection,
) -> Result<BrowserState, AppError> {
    let Some(window) = tab_window(&app, &tab_id) else {
        return Err(app_error("tab_not_found", "browser tab not found"));
    };
    let Some(target) = app
        .try_state::<BrowserRegistry>()
        .and_then(|r| r.navigation_target(&tab_id, direction))
    else {
        return Ok(get_state(&app));
    };
    let parsed = Url::parse(&target)
        .map_err(|_| app_error("invalid_url", "browser history contains an invalid URL"))?;
    window.navigate(parsed)?;
    emit_state(&app);
    Ok(get_state(&app))
}

pub async fn reload(app: AppHandle, tab_id: String) -> Result<BrowserState, AppError> {
    let Some(window) = tab_window(&app, &tab_id) else {
        return Err(app_error("tab_not_found", "browser tab not found"));
    };
    let _ = window.eval("location.reload()");
    emit_state(&app);
    Ok(get_state(&app))
}

pub async fn stop(app: AppHandle, tab_id: String) -> Result<BrowserState, AppError> {
    let Some(window) = tab_window(&app, &tab_id) else {
        return Err(app_error("tab_not_found", "browser tab not found"));
    };
    let _ = window.eval("window.stop()");
    if let Some(registry) = app.try_state::<BrowserRegistry>() {
        registry.set_loading(&tab_id, false);
    }
    emit_state(&app);
    Ok(get_state(&app))
}

pub async fn set_zoom(app: AppHandle, tab_id: String, zoom: f64) -> Result<BrowserState, AppError> {
    let zoom = clamp_zoom(zoom);
    let Some(window) = tab_window(&app, &tab_id) else {
        return Err(app_error("tab_not_found", "browser tab not found"));
    };
    #[cfg(target_os = "windows")]
    {
        window.set_zoom(zoom)?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        window.eval(&format!("document.documentElement.style.zoom = '{zoom}'"))?;
    }
    if let Some(registry) = app.try_state::<BrowserRegistry>() {
        registry.set_zoom(&tab_id, zoom);
    }
    emit_state(&app);
    Ok(get_state(&app))
}

pub async fn toggle_float(app: AppHandle, tab_id: String) -> Result<BrowserState, AppError> {
    let registry = app
        .try_state::<BrowserRegistry>()
        .ok_or_else(|| app_error("state", "browser registry unavailable"))?;
    let Some(window) = tab_window(&app, &tab_id) else {
        return Err(app_error("tab_not_found", "browser tab not found"));
    };
    let floating = registry.entry(&tab_id).map(|e| e.floating).unwrap_or(false);

    if floating {
        registry.set_floating(&tab_id, false);
        window.set_always_on_top(false)?;
        window.set_decorations(false)?;
        window.set_resizable(false)?;
        window.set_skip_taskbar(true)?;
        sync_dock(&app);
        sync_window_visibility(&app);
        let _ = window.set_focus();
    } else {
        registry.set_floating(&tab_id, true);
        window.set_decorations(true)?;
        window.set_always_on_top(true)?;
        window.set_resizable(true)?;
        window.set_skip_taskbar(false)?;
        window.set_size(LogicalSize::new(FLOAT_WIDTH, FLOAT_HEIGHT))?;
        set_webview_memory_usage_level(&window, false);
        let _ = window.show();
        let _ = window.set_focus();
    }

    emit_state(&app);
    Ok(get_state(&app))
}

pub async fn set_width(app: AppHandle, width: f64) -> Result<BrowserState, AppError> {
    let registry = app
        .try_state::<BrowserRegistry>()
        .ok_or_else(|| app_error("state", "browser registry unavailable"))?;

    let clamped = if let Some(main) = app.get_webview_window("main") {
        let inner = main
            .inner_size()
            .map_err(|e| app_error("io", e.to_string()))?;
        let scale = main.scale_factor().unwrap_or(1.0);
        let max_logical = inner.width as f64 / scale * MAX_DOCK_WIDTH_RATIO;
        width.clamp(MIN_DOCK_WIDTH, max_logical.max(MIN_DOCK_WIDTH))
    } else {
        width.max(MIN_DOCK_WIDTH)
    };

    registry.set_dock_width(clamped);
    sync_dock(&app);
    emit_state(&app);
    Ok(get_state(&app))
}

pub async fn set_visible(app: AppHandle, visible: bool) -> Result<BrowserState, AppError> {
    let registry = app
        .try_state::<BrowserRegistry>()
        .ok_or_else(|| app_error("state", "browser registry unavailable"))?;

    registry.set_visible(visible);

    if visible {
        sync_dock(&app);
        sync_window_visibility(&app);
        if let Some(active) = registry.active_tab_id() {
            if let Some(window) = tab_window(&app, &active) {
                let _ = window.set_focus();
            }
        }
    } else {
        let tabs = registry
            .tabs
            .lock()
            .map(|tabs| tabs.clone())
            .unwrap_or_default();
        for entry in &tabs {
            let Some(window) = tab_window(&app, &entry.tab_id) else {
                continue;
            };
            let _ = window.hide();
            set_webview_memory_usage_level(&window, true);
        }
    }

    emit_state(&app);
    Ok(get_state(&app))
}

/// 主窗口获得焦点时提升停靠子窗口层级（Windows；其余平台依赖同应用窗口层级）。
#[cfg(target_os = "windows")]
pub fn raise_docked_windows(app: &AppHandle) {
    if let Some(registry) = app.try_state::<BrowserRegistry>() {
        if !registry.is_visible() {
            return;
        }
        let tabs = registry
            .tabs
            .lock()
            .map(|tabs| tabs.clone())
            .unwrap_or_default();
        for entry in &tabs {
            if entry.floating {
                continue;
            }
            if let Some(window) = tab_window(app, &entry.tab_id) {
                let _ = window.show();
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn raise_docked_windows(_app: &AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_dock_rect_with_scale() {
        // 无缩放：1.0
        assert_eq!(
            dock_rect_for(100, 200, 1000, 700, 1.0, 420.0),
            (1100, 244, 420, 656)
        );
        // 150% 缩放：物理像素换算
        assert_eq!(
            dock_rect_for(100, 200, 1500, 1050, 1.5, 420.0),
            (1600, 266, 630, 984)
        );
        // 窗口高度不足以容纳标题栏时保底 1px
        assert_eq!(dock_rect_for(0, 0, 800, 30, 1.0, 420.0), (800, 44, 420, 1));
    }

    #[test]
    fn history_stack_handles_back_forward_boundaries() {
        let mut history = HistoryStack::default();
        history.record("https://a.example");
        history.record("https://b.example");
        history.record("https://c.example");

        assert!(!history.can_go_forward());
        assert!(history.can_go_back());
        assert_eq!(history.back(), Some("https://b.example".to_string()));
        assert_eq!(history.back(), Some("https://a.example".to_string()));
        assert_eq!(history.back(), None);
        assert_eq!(history.forward(), Some("https://b.example".to_string()));
        assert_eq!(history.forward(), Some("https://c.example".to_string()));
        assert_eq!(history.forward(), None);
    }

    #[test]
    fn history_stack_dedupes_consecutive_and_back_navigations() {
        let mut history = HistoryStack::default();
        history.record("https://a.example");
        history.record("https://b.example");
        // 连续相同 URL 不重复入栈
        history.record("https://b.example");
        assert_eq!(history.entries.len(), 2);

        // 后退后再 record 当前页，不应重复入栈
        let _ = history.back();
        history.record("https://a.example");
        assert_eq!(history.entries.len(), 2);
        assert_eq!(history.cursor, 0);

        // 后退后发起新导航，截断前进分支
        history.record("https://d.example");
        assert_eq!(
            history.entries,
            vec![
                "https://a.example".to_string(),
                "https://d.example".to_string(),
            ]
        );
        assert_eq!(history.cursor, 1);
    }

    #[test]
    fn clamps_zoom_to_range_and_step() {
        assert_eq!(clamp_zoom(0.1), 0.5);
        assert_eq!(clamp_zoom(3.0), 2.0);
        assert_eq!(clamp_zoom(1.04), 1.0);
        assert_eq!(clamp_zoom(1.06), 1.1);
        assert_eq!(clamp_zoom(1.0), 1.0);
    }

    #[test]
    fn derives_tab_id_from_window_label() {
        assert_eq!(tab_id_from_label("browser-abc-123"), Some("abc-123"));
        assert_eq!(tab_id_from_label("browser-"), Some(""));
        assert_eq!(tab_id_from_label("main"), None);
        assert_eq!(browser_window_label("abc"), "browser-abc");
    }

    #[test]
    fn registry_upserts_activates_and_removes_tabs() {
        let registry = BrowserRegistry::default();
        registry.upsert_tab(
            BrowserEntry {
                tab_id: "t1".into(),
                url: "https://a.example".into(),
                title: "A".into(),
                zoom: 1.0,
                floating: false,
                active: false,
            },
            true,
        );
        registry.upsert_tab(
            BrowserEntry {
                tab_id: "t2".into(),
                url: "https://b.example".into(),
                title: "B".into(),
                zoom: 1.0,
                floating: false,
                active: false,
            },
            true,
        );

        assert_eq!(registry.active_tab_id(), Some("t2".to_string()));
        assert!(registry.entry("t2").is_some());

        registry.set_active("t1");
        assert_eq!(registry.active_tab_id(), Some("t1".to_string()));
        // 激活时其余标签应取消 active
        assert!(registry.entry("t1").is_some_and(|e| e.active));

        registry.remove_tab("t1");
        assert!(registry.entry("t1").is_none());
        assert_eq!(registry.active_tab_id(), Some("t2".to_string()));

        // 浮窗与宽度/可见性
        registry.set_floating("t2", true);
        assert!(registry.entry("t2").is_some_and(|e| e.floating));
        registry.set_dock_width(500.0);
        assert_eq!(registry.dock_width(), 500.0);
        registry.set_visible(true);
        assert!(registry.is_visible());
    }

    #[test]
    fn normalizes_external_urls() {
        assert_eq!(
            normalize_external_url("https://example.com").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            normalize_external_url("  http://example.com/path  ").unwrap(),
            "http://example.com/path"
        );
        assert!(normalize_external_url("ftp://example.com").is_err());
        assert!(normalize_external_url("not a url").is_err());
    }

    #[test]
    fn extracts_hostname_for_titles() {
        assert_eq!(hostname_of("https://example.com/path?q=1"), "example.com");
        // IDN 域名返回 punycode
        assert_eq!(
            hostname_of("https://子.例子.测试"),
            "xn--i8s.xn--fsqu00a.xn--0zwm56d"
        );
        assert_eq!(hostname_of("not-a-url"), "not-a-url");
    }
}
