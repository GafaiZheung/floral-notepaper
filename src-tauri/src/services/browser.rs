use crate::services::notes::AppError;
use serde::Serialize;
use std::{collections::HashMap, sync::Mutex};
use tauri::{
    async_runtime,
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Url, Webview,
    WebviewBuilder, WebviewUrl, Window,
};
use uuid::Uuid;

/// 浏览器 UI 与 Rust 状态之间的广播事件。
pub const BROWSER_EVENT: &str = "browser-state-changed";
/// 网页 WebView 请求 UI 聚焦地址栏时使用的定向事件。
pub const BROWSER_FOCUS_ADDRESS_EVENT: &str = "browser-focus-address";
const MAIN_WEBVIEW_LABEL: &str = "main";

const CONTENT_LABEL_PREFIX: &str = "browser-content-";
const DEFAULT_DOCK_WIDTH: f64 = 480.0;
const MIN_DOCK_WIDTH: f64 = 280.0;
const MAX_DOCK_WIDTH: f64 = 760.0;
const MAIN_MIN_WIDTH: f64 = 900.0;
const MAIN_MIN_HEIGHT: f64 = 620.0;
/// 与主窗口标题栏对齐的标签栏（44px）和导航工具栏（40px）总高度。
pub const BROWSER_CHROME_HEIGHT: f64 = 84.0;
/// 右侧为前端保留的原生窗口缩放热区。
const RESIZE_HANDLE_WIDTH: f64 = 6.0;
const CONTENT_BORDER: f64 = 1.0;
const MIN_ZOOM: f64 = 0.5;
const MAX_ZOOM: f64 = 2.0;
const WINDOW_BACKGROUND: tauri::webview::Color = tauri::webview::Color(246, 243, 236, 255);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTab {
    pub tab_id: String,
    pub url: String,
    pub title: String,
    pub zoom: f64,
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
    active: bool,
}

#[derive(Debug, Clone, Default)]
struct HistoryStack {
    entries: Vec<String>,
    cursor: usize,
}

impl HistoryStack {
    fn record(&mut self, url: &str) {
        if self
            .entries
            .get(self.cursor)
            .is_some_and(|entry| entry == url)
        {
            return;
        }
        self.entries.truncate(self.cursor.saturating_add(1));
        self.entries.push(url.to_string());
        self.cursor = self.entries.len().saturating_sub(1);
    }

    fn back(&mut self) -> Option<String> {
        if self.cursor == 0 {
            return None;
        }
        self.cursor -= 1;
        self.entries.get(self.cursor).cloned()
    }

    fn forward(&mut self) -> Option<String> {
        if self.cursor + 1 >= self.entries.len() {
            return None;
        }
        self.cursor += 1;
        self.entries.get(self.cursor).cloned()
    }

    fn can_go_back(&self) -> bool {
        self.cursor > 0
    }

    fn can_go_forward(&self) -> bool {
        self.cursor + 1 < self.entries.len()
    }
}

pub struct BrowserRegistry {
    tabs: Mutex<Vec<BrowserEntry>>,
    histories: Mutex<HashMap<String, HistoryStack>>,
    loading: Mutex<HashMap<String, bool>>,
    dock_width: Mutex<f64>,
    /// 浏览器展开前主窗口的逻辑宽度。展开期间固定，确保编辑器不被挤压。
    main_width: Mutex<Option<f64>>,
    /// 用户意图上的可见状态。主窗口临时隐藏时保持为 true，供恢复时重显。
    visible: Mutex<bool>,
}

impl Default for BrowserRegistry {
    fn default() -> Self {
        Self {
            tabs: Mutex::new(Vec::new()),
            histories: Mutex::new(HashMap::new()),
            loading: Mutex::new(HashMap::new()),
            dock_width: Mutex::new(DEFAULT_DOCK_WIDTH),
            main_width: Mutex::new(None),
            visible: Mutex::new(false),
        }
    }
}

impl BrowserRegistry {
    fn entry(&self, tab_id: &str) -> Option<BrowserEntry> {
        self.tabs
            .lock()
            .ok()
            .and_then(|tabs| tabs.iter().find(|tab| tab.tab_id == tab_id).cloned())
    }

    fn entry_by_url(&self, url: &str) -> Option<BrowserEntry> {
        self.tabs
            .lock()
            .ok()
            .and_then(|tabs| tabs.iter().find(|tab| tab.url == url).cloned())
    }

    fn entries(&self) -> Vec<BrowserEntry> {
        self.tabs
            .lock()
            .map(|tabs| tabs.clone())
            .unwrap_or_default()
    }

    fn upsert_tab(&self, mut entry: BrowserEntry, activate: bool) {
        if let Ok(mut tabs) = self.tabs.lock() {
            if activate {
                for tab in tabs.iter_mut() {
                    tab.active = false;
                }
            }
            entry.active = activate;
            match tabs.iter_mut().find(|tab| tab.tab_id == entry.tab_id) {
                Some(existing) => *existing = entry,
                None => tabs.push(entry),
            }
        }
    }

