use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Webview, WebviewBuilder, WebviewUrl,
};
use url::Url;

const BROWSER_WEBVIEW_LABEL: &str = "browser-panel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Pixel-accurate bounds for the child webview (relative to parent window content area).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Payload emitted to the frontend on every allowed navigation event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserNavigatedPayload {
    pub url: String,
}

/// Thread-safe storage for the last-known webview bounds so we can re-apply
/// after navigation (which may reset the child webview's geometry).
static LAST_BOUNDS: Mutex<Option<BrowserWebviewBounds>> = Mutex::new(None);

fn store_bounds(bounds: BrowserWebviewBounds) {
    if let Ok(mut guard) = LAST_BOUNDS.lock() {
        *guard = Some(bounds);
    }
}

fn stored_bounds() -> Option<BrowserWebviewBounds> {
    LAST_BOUNDS.lock().ok().and_then(|g| g.clone())
}

/// Re-apply stored bounds to the child webview. Called after navigation.
fn reapply_bounds_if_stored(window: &tauri::Window) {
    if let Some(bounds) = stored_bounds() {
        if let Some(webview) = window
            .webviews()
            .into_iter()
            .find(|w| w.label() == BROWSER_WEBVIEW_LABEL)
        {
            let _ = webview.set_position(LogicalPosition::new(bounds.x, bounds.y));
            let _ = webview.set_size(LogicalSize::new(bounds.width, bounds.height));
        }
    }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/// Validate that a URL uses an allowed scheme (http / https / about:blank).
fn validate_url(raw: &str) -> Result<Url, String> {
    let parsed = Url::parse(raw).map_err(|e| format!("invalid URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        "about" if parsed.as_str() == "about:blank" => Ok(parsed),
        other => Err(format!("unsupported URL scheme: {other}")),
    }
}

/// Resolve the main `Window` (needed because `add_child` is on `Window`, not `WebviewWindow`).
fn main_window_win(app: &AppHandle) -> Result<tauri::Window, String> {
    app.get_window("main")
        .ok_or_else(|| "main window not found".to_string())
}

/// Find the browser child webview inside the main window, if it exists.
fn find_browser_webview(window: &tauri::Window) -> Option<Webview> {
    window
        .webviews()
        .into_iter()
        .find(|w| w.label() == BROWSER_WEBVIEW_LABEL)
}

/// Resolve the browser child webview, or return an error.
fn require_browser_webview(window: &tauri::Window) -> Result<Webview, String> {
    find_browser_webview(window).ok_or_else(|| "browser webview not found".to_string())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Create (or recreate) the browser child webview inside the main window.
#[tauri::command]
pub fn create_browser_webview(
    app: AppHandle,
    url: String,
    bounds: BrowserWebviewBounds,
) -> Result<(), String> {
    let window = main_window_win(&app)?;

    // Destroy any existing browser webview first.
    if let Some(existing) = find_browser_webview(&window) {
        let _ = existing.close();
        // Brief pause so the native view can tear down.
        std::thread::sleep(std::time::Duration::from_millis(16));
    }

    let parsed = validate_url(&url)?;

    // Build the child webview with navigation interception for security.
    let app_for_nav = app.clone();
    let webview_builder = WebviewBuilder::new(BROWSER_WEBVIEW_LABEL, WebviewUrl::External(parsed))
        .on_navigation(move |navigated_url| {
            let allowed = matches!(navigated_url.scheme(), "http" | "https");
            if allowed {
                let _ = app_for_nav.emit(
                    "browser-navigated",
                    BrowserNavigatedPayload {
                        url: navigated_url.to_string(),
                    },
                );
            }
            allowed
        });

    window
        .add_child(
            webview_builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|e| e.to_string())?;

    store_bounds(bounds);

    Ok(())
}

/// Update the position and size of the browser child webview.
#[tauri::command]
pub fn update_browser_webview_bounds(
    app: AppHandle,
    bounds: BrowserWebviewBounds,
) -> Result<(), String> {
    let window = main_window_win(&app)?;
    let webview = require_browser_webview(&window)?;

    webview
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| e.to_string())?;
    webview
        .set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|e| e.to_string())?;

    store_bounds(bounds);

    Ok(())
}

/// Navigate the browser child webview to a new URL.
#[tauri::command]
pub fn navigate_browser_webview(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = validate_url(&url)?;

    let window = main_window_win(&app)?;
    let webview = require_browser_webview(&window)?;

    webview.navigate(parsed).map_err(|e| e.to_string())?;

    // Re-apply bounds after navigation — the child webview may reset its geometry.
    let window_clone = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(80));
        reapply_bounds_if_stored(&window_clone);
        std::thread::sleep(std::time::Duration::from_millis(400));
        reapply_bounds_if_stored(&window_clone);
    });

    Ok(())
}

/// Destroy the browser child webview.
#[tauri::command]
pub fn destroy_browser_webview(app: AppHandle) -> Result<(), String> {
    let window = main_window_win(&app)?;
    if let Some(webview) = find_browser_webview(&window) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Move the browser webview offscreen (hide) or restore to last bounds (show).
///
/// Used as a z-order workaround: native child webviews always paint on top of
/// the web content, so context-menus / dropdowns need the webview hidden.
#[tauri::command]
pub fn set_browser_webview_visible(
    app: AppHandle,
    visible: bool,
    last_bounds: Option<BrowserWebviewBounds>,
) -> Result<(), String> {
    let window = main_window_win(&app)?;
    let webview = require_browser_webview(&window)?;

    if visible {
        if let Some(bounds) = last_bounds {
            webview
                .set_position(LogicalPosition::new(bounds.x, bounds.y))
                .map_err(|e| e.to_string())?;
            webview
                .set_size(LogicalSize::new(bounds.width, bounds.height))
                .map_err(|e| e.to_string())?;
        }
    } else {
        // Push far offscreen.
        webview
            .set_position(LogicalPosition::new(-20_000.0, -20_000.0))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Execute arbitrary JavaScript inside the browser child webview.
///
/// Typical uses: `history.back()`, `history.forward()`, `location.reload()`.
#[tauri::command]
pub fn browser_webview_eval(app: AppHandle, js: String) -> Result<(), String> {
    let window = main_window_win(&app)?;
    let webview = require_browser_webview(&window)?;

    webview.eval(&js).map_err(|e| e.to_string())?;
    Ok(())
}
