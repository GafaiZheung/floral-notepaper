import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createBrowserWebview,
  destroyBrowserWebview,
  navigateBrowserWebview,
  onBrowserNavigated,
  updateBrowserWebviewBounds,
  browserWebviewGoBack,
  browserWebviewGoForward,
  browserWebviewReload,
} from "../features/browser/api";
import type { BrowserTab, BrowserWebviewBounds } from "../features/browser/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RightBrowserPanelProps {
  isOpen: boolean;
  isExpanded: boolean;
  /** Outer panel CSS width (px) — used for resize-triggered bounds sync */
  width: number;
  onToggleExpand: () => void;
  onClose: () => void;
}

type TabMenuAction = "close" | "closeOthers" | "closeRight" | "closeAll";

interface TabMenuState {
  x: number;
  y: number;
  tabId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tabIdCounter = 0;
function nextTabId(): string {
  tabIdCounter += 1;
  return `browser-tab-${tabIdCounter}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RightBrowserPanel({ isOpen, width, onClose }: RightBrowserPanelProps) {
  const { t } = useTranslation();

  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [tabMenu, setTabMenu] = useState<TabMenuState | null>(null);
  const webviewCreatedRef = useRef(false);
  const lastBoundsRef = useRef<BrowserWebviewBounds | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );

  // ── Compute webview bounds from the content area (below chrome) ──
  const computeBounds = useCallback((): BrowserWebviewBounds | null => {
    const content = contentRef.current;
    if (!content) return null;
    const rect = content.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, []);

  // ── Sync bounds to Rust (called from ResizeObserver + initial create) ──
  const syncBounds = useCallback(() => {
    if (!webviewCreatedRef.current) return;
    const bounds = computeBounds();
    if (!bounds) return;
    lastBoundsRef.current = bounds;
    void updateBrowserWebviewBounds(bounds).catch(() => {});
  }, [computeBounds]);

  // ── Initialise with one blank tab on first open ──
  useEffect(() => {
    if (isOpen && tabs.length === 0) {
      const id = nextTabId();
      const initial: BrowserTab = { id, url: "about:blank", title: "about:blank" };
      setTabs([initial]);
      setActiveTabId(id);
      setUrlInput("about:blank");
    }
  }, [isOpen, tabs.length]);

  // ── Listen for navigation events from the child webview ──
  useEffect(() => {
    if (!isOpen) return;
    const unlisten = onBrowserNavigated((payload) => {
      setUrlInput(payload.url);
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId ? { ...t, url: payload.url, title: payload.url } : t,
        ),
      );
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [isOpen, activeTabId]);

  // ── Create / destroy the Tauri child webview ──
  useEffect(() => {
    if (!isOpen) {
      if (webviewCreatedRef.current) {
        void destroyBrowserWebview();
        webviewCreatedRef.current = false;
      }
      return;
    }

    // Wait for layout to settle so getBoundingClientRect is accurate.
    const timer = window.setTimeout(async () => {
      const bounds = computeBounds();
      if (!bounds) return;
      lastBoundsRef.current = bounds;
      try {
        await createBrowserWebview(activeTab?.url ?? "about:blank", bounds);
        webviewCreatedRef.current = true;
        // Double-check bounds after a short delay (layout may shift).
        setTimeout(syncBounds, 100);
      } catch {
        // Panel may have been closed already.
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      if (webviewCreatedRef.current) {
        void destroyBrowserWebview();
        webviewCreatedRef.current = false;
      }
    };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Navigate when active tab changes ──
  const prevActiveTabId = useRef(activeTabId);
  useEffect(() => {
    if (!isOpen || !activeTab || !webviewCreatedRef.current) return;
    if (activeTab.id === prevActiveTabId.current) return;
    prevActiveTabId.current = activeTab.id;
    setUrlInput(activeTab.url);
    void navigateBrowserWebview(activeTab.url).catch(() => {});
  }, [isOpen, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ResizeObserver: sync webview bounds on content area resize ──
  useEffect(() => {
    if (!isOpen) return;
    const el = contentRef.current;
    if (!el) return;

    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(syncBounds);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isOpen, width, syncBounds]);

  // ── Tab actions ──
  const handleNewTab = useCallback(() => {
    const id = nextTabId();
    const newTab: BrowserTab = {
      id,
      url: "about:blank",
      title: t("main.browser.newTab", { defaultValue: "新标签页" }),
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
    setUrlInput("about:blank");
    void navigateBrowserWebview("about:blank").catch(() => {});
  }, [t]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== tabId);
        if (tabId === activeTabId) {
          if (remaining.length === 0) {
            // Close the whole panel
            onClose();
            return [];
          }
          const idx = prev.findIndex((t) => t.id === tabId);
          const next = remaining[Math.min(idx, remaining.length - 1)];
          setActiveTabId(next.id);
          setUrlInput(next.url);
          void navigateBrowserWebview(next.url).catch(() => {});
        }
        return remaining;
      });
    },
    [activeTabId, onClose],
  );

  const handleSelectTab = useCallback(
    (tabId: string) => {
      if (tabId === activeTabId) return;
      setActiveTabId(tabId);
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
        setUrlInput(tab.url);
      }
    },
    [activeTabId, tabs],
  );

  const handleTabContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setTabMenu({ x: e.clientX, y: e.clientY, tabId });
  }, []);

  const handleTabMenuAction = useCallback(
    (action: TabMenuAction) => {
      if (!tabMenu) return;
      const { tabId } = tabMenu;
      setTabMenu(null);

      let toClose: string[] = [];
      switch (action) {
        case "close":
          toClose = [tabId];
          break;
        case "closeOthers":
          toClose = tabs.filter((t) => t.id !== tabId).map((t) => t.id);
          break;
        case "closeRight": {
          const idx = tabs.findIndex((t) => t.id === tabId);
          toClose = tabs.slice(idx + 1).map((t) => t.id);
          break;
        }
        case "closeAll":
          toClose = tabs.map((t) => t.id);
          break;
      }

      for (const id of toClose) {
        handleCloseTab(id);
      }
    },
    [handleCloseTab, tabMenu, tabs],
  );

  const handleUrlSubmit = useCallback(() => {
    const raw = urlInput.trim();
    if (!raw) return;
    // Prefix https:// if no scheme given
    const url = raw.includes("://") ? raw : `https://${raw}`;
    setUrlInput(url);
    void navigateBrowserWebview(url).catch(() => {});
  }, [urlInput]);

  // ── Close tab menu on outside click ──
  useEffect(() => {
    if (!tabMenu) return;
    const onMouseDown = () => setTabMenu(null);
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [tabMenu]);

  if (!isOpen) return null;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Tab bar ── */}
      <div className="flex items-center shrink-0 border-b border-paper-deep/20 bg-paper/20 h-8">
        <div className="flex items-center flex-1 min-w-0 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleSelectTab(tab.id)}
              onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  handleCloseTab(tab.id);
                }
              }}
              className={`group flex items-center gap-1.5 h-8 max-w-[140px] px-2.5 text-[11px] font-body shrink-0 border-r border-paper-deep/15 transition-colors cursor-pointer truncate ${
                tab.id === activeTabId
                  ? "bg-cloud text-ink-faint"
                  : "bg-paper/20 text-ink-ghost hover:text-ink-faint hover:bg-paper-warm/50"
              }`}
              title={tab.url}
            >
              <span className="truncate">{tab.title || tab.url}</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(tab.id);
                }}
                className="shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded-sm opacity-0 group-hover:opacity-100 hover:bg-paper-deep/30 transition-all"
              >
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={handleNewTab}
          className="w-7 h-7 flex items-center justify-center shrink-0 text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 rounded-lg transition-all cursor-pointer mx-0.5"
          title={t("main.browser.newTab", { defaultValue: "新建标签页" })}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {/* ── URL bar ── */}
      <div className="flex items-center gap-1 px-2 h-9 shrink-0 border-b border-paper-deep/15 bg-paper/10">
        <button
          onClick={() => void browserWebviewGoBack()}
          className="w-6 h-6 flex items-center justify-center rounded text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
          title={t("main.browser.back", { defaultValue: "后退" })}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          onClick={() => void browserWebviewGoForward()}
          className="w-6 h-6 flex items-center justify-center rounded text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
          title={t("main.browser.forward", { defaultValue: "前进" })}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <button
          onClick={() => void browserWebviewReload()}
          className="w-6 h-6 flex items-center justify-center rounded text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
          title={t("main.browser.reload", { defaultValue: "刷新" })}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleUrlSubmit();
          }}
          className="flex-1 min-w-0"
        >
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://…"
            className="w-full h-7 px-2.5 rounded-lg text-[12px] font-mono text-ink bg-paper-warm/60 border border-paper-deep/30 focus:border-bamboo/30 focus:bg-cloud transition-all placeholder:text-ink-ghost/50"
          />
        </form>
      </div>

      {/* ── Webview content area (native child webview covers this) ── */}
      <div ref={contentRef} className="flex-1 min-h-0" />

      {/* ── Tab context menu ── */}
      {tabMenu && (
        <div
          className="fixed z-[9999] min-w-[140px] py-1 bg-cloud/95 backdrop-blur-sm border border-paper-deep/50 rounded-lg overflow-hidden select-none animate-menu-enter"
          style={{ left: tabMenu.x, top: tabMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(
            [
              ["close", t("main.browser.tabMenu.close", { defaultValue: "关闭" })],
              ["closeOthers", t("main.browser.tabMenu.closeOthers", { defaultValue: "关闭其他" })],
              ["closeRight", t("main.browser.tabMenu.closeRight", { defaultValue: "关闭右侧" })],
              ["closeAll", t("main.browser.tabMenu.closeAll", { defaultValue: "关闭全部" })],
            ] as [TabMenuAction, string][]
          ).map(([action, label]) => (
            <button
              key={action}
              onClick={() => handleTabMenuAction(action)}
              className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
