/** Pixel-accurate bounds for the child webview (relative to parent window content area). */
export interface BrowserWebviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A single browser tab. */
export interface BrowserTab {
  id: string;
  url: string;
  title: string;
}

/** Payload received from `browser-navigated` Tauri event. */
export interface BrowserNavigatedPayload {
  url: string;
}
