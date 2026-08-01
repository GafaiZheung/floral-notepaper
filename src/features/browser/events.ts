import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { BrowserState } from "./types";

export const BROWSER_STATE_CHANGED_EVENT = "browser-state-changed";

/** 订阅 Rust 侧浏览器状态变更（完整 BrowserState 为唯一数据源）。 */
export function subscribeBrowserState(
  callback: (state: BrowserState) => void,
): Promise<UnlistenFn> {
  return listen<BrowserState>(BROWSER_STATE_CHANGED_EVENT, (event) => {
    callback(event.payload);
  });
}
