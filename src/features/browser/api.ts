import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { BrowserNavigatedPayload, BrowserWebviewBounds } from "./types";

// ---------------------------------------------------------------------------
// Tauri command wrappers
// ---------------------------------------------------------------------------

/** Create (or recreate) the browser child webview inside the main window. */
export async function createBrowserWebview(
  url: string,
  bounds: BrowserWebviewBounds,
): Promise<void> {
  await invoke("create_browser_webview", { url, bounds });
}

/** Update the position and size of the browser child webview. */
export async function updateBrowserWebviewBounds(bounds: BrowserWebviewBounds): Promise<void> {
  await invoke("update_browser_webview_bounds", { bounds });
}

/** Navigate the browser child webview to a new URL. */
export async function navigateBrowserWebview(url: string): Promise<void> {
  await invoke("navigate_browser_webview", { url });
}

/** Destroy the browser child webview. */
export async function destroyBrowserWebview(): Promise<void> {
  await invoke("destroy_browser_webview");
}

/** Move the browser webview offscreen (hide) or restore to last bounds (show). */
export async function setBrowserWebviewVisible(
  visible: boolean,
  lastBounds?: BrowserWebviewBounds,
): Promise<void> {
  await invoke("set_browser_webview_visible", {
    visible,
    lastBounds: lastBounds ?? null,
  });
}

/** Execute arbitrary JS inside the browser child webview. */
export async function browserWebviewEval(js: string): Promise<void> {
  await invoke("browser_webview_eval", { js });
}

/** Convenience: navigate back. */
export function browserWebviewGoBack(): Promise<void> {
  return browserWebviewEval("history.back()");
}

/** Convenience: navigate forward. */
export function browserWebviewGoForward(): Promise<void> {
  return browserWebviewEval("history.forward()");
}

/** Convenience: reload. */
export function browserWebviewReload(): Promise<void> {
  return browserWebviewEval("location.reload()");
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

/** Listen for URL changes from the child webview. */
export function onBrowserNavigated(
  callback: (payload: BrowserNavigatedPayload) => void,
): Promise<() => void> {
  return listen<BrowserNavigatedPayload>("browser-navigated", (event) => {
    callback(event.payload);
  });
}
