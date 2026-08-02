import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { BrowserPanel } from "./BrowserPanel";
import type { BrowserState } from "../features/browser/types";
import * as browserApi from "../features/browser/api";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("../features/notes/api", () => ({
  createNote: vi.fn(),
}));

const baseState: BrowserState = {
  tabs: [
    {
      tabId: "t1",
      url: "https://example.com/a",
      title: "页面 A",
      zoom: 1.0,
      active: true,
      canGoBack: false,
      canGoForward: false,
      loading: false,
    },
    {
      tabId: "t2",
      url: "https://example.org/b",
      title: "Page B",
      zoom: 1.1,
      active: false,
      canGoBack: true,
      canGoForward: true,
      loading: true,
    },
  ],
  activeTabId: "t1",
  dockWidth: 420,
  visible: true,
};

describe("BrowserPanel", () => {
  test("renders tab titles and active tab styling", () => {
    const markup = renderToStaticMarkup(<BrowserPanel state={baseState} />);

    expect(markup).toContain("页面 A");
    expect(markup).toContain("Page B");
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('aria-selected="false"');
  });

  test("renders toolbar back/forward disabled states from history flags", () => {
    const markup = renderToStaticMarkup(<BrowserPanel state={baseState} />);

    // t1：canGoBack=false → 后退按钮禁用。
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain("◎");
  });

  test("shows empty state when no tabs exist", () => {
    const markup = renderToStaticMarkup(
      <BrowserPanel state={{ ...baseState, tabs: [], activeTabId: null }} />,
    );

    // zh-CN 已初始化：渲染译文 "浏览器" 与地址栏 placeholder
    expect(markup).toContain("浏览器");
    expect(markup).toContain("输入网址或搜索");
  });

  test("new tab button opens draft mode without creating a window", () => {
    const openSpy = vi.spyOn(browserApi, "browserOpen").mockResolvedValue(baseState);
    const markup = renderToStaticMarkup(<BrowserPanel state={baseState} />);

    expect(markup).toContain('title="新标签"');
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  test("renders the more menu entries", () => {
    const markup = renderToStaticMarkup(<BrowserPanel state={baseState} />);

    expect(markup).toContain('title="更多"');
  });

  test("renders a complete main-window extension frame", () => {
    const markup = renderToStaticMarkup(<BrowserPanel state={baseState} />);

    expect(markup).toContain('data-testid="browser-extension"');
    expect(markup).toContain('aria-label="收回"');
  });
});
