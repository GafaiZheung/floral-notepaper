/** 浏览器侧边栏状态类型（与 Rust 侧 services/browser.rs 的 serde camelCase 对齐）。 */

export interface BrowserTab {
  tabId: string;
  url: string;
  title: string;
  zoom: number;
  floating: boolean;
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
  dockWidth: 420,
  visible: false,
};