    fn set_active(&self, tab_id: &str) {
        if let Ok(mut tabs) = self.tabs.lock() {
            for tab in tabs.iter_mut() {
                tab.active = tab.tab_id == tab_id;
            }
        }
    }

    fn clear_active(&self) {
        if let Ok(mut tabs) = self.tabs.lock() {
            for tab in tabs.iter_mut() {
                tab.active = false;
            }
        }
    }

    fn active_tab_id(&self) -> Option<String> {
        self.tabs.lock().ok().and_then(|tabs| {
            tabs.iter()
                .find(|tab| tab.active)
                .map(|tab| tab.tab_id.clone())
        })
    }

    fn adjacent_tab_id(&self, current: &str, backwards: bool) -> Option<String> {
        let tabs = self.tabs.lock().ok()?;
        if tabs.is_empty() {
            return None;
        }
        let current_index = tabs
            .iter()
            .position(|tab| tab.tab_id == current)
            .unwrap_or(0);
        let next_index = if backwards {
            (current_index + tabs.len() - 1) % tabs.len()
        } else {
            (current_index + 1) % tabs.len()
        };
        tabs.get(next_index).map(|tab| tab.tab_id.clone())
    }

    fn remove_tab(&self, tab_id: &str) {
        if let Ok(mut tabs) = self.tabs.lock() {
            let was_active = tabs.iter().any(|tab| tab.tab_id == tab_id && tab.active);
            tabs.retain(|tab| tab.tab_id != tab_id);
            if was_active {
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

    fn clear_tabs(&self) {
        if let Ok(mut tabs) = self.tabs.lock() {
            tabs.clear();
        }
        if let Ok(mut histories) = self.histories.lock() {
            histories.clear();
        }
        if let Ok(mut loading) = self.loading.lock() {
            loading.clear();
        }
    }

    fn set_title(&self, tab_id: &str, title: String) {
        if let Ok(mut tabs) = self.tabs.lock() {
            if let Some(tab) = tabs.iter_mut().find(|tab| tab.tab_id == tab_id) {
                tab.title = title;
            }
        }
    }

    fn set_url(&self, tab_id: &str, url: String) {
        if let Ok(mut tabs) = self.tabs.lock() {
            if let Some(tab) = tabs.iter_mut().find(|tab| tab.tab_id == tab_id) {
                tab.url = url;
            }
        }
    }

    fn set_zoom(&self, tab_id: &str, zoom: f64) {
        if let Ok(mut tabs) = self.tabs.lock() {
            if let Some(tab) = tabs.iter_mut().find(|tab| tab.tab_id == tab_id) {
                tab.zoom = zoom;
            }
        }
    }

    fn record_navigation(&self, tab_id: &str, url: &str) {
        if let Ok(mut histories) = self.histories.lock() {
            histories.entry(tab_id.to_string()).or_default().record(url);
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

    fn history_flags(&self, tab_id: &str) -> (bool, bool) {
        self.histories
            .lock()
            .ok()
            .and_then(|histories| histories.get(tab_id).cloned())
            .map(|history| (history.can_go_back(), history.can_go_forward()))
            .unwrap_or((false, false))
    }

    fn set_loading(&self, tab_id: &str, loading: bool) {
        if let Ok(mut states) = self.loading.lock() {
            states.insert(tab_id.to_string(), loading);
        }
    }

    fn loading_of(&self, tab_id: &str) -> bool {
        self.loading
            .lock()
            .map(|states| states.get(tab_id).copied().unwrap_or(false))
            .unwrap_or(false)
    }

    fn dock_width(&self) -> f64 {
        self.dock_width
            .lock()
            .map(|width| *width)
            .unwrap_or(DEFAULT_DOCK_WIDTH)
    }

    fn set_dock_width(&self, width: f64) {
        if let Ok(mut current) = self.dock_width.lock() {
            *current = clamp_width(width);
        }
    }

    fn main_width(&self) -> Option<f64> {
        self.main_width.lock().ok().and_then(|width| *width)
    }

    fn remember_main_width(&self, width: f64) -> f64 {
        let Ok(mut current) = self.main_width.lock() else {
            return width;
        };
        *current.get_or_insert(width)
    }

    fn take_main_width(&self) -> Option<f64> {
        self.main_width
            .lock()
            .ok()
            .and_then(|mut width| width.take())
    }

    fn is_visible(&self) -> bool {
        self.visible.lock().map(|visible| *visible).unwrap_or(false)
    }

    fn set_visible(&self, visible: bool) {
        if let Ok(mut current) = self.visible.lock() {
            *current = visible;
        }
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
        .entries()
        .into_iter()
        .map(|entry| {
            let (can_go_back, can_go_forward) = registry.history_flags(&entry.tab_id);
            BrowserTab {
                tab_id: entry.tab_id.clone(),
                url: entry.url,
                title: entry.title,
                zoom: entry.zoom,
                active: entry.active,
                can_go_back,
                can_go_forward,
                loading: registry.loading_of(&entry.tab_id),
            }
        })
        .collect();

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

fn content_label(tab_id: &str) -> String {
    format!("{CONTENT_LABEL_PREFIX}{tab_id}")
}

fn content_webview(app: &AppHandle, tab_id: &str) -> Option<Webview> {
    app.get_webview(&content_label(tab_id))
}

fn clamp_zoom(zoom: f64) -> f64 {
    (zoom.clamp(MIN_ZOOM, MAX_ZOOM) * 10.0).round() / 10.0
}

fn clamp_width(width: f64) -> f64 {
    width.clamp(MIN_DOCK_WIDTH, MAX_DOCK_WIDTH)
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
            "browser content requires an http(s) URL",
        ))
    }
}

/// 计算主原生窗口中网页子 WebView 的物理坐标。标签栏与工具栏仍由
/// main WebView 绘制，网页只覆盖右侧延伸区的内容部分。
fn content_rect_for(
    window_width: u32,
    window_height: u32,
    editor_width: u32,
    scale: f64,
) -> (i32, i32, u32, u32) {
    let border = (CONTENT_BORDER * scale).round().max(1.0) as u32;
    let top = (BROWSER_CHROME_HEIGHT * scale).round().max(1.0) as u32;
    let right = (RESIZE_HANDLE_WIDTH * scale).round().max(1.0) as u32;
    let x = editor_width.saturating_add(border);
    let width = window_width.saturating_sub(x.saturating_add(right)).max(1);
    let height = window_height
        .saturating_sub(top.saturating_add(border))
        .max(1);
    (x as i32, top as i32, width, height)
}

fn fitted_extension_width(preferred: u32, main_width: u32, work_width: u32) -> u32 {
    let available = work_width.saturating_sub(main_width);
    let minimum = MIN_DOCK_WIDTH.round() as u32;
    if available >= minimum {
        preferred.min(available)
    } else {
        // 极窄屏幕上优先保留编辑器宽度，右侧延伸使用剩余可用空间。
        available.max(1)
    }
}

fn fitted_main_position(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    work_position: PhysicalPosition<i32>,
    work_size: PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    let work_left = work_position.x as i64;
    let work_top = work_position.y as i64;
    let work_right = work_left + work_size.width as i64;
    let work_bottom = work_top + work_size.height as i64;
    let max_left = work_right - size.width as i64;
    let left = if size.width <= work_size.width {
        (position.x as i64).clamp(work_left, max_left)
    } else {
        work_left
    };
    let top = if size.height as i64 >= work_size.height as i64 {
        work_top
    } else {
        (position.y as i64).clamp(work_top, work_bottom - size.height as i64)
    };

    PhysicalPosition::new(left as i32, top as i32)
}

fn shortcut_initialization_script() -> &'static str {
    r#"
      (() => {
        if (window.__FLORAL_BROWSER_SHORTCUTS__) return;
        window.__FLORAL_BROWSER_SHORTCUTS__ = true;
        window.addEventListener('keydown', (event) => {
          if (!(event.metaKey || event.ctrlKey)) return;
          let action = null;
          const key = event.key.toLowerCase();
          if (key === 'l') action = 'focus-address';
          else if (key === 'w' && !event.shiftKey) action = 'close-tab';
          else if (event.key === 'Tab') action = event.shiftKey ? 'previous-tab' : 'next-tab';
          if (!action) return;
          event.preventDefault();
          event.stopPropagation();
          // WKWebView 会在进入 navigation delegate 前拒绝未注册协议。
          // 使用不会真正访问网络的 HTTPS 哨兵域名，Rust 导航回调会立即拦截。
          window.location.href = `https://floral-shortcut.invalid/${action}`;
        }, true);
      })();
    "#
}

fn handle_shortcut_navigation(app: &AppHandle, tab_id: &str, url: &Url) -> bool {
    if url.scheme() != "https" || url.host_str() != Some("floral-shortcut.invalid") {
        return false;
    }
    let action = url.path().trim_matches('/');
    match action {
        "focus-address" => {
            if let Some(ui) = app.get_webview(MAIN_WEBVIEW_LABEL) {
                let _ = ui.set_focus();
            }
            let _ = app.emit_to(MAIN_WEBVIEW_LABEL, BROWSER_FOCUS_ADDRESS_EVENT, ());
        }
        "close-tab" => {
            let app = app.clone();
            let tab_id = tab_id.to_string();
            async_runtime::spawn(async move {
                let _ = close(app, tab_id).await;
            });
        }
        "next-tab" | "previous-tab" => {
            let backwards = action == "previous-tab";
            let next = app
                .try_state::<BrowserRegistry>()
                .and_then(|registry| registry.adjacent_tab_id(tab_id, backwards));
            if let Some(next) = next {
                let app = app.clone();
                async_runtime::spawn(async move {
                    let _ = activate(app, next).await;
                });
            }
        }
        _ => {}
    }
    true
}

fn create_content_webview(
    app: &AppHandle,
    main: &Window,
    tab_id: &str,
    url: &str,
) -> Result<Webview, AppError> {
    let parsed = Url::parse(url)
        .map_err(|_| app_error("invalid_url", "browser content requires a valid URL"))?;
    let label = content_label(tab_id);
    let navigation_app = app.clone();
    let navigation_tab = tab_id.to_string();

    let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        .background_color(WINDOW_BACKGROUND)
        .focused(false)
        .initialization_script(shortcut_initialization_script())
        .on_new_window({
            let app = app.clone();
            move |target, _features| {
                if matches!(target.scheme(), "http" | "https") {
                    let app = app.clone();
                    async_runtime::spawn(async move {
                        let _ = open(app, target.to_string()).await;
                    });
                }
                NewWindowResponse::Deny
            }
        })
        .on_document_title_changed({
            let app = app.clone();
            let tab_id = tab_id.to_string();
            move |_webview, title| {
                if let Some(registry) = app.try_state::<BrowserRegistry>() {
                    let fallback = registry
                        .entry(&tab_id)
                        .map(|entry| hostname_of(&entry.url))
                        .unwrap_or_default();
                    let title = if title.trim().is_empty() {
                        fallback
                    } else {
                        title
                    };
                    registry.set_title(&tab_id, title);
                    emit_state(&app);
                }
            }
        })
        .on_navigation(move |target| {
            if handle_shortcut_navigation(&navigation_app, &navigation_tab, target) {
                return false;
            }
            if !matches!(target.scheme(), "http" | "https") {
                return false;
            }
            if let Some(registry) = navigation_app.try_state::<BrowserRegistry>() {
                registry.record_navigation(&navigation_tab, target.as_str());
                registry.set_url(&navigation_tab, target.to_string());
                emit_state(&navigation_app);
            }
            true
        })
        .on_page_load({
            let app = app.clone();
            let tab_id = tab_id.to_string();
            move |_webview, payload| {
                if let Some(registry) = app.try_state::<BrowserRegistry>() {
                    registry
                        .set_loading(&tab_id, matches!(payload.event(), PageLoadEvent::Started));
                    emit_state(&app);
                }
            }
        });

    let registry = app
        .try_state::<BrowserRegistry>()
        .ok_or_else(|| app_error("state", "browser registry unavailable"))?;
    let size = main.inner_size()?;
    let scale = main.scale_factor().unwrap_or(1.0);
    let editor_width = (registry.main_width().unwrap_or(MAIN_MIN_WIDTH) * scale)
        .round()
        .max(1.0) as u32;
    let (x, y, width, height) = content_rect_for(size.width, size.height, editor_width, scale);
    let webview = main.add_child(
        builder,
        PhysicalPosition::new(x, y),
        PhysicalSize::new(width, height),
    )?;
    webview.hide()?;
    Ok(webview)
}

fn layout_content_webviews(app: &AppHandle) {
    let Some(main) = app.get_window(MAIN_WEBVIEW_LABEL) else {
        return;
    };
    let Some(registry) = app.try_state::<BrowserRegistry>() else {
        return;
    };
    let Some(main_width) = registry.main_width() else {
        return;
    };
    let Ok(size) = main.inner_size() else {
        return;
    };
    let scale = main.scale_factor().unwrap_or(1.0);
    let editor_width = (main_width * scale).round().max(1.0) as u32;
    let (x, y, width, height) = content_rect_for(size.width, size.height, editor_width, scale);
    let entries = registry.entries();
    for entry in entries {
        if let Some(webview) = content_webview(app, &entry.tab_id) {
            let _ = webview.set_position(PhysicalPosition::new(x, y));
            let _ = webview.set_size(PhysicalSize::new(width, height));
        }
    }
}

fn apply_extension_size(app: &AppHandle) {
    let Some(main) = app.get_window(MAIN_WEBVIEW_LABEL) else {
        return;
    };
    let Some(registry) = app.try_state::<BrowserRegistry>() else {
        return;
    };
    let Ok(size) = main.inner_size() else {
        return;
    };
    let scale = main.scale_factor().unwrap_or(1.0);
    let current_width = size.width as f64 / scale;
    let base_width = registry.remember_main_width(current_width);
    let preferred = (registry.dock_width() * scale).round().max(1.0) as u32;
    let base_physical = (base_width * scale).round().max(1.0) as u32;
    let monitor = main.current_monitor().ok().flatten();
    let dock_physical = monitor
        .as_ref()
        .map(|monitor| {
            fitted_extension_width(preferred, base_physical, monitor.work_area().size.width)
        })
        .unwrap_or(preferred);
    let dock_width = dock_physical as f64 / scale;
    registry.set_dock_width(dock_width);

    let total_width = base_width + dock_width;
    let height = size.height as f64 / scale;
    let _ = main.set_min_size(Some(LogicalSize::new(
        base_width + MIN_DOCK_WIDTH.min(dock_width),
        MAIN_MIN_HEIGHT,
    )));
    let _ = main.set_size(LogicalSize::new(total_width, height));

    if let (Ok(position), Ok(size), Some(monitor)) =
        (main.outer_position(), main.outer_size(), monitor.as_ref())
    {
        let work = monitor.work_area();
        let target = fitted_main_position(position, size, work.position, work.size);
        if target != position {
            let _ = main.set_position(target);
        }
    }
    layout_content_webviews(app);
}

/// 主窗口移动/缩放时，同步扩展宽度与同窗口网页子 WebView。
pub fn sync_dock(app: &AppHandle) {
    let Some(registry) = app.try_state::<BrowserRegistry>() else {
        return;
    };
    if !registry.is_visible() {
        hide_with_main(app);
        return;
    }
    let Some(main) = app.get_window(MAIN_WEBVIEW_LABEL) else {
        return;
    };
    if registry.main_width().is_none() {
        apply_extension_size(app);
    } else if let Ok(size) = main.inner_size() {
        let scale = main.scale_factor().unwrap_or(1.0);
        let total = size.width as f64 / scale;
        let base = registry.main_width().unwrap_or(total);
        registry.set_dock_width((total - base).max(1.0));
        layout_content_webviews(app);
    }
    sync_window_visibility(app);
    emit_state(app);
}

/// 主窗口暂时隐藏时隐藏浏览器，但不改变用户的可见意图。
pub fn hide_with_main(app: &AppHandle) {
    let entries = app
        .try_state::<BrowserRegistry>()
        .map(|registry| registry.entries())
        .unwrap_or_default();
    for entry in entries {
        if let Some(webview) = content_webview(app, &entry.tab_id) {
            let _ = webview.hide();
        }
    }
}

/// 用户主动收回浏览器：主窗口恢复原宽，标签仍保留。
pub fn hide_panel(app: &AppHandle) {
    let base_width = app.try_state::<BrowserRegistry>().and_then(|registry| {
        registry.set_visible(false);
        registry.take_main_width()
    });
    hide_with_main(app);
    if let (Some(main), Some(base_width)) = (app.get_window(MAIN_WEBVIEW_LABEL), base_width) {
        let scale = main.scale_factor().unwrap_or(1.0);
        let height = main
            .inner_size()
            .map(|size| size.height as f64 / scale)
            .unwrap_or(760.0);
        let _ = main.set_min_size(Some(LogicalSize::new(MAIN_MIN_WIDTH, MAIN_MIN_HEIGHT)));
        let _ = main.set_size(LogicalSize::new(base_width, height));
        if let (Ok(position), Ok(size), Ok(Some(monitor))) = (
            main.outer_position(),
            main.outer_size(),
            main.current_monitor(),
        ) {
            let work = monitor.work_area();
            let target = fitted_main_position(position, size, work.position, work.size);
            if target != position {
                let _ = main.set_position(target);
            }
        }
    }
    emit_state(app);
}

/// 主窗口恢复后，按用户隐藏前的状态恢复浏览器。
pub fn restore_with_main(app: &AppHandle) {
    if app
        .try_state::<BrowserRegistry>()
        .is_some_and(|registry| registry.is_visible())
    {
        sync_dock(app);
    }
}

/// 只显示活跃标签的同窗口网页子 WebView；空白页时露出 main
/// WebView 中的欢迎页。
pub fn sync_window_visibility(app: &AppHandle) {
    let entries = app
        .try_state::<BrowserRegistry>()
        .map(|registry| registry.entries())
        .unwrap_or_default();
    let can_show = app
        .try_state::<BrowserRegistry>()
        .is_some_and(|registry| registry.is_visible())
        && app.get_window(MAIN_WEBVIEW_LABEL).is_some_and(|main| {
            main.is_visible().unwrap_or(false) && !main.is_minimized().unwrap_or(false)
        })
        && entries.iter().any(|entry| entry.active);

    for entry in &entries {
        let Some(webview) = content_webview(app, &entry.tab_id) else {
            continue;
        };
        if can_show && entry.active {
            let _ = webview.show();
        } else {
            let _ = webview.hide();
        }
    }
    if can_show {
        layout_content_webviews(app);
    }
}

pub fn raise_docked_windows(app: &AppHandle) {
    sync_window_visibility(app);
}

/// 由 macOS 应用菜单接管 WebKit 会预先消耗的 Cmd+L。
/// 其他平台仍使用网页注入脚本。
fn focus_main_address_now(app: &AppHandle) {
    // Both UI and external content are WebViews in the same native window.
    // Focus the application UI WebView before selecting the address field.
    if let Some(main_window) = app.get_window(MAIN_WEBVIEW_LABEL) {
        let _ = main_window.set_focus();
    }
    if let Some(main) = app.get_webview(MAIN_WEBVIEW_LABEL) {
        let _ = main.set_focus();
        // Direct DOM focus is a fallback for WebKit builds which deliver the
        // native menu event before the frontend listener is ready to run.
        let _ = main.eval(
            "requestAnimationFrame(() => { const input = document.querySelector('[data-testid=\"browser-address\"]'); input?.focus(); input?.select(); });",
        );
    }
    let _ = app.emit_to(MAIN_WEBVIEW_LABEL, BROWSER_FOCUS_ADDRESS_EVENT, ());
}

pub fn focus_address_from_native_shortcut(app: &AppHandle) -> bool {
    let visible = app
        .try_state::<BrowserRegistry>()
        .is_some_and(|registry| registry.is_visible());
    if !visible {
        return false;
    }

    focus_main_address_now(app);
    // Cocoa dispatches menu callbacks while it is still completing menu
    // tracking, so repeat the transfer once the callback has returned.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(60));
        focus_main_address_now(&handle);
    });
    true
}

/// 关闭活跃页签；空白页会回到上一页签，无页签则收回延伸区。
pub fn close_from_native_shortcut(app: &AppHandle) -> bool {
    let Some(registry) = app.try_state::<BrowserRegistry>() else {
        return false;
    };
    if !registry.is_visible() {
        return false;
    }
    if let Some(active) = registry.active_tab_id() {
        let app = app.clone();
        async_runtime::spawn(async move {
            let _ = close(app, active).await;
        });
    } else if let Some(fallback) = registry.entries().last().map(|entry| entry.tab_id.clone()) {
        let app = app.clone();
        async_runtime::spawn(async move {
            let _ = activate(app, fallback).await;
        });
    } else {
        hide_panel(app);
    }
    true
}

pub fn cycle_from_native_shortcut(app: &AppHandle, backwards: bool) -> bool {
    let Some(registry) = app.try_state::<BrowserRegistry>() else {
        return false;
    };
    if !registry.is_visible() || registry.entries().is_empty() {
        return false;
    }
    let next = if let Some(active) = registry.active_tab_id() {
        registry.adjacent_tab_id(&active, backwards)
    } else {
        let entries = registry.entries();
        if backwards {
            entries.last().map(|entry| entry.tab_id.clone())
        } else {
            entries.first().map(|entry| entry.tab_id.clone())
        }
    };
    if let Some(next) = next {
        let app = app.clone();
        async_runtime::spawn(async move {
            let _ = activate(app, next).await;
        });
    }
    true
}

pub async fn open(app: AppHandle, url: String) -> Result<BrowserState, AppError> {
    let url = normalize_external_url(&url)?;
    let registry = app
        .try_state::<BrowserRegistry>()
        .ok_or_else(|| app_error("state", "browser registry unavailable"))?;

    if let Some(existing) = registry.entry_by_url(&url) {
        registry.set_active(&existing.tab_id);
        registry.set_visible(true);
        apply_extension_size(&app);
        sync_window_visibility(&app);
        if let Some(webview) = content_webview(&app, &existing.tab_id) {
            let _ = webview.set_focus();
        }
        emit_state(&app);
        return Ok(get_state(&app));
    }

    let tab_id = Uuid::new_v4().to_string();
    let entry = BrowserEntry {
        tab_id: tab_id.clone(),
        url: url.clone(),
        title: hostname_of(&url),
        zoom: 1.0,
        active: true,
    };
    registry.upsert_tab(entry, true);
    registry.record_navigation(&tab_id, &url);
    registry.set_visible(true);
    apply_extension_size(&app);

    let main = app
        .get_window(MAIN_WEBVIEW_LABEL)
        .ok_or_else(|| app_error("window_not_found", "main window unavailable"))?;
    if let Err(error) = create_content_webview(&app, &main, &tab_id, &url) {
        registry.remove_tab(&tab_id);
        emit_state(&app);
        return Err(error);
    }

    layout_content_webviews(&app);
    sync_window_visibility(&app);
    if let Some(webview) = content_webview(&app, &tab_id) {
        let _ = webview.set_focus();
    }
    emit_state(&app);
    Ok(get_state(&app))
}

pub async fn activate(app: AppHandle, tab_id: String) -> Result<BrowserState, AppError> {
    let registry = app
        .try_state::<BrowserRegistry>()
        .ok_or_else(|| app_error("state", "browser registry unavailable"))?;
    if registry.entry(&tab_id).is_none() || content_webview(&app, &tab_id).is_none() {
        return Err(app_error("tab_not_found", "browser tab not found"));
    }
    registry.set_active(&tab_id);
    registry.set_visible(true);
    apply_extension_size(&app);
    sync_window_visibility(&app);
    if let Some(webview) = content_webview(&app, &tab_id) {
        let _ = webview.set_focus();
    }
    emit_state(&app);
    Ok(get_state(&app))
}

/// 显示同一浏览器延伸区中的空白欢迎页，不创建无内容的网页 WebView。
pub async fn new_tab(app: AppHandle) -> Result<BrowserState, AppError> {
    let registry = app
        .try_state::<BrowserRegistry>()
        .ok_or_else(|| app_error("state", "browser registry unavailable"))?;
    registry.clear_active();
    registry.set_visible(true);
    apply_extension_size(&app);
    sync_window_visibility(&app);
    if let Some(ui) = app.get_webview(MAIN_WEBVIEW_LABEL) {
        let _ = ui.set_focus();
    }
    emit_state(&app);
    Ok(get_state(&app))
}

pub async fn close(app: AppHandle, tab_id: String) -> Result<BrowserState, AppError> {
    if let Some(registry) = app.try_state::<BrowserRegistry>() {
        registry.remove_tab(&tab_id);
    }
    if let Some(webview) = content_webview(&app, &tab_id) {
        let _ = webview.close();
    }
    sync_window_visibility(&app);
    if let Some(active) = app
        .try_state::<BrowserRegistry>()
        .and_then(|registry| registry.active_tab_id())
    {
        if let Some(webview) = content_webview(&app, &active) {
            let _ = webview.set_focus();
        }
    } else if let Some(ui) = app.get_webview(MAIN_WEBVIEW_LABEL) {
        let _ = ui.set_focus();
    }
    emit_state(&app);
    Ok(get_state(&app))
}

pub async fn close_all(app: AppHandle) -> Result<BrowserState, AppError> {
    let tab_ids = app
        .try_state::<BrowserRegistry>()
        .map(|registry| {
            let ids = registry
                .entries()
                .into_iter()
                .map(|entry| entry.tab_id)
                .collect::<Vec<_>>();
            registry.clear_tabs();
            ids
        })
        .unwrap_or_default();
    for tab_id in tab_ids {
        if let Some(webview) = content_webview(&app, &tab_id) {
            let _ = webview.close();
        }
    }
    if let Some(ui) = app.get_webview(MAIN_WEBVIEW_LABEL) {
        let _ = ui.set_focus();
    }
    emit_state(&app);
    Ok(get_state(&app))
}

pub async fn navigate(
    app: AppHandle,
    tab_id: String,
    url: String,
) -> Result<BrowserState, AppError> {
    let url = normalize_external_url(&url)?;
    let Some(webview) = content_webview(&app, &tab_id) else {
        return Err(app_error("tab_not_found", "browser tab not found"));
    };
    let parsed = Url::parse(&url)
        .map_err(|_| app_error("invalid_url", "browser content requires a valid URL"))?;
    webview.navigate(parsed)?;
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
    let Some(webview) = content_webview(&app, &tab_id) else {
        return Err(app_error("tab_not_found", "browser tab not found"));
    };
    let Some(target) = app
        .try_state::<BrowserRegistry>()
        .and_then(|registry| registry.navigation_target(&tab_id, direction))
    else {
        return Ok(get_state(&app));
    };
    let parsed = Url::parse(&target)
        .map_err(|_| app_error("invalid_url", "browser history contains an invalid URL"))?;
    webview.navigate(parsed)?;
    emit_state(&app);
    Ok(get_state(&app))
}

pub async fn reload(app: AppHandle, tab_id: String) -> Result<BrowserState, AppError> {
    let Some(webview) = content_webview(&app, &tab_id) else {
        return Err(app_error("tab_not_found", "browser tab not found"));
    };
    webview.eval("location.reload()")?;
    Ok(get_state(&app))
}

pub async fn stop(app: AppHandle, tab_id: String) -> Result<BrowserState, AppError> {
    let Some(webview) = content_webview(&app, &tab_id) else {
        return Err(app_error("tab_not_found", "browser tab not found"));
    };
    webview.eval("window.stop()")?;
    if let Some(registry) = app.try_state::<BrowserRegistry>() {
        registry.set_loading(&tab_id, false);
    }
    emit_state(&app);
    Ok(get_state(&app))
}

pub async fn set_zoom(app: AppHandle, tab_id: String, zoom: f64) -> Result<BrowserState, AppError> {
    let zoom = clamp_zoom(zoom);
    let Some(webview) = content_webview(&app, &tab_id) else {
        return Err(app_error("tab_not_found", "browser tab not found"));
    };
    #[cfg(target_os = "windows")]
    webview.set_zoom(zoom)?;
    #[cfg(not(target_os = "windows"))]
    webview.eval(format!("document.documentElement.style.zoom = '{zoom}'"))?;
    if let Some(registry) = app.try_state::<BrowserRegistry>() {
        registry.set_zoom(&tab_id, zoom);
    }
    emit_state(&app);
    Ok(get_state(&app))
}

pub async fn set_width(app: AppHandle, width: f64) -> Result<BrowserState, AppError> {
    if let Some(registry) = app.try_state::<BrowserRegistry>() {
        registry.set_dock_width(width);
    }
    apply_extension_size(&app);
    sync_window_visibility(&app);
    emit_state(&app);
    Ok(get_state(&app))
}

pub async fn set_visible(app: AppHandle, visible: bool) -> Result<BrowserState, AppError> {
    let registry = app
        .try_state::<BrowserRegistry>()
        .ok_or_else(|| app_error("state", "browser registry unavailable"))?;
    registry.set_visible(visible);
    if visible {
        apply_extension_size(&app);
        sync_window_visibility(&app);
        if let Some(active) = registry.active_tab_id() {
            if let Some(webview) = content_webview(&app, &active) {
                let _ = webview.set_focus();
            }
        } else if let Some(main) = app.get_webview(MAIN_WEBVIEW_LABEL) {
            let _ = main.set_focus();
        }
    } else {
        hide_panel(&app);
    }
    if visible {
        emit_state(&app);
    }
    Ok(get_state(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_content_rect_with_scale() {
        assert_eq!(content_rect_for(1660, 720, 1180, 1.0), (1181, 84, 473, 635));
        assert_eq!(
            content_rect_for(3320, 1440, 2360, 2.0),
            (2362, 168, 946, 1270)
        );
    }

    #[test]
    fn extension_uses_only_the_space_right_of_the_editor() {
        assert_eq!(fitted_extension_width(480, 1180, 1470), 290);
        assert_eq!(fitted_extension_width(480, 900, 1920), 480);
        assert_eq!(fitted_extension_width(760, 900, 1400), 500);
    }

    #[test]
    fn keeps_the_extended_main_window_inside_the_monitor() {
        let position = fitted_main_position(
            PhysicalPosition::new(500, -40),
            PhysicalSize::new(1400, 900),
            PhysicalPosition::new(0, 24),
            PhysicalSize::new(1470, 744),
        );
        assert_eq!(position, PhysicalPosition::new(70, 24));
    }

    #[test]
    fn clamps_width_and_zoom() {
        assert_eq!(clamp_width(100.0), MIN_DOCK_WIDTH);
        assert_eq!(clamp_width(900.0), MAX_DOCK_WIDTH);
        assert_eq!(clamp_zoom(0.44), 0.5);
        assert_eq!(clamp_zoom(1.26), 1.3);
        assert_eq!(clamp_zoom(2.4), 2.0);
    }

    #[test]
    fn history_stack_handles_boundaries_and_dedupes() {
        let mut history = HistoryStack::default();
        history.record("https://a.example");
        history.record("https://a.example");
        history.record("https://b.example");
        assert_eq!(history.entries.len(), 2);
        assert_eq!(history.back().as_deref(), Some("https://a.example"));
        assert_eq!(history.back(), None);
        assert_eq!(history.forward().as_deref(), Some("https://b.example"));
        assert_eq!(history.forward(), None);
    }

    #[test]
    fn registry_activates_removes_and_cycles_tabs() {
        let registry = BrowserRegistry::default();
        for id in ["a", "b", "c"] {
            registry.upsert_tab(
                BrowserEntry {
                    tab_id: id.into(),
                    url: format!("https://{id}.example"),
                    title: id.into(),
                    zoom: 1.0,
                    active: false,
                },
                true,
            );
        }
        assert_eq!(registry.active_tab_id().as_deref(), Some("c"));
        assert_eq!(registry.adjacent_tab_id("c", false).as_deref(), Some("a"));
        assert_eq!(registry.adjacent_tab_id("a", true).as_deref(), Some("c"));
        registry.remove_tab("c");
        assert_eq!(registry.active_tab_id().as_deref(), Some("b"));
    }

    #[test]
    fn default_state_uses_real_panel_width() {
        let registry = BrowserRegistry::default();
        assert_eq!(registry.dock_width(), DEFAULT_DOCK_WIDTH);
        assert!(!registry.is_visible());
    }

    #[test]
    fn normalizes_only_http_urls() {
        assert_eq!(
            normalize_external_url(" https://example.com ").unwrap(),
            "https://example.com"
        );
        assert!(normalize_external_url("file:///tmp/a").is_err());
    }
}
