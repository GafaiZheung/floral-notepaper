/** 主窗口右侧浏览器延伸状态（与 Rust 侧 serde camelCase 对齐）。 */

export interface BrowserTab {
  tabId: string;
  url: string;
  title: string;
  zoom: number;
  active: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export interface BrowserState {
  tabs: BrowserTab[];
  activeTabId: string | null;
  dockWidth: number;
  visible: boolean;
}

export const DEFAULT_BROWSER_STATE: BrowserState = {
  tabs: [],
  activeTabId: null,
  dockWidth: 480,
  visible: false,
};
