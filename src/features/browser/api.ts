import { invoke } from "@tauri-apps/api/core";
import type { BrowserState } from "./types";

export function browserGetState(): Promise<BrowserState> {
  return invoke("browser_get_state");
}

export function browserOpen(url: string): Promise<BrowserState> {
  return invoke("browser_open", { url });
}

export function browserActivate(tabId: string): Promise<BrowserState> {
  return invoke("browser_activate", { tabId });
}

export function browserClose(tabId: string): Promise<BrowserState> {
  return invoke("browser_close", { tabId });
}

export function browserNavigate(tabId: string, url: string): Promise<BrowserState> {
  return invoke("browser_navigate", { tabId, url });
}

export function browserBack(tabId: string): Promise<BrowserState> {
  return invoke("browser_back", { tabId });
}

export function browserForward(tabId: string): Promise<BrowserState> {
  return invoke("browser_forward", { tabId });
}

export function browserReload(tabId: string): Promise<BrowserState> {
  return invoke("browser_reload", { tabId });
}

export function browserStop(tabId: string): Promise<BrowserState> {
  return invoke("browser_stop", { tabId });
}

export function browserSetZoom(tabId: string, zoom: number): Promise<BrowserState> {
  return invoke("browser_set_zoom", { tabId, zoom });
}

export function browserToggleFloat(tabId: string): Promise<BrowserState> {
  return invoke("browser_toggle_float", { tabId });
}

export function browserSetWidth(width: number): Promise<BrowserState> {
  return invoke("browser_set_width", { width });
}

export function browserSetVisible(visible: boolean): Promise<BrowserState> {
  return invoke("browser_set_visible", { visible });
}
