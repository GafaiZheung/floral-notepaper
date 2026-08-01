import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { resolveAddressInput } from "../features/browser/address";
import {
  browserActivate,
  browserBack,
  browserClose,
  browserForward,
  browserNavigate,
  browserOpen,
  browserReload,
  browserSetZoom,
  browserStop,
  browserToggleFloat,
  browserSetVisible,
} from "../features/browser/api";
import type { BrowserState, BrowserTab } from "../features/browser/types";
import { createNote } from "../features/notes/api";
import { showToast } from "./Toast";

export interface BrowserPanelHandle {
  /** 聚焦地址栏（供 Ctrl+L 快捷键调用）。 */
  focusAddressBar: () => void;
}

interface BrowserPanelProps {
  state: BrowserState;
  /** 收回浏览区（前端负责收起列）。 */
  onRetract?: () => void;
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/**
 * 微信式侧边栏浏览器面板：标签栏 + 工具栏 + "···"菜单 + 空页态。
 * 数据源为 Rust 侧 browser-state-changed 事件负载（受控组件）。
 */
export const BrowserPanel = forwardRef<BrowserPanelHandle, BrowserPanelProps>(function BrowserPanel(
  { state, onRetract },
  ref,
) {
  const { t } = useTranslation();
  const activeTab = state.tabs.find((tab) => tab.active) ?? null;
  const [addressValue, setAddressValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [draftMode, setDraftMode] = useState(false);
  const addressRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      focusAddressBar() {
        addressRef.current?.focus();
        addressRef.current?.select();
      },
    }),
    [],
  );

  // 活跃标签变化时同步地址栏内容（用户输入期间不覆盖）。
  useEffect(() => {
    setAddressValue(activeTab?.url ?? "");
  }, [activeTab?.tabId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 点击面板外部关闭 "···" 菜单。
  useEffect(() => {
    if (!menuOpen) return undefined;
    function closeOnOutside(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, [menuOpen]);

  const submitAddress = useCallback(() => {
    const resolved = resolveAddressInput(addressValue);
    if (!resolved) return;
    setDraftMode(false);
    if (activeTab) {
      void browserNavigate(activeTab.tabId, resolved);
    } else {
      void browserOpen(resolved);
    }
  }, [addressValue, activeTab]);

  const handleAddressKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitAddress();
      } else if (event.key === "Escape") {
        setDraftMode(false);
        addressRef.current?.blur();
      }
    },
    [submitAddress],
  );

  const handleOpenNewTab = useCallback(() => {
    setDraftMode(true);
    requestAnimationFrame(() => addressRef.current?.focus());
  }, []);

  const handleCloseTab = useCallback((tab: BrowserTab) => {
    void browserClose(tab.tabId);
  }, []);

  const handleActivateTab = useCallback((tab: BrowserTab) => {
    void browserActivate(tab.tabId);
  }, []);

  const handleBack = useCallback(() => {
    if (activeTab?.canGoBack) void browserBack(activeTab.tabId);
  }, [activeTab]);

  const handleForward = useCallback(() => {
    if (activeTab?.canGoForward) void browserForward(activeTab.tabId);
  }, [activeTab]);

  const handleReloadStop = useCallback(() => {
    if (!activeTab) return;
    if (activeTab.loading) {
      void browserStop(activeTab.tabId);
    } else {
      void browserReload(activeTab.tabId);
    }
  }, [activeTab]);

  const handleZoom = useCallback(
    (delta: number) => {
      if (!activeTab) return;
      void browserSetZoom(activeTab.tabId, Math.round((activeTab.zoom + delta) * 10) / 10);
    },
    [activeTab],
  );

  const handleToggleFloat = useCallback(() => {
    if (activeTab) void browserToggleFloat(activeTab.tabId);
  }, [activeTab]);

  const handleOpenInSystem = useCallback(() => {
    if (activeTab) void openUrl(activeTab.url);
  }, [activeTab]);

  const handleCopyUrl = useCallback(async () => {
    if (!activeTab) return;
    try {
      await writeText(activeTab.url);
      showToast(t("browser.toast.urlCopied", { defaultValue: "网址已复制" }), "info");
    } catch {
      showToast(t("browser.toast.copyFailed", { defaultValue: "复制网址失败" }));
    }
  }, [activeTab, t]);

  const handleSaveAsNote = useCallback(async () => {
    if (!activeTab) return;
    const title = activeTab.title || hostnameFromUrl(activeTab.url);
    try {
      await createNote({
        title,
        content: `# ${title}\n\n[${title}](${activeTab.url})\n\n> 来源：${activeTab.url}`,
        category: "",
      });
      showToast(t("browser.toast.noteSaved", { defaultValue: "已存为笔记" }), "info");
    } catch {
      showToast(t("browser.toast.saveFailed", { defaultValue: "存为笔记失败" }));
    }
  }, [activeTab, t]);

  const handleRetract = useCallback(() => {
    setMenuOpen(false);
    void browserSetVisible(false);
    onRetract?.();
  }, [onRetract]);

  const handleCloseAll = useCallback(() => {
    setMenuOpen(false);
    for (const tab of state.tabs) {
      void browserClose(tab.tabId);
    }
    onRetract?.();
  }, [state.tabs, onRetract]);

  const showEmptyState = draftMode || state.tabs.length === 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-paper/40">
      {/* 标签栏 */}
      {state.tabs.length > 0 && (
        <div className="flex items-center gap-0.5 px-1.5 pt-1.5 pb-1 border-b border-paper-deep/30 shrink-0 select-none">
          <div className="flex-1 flex items-center gap-0.5 min-w-0 overflow-x-auto scrollbar-hidden">
            {state.tabs.map((tab) => (
              <div
                key={tab.tabId}
                role="tab"
                aria-selected={tab.active}
                onClick={() => handleActivateTab(tab)}
                className={`group flex items-center gap-1 max-w-[140px] min-w-0 shrink-0 px-2 h-7 rounded-lg text-[11px] font-body transition-colors cursor-pointer ${
                  tab.active
                    ? "bg-paper-warm/80 text-ink-soft border border-bamboo/25"
                    : "text-ink-ghost hover:bg-paper-warm/50 hover:text-ink-faint"
                }`}
                title={tab.title || tab.url}
              >
                <span className={`truncate ${tab.floating ? "italic" : ""}`}>
                  {tab.floating
                    ? `◎ ${tab.title || hostnameFromUrl(tab.url)}`
                    : tab.title || hostnameFromUrl(tab.url)}
                </span>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    handleCloseTab(tab);
                  }}
                  className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-ink-ghost hover:text-red-400 hover:bg-danger-bg transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                  title={t("browser.tab.close", { defaultValue: "关闭标签" })}
                >
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={handleOpenNewTab}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer"
            title={t("browser.tab.new", { defaultValue: "新标签" })}
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
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((prev) => !prev)}
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
              title={t("browser.menu.more", { defaultValue: "更多" })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="12" cy="19" r="1.6" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute top-full right-0 mt-1 z-50 min-w-[168px] py-1.5 bg-cloud/95 backdrop-blur-sm border border-paper-deep/50 rounded-lg shadow-lg overflow-hidden select-none">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    handleToggleFloat();
                  }}
                  disabled={!activeTab}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t(activeTab?.floating ? "browser.menu.unfloat" : "browser.menu.floating", {
                    defaultValue: activeTab?.floating ? "停靠回面板" : "浮窗显示",
                  })}
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    handleOpenInSystem();
                  }}
                  disabled={!activeTab}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t("browser.menu.openInSystem", { defaultValue: "在系统浏览器打开" })}
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    void handleCopyUrl();
                  }}
                  disabled={!activeTab}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t("browser.menu.copyUrl", { defaultValue: "复制网址" })}
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    void handleSaveAsNote();
                  }}
                  disabled={!activeTab}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t("browser.menu.saveAsNote", { defaultValue: "存为笔记" })}
                </button>
                <div className="h-px bg-paper-deep/30 my-1" />
                <button
                  onClick={handleRetract}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer"
                >
                  {t("browser.menu.retract", { defaultValue: "收回" })}
                </button>
                <button
                  onClick={handleCloseAll}
                  disabled={state.tabs.length === 0}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] font-body text-red-400 hover:bg-danger-bg hover:text-red-500 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t("browser.menu.closeAll", { defaultValue: "关闭全部" })}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 工具栏 */}
      {activeTab && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-paper-deep/30 shrink-0 select-none">
          <button
            onClick={handleBack}
            disabled={!activeTab.canGoBack}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title={t("browser.toolbar.back", { defaultValue: "后退" })}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={handleForward}
            disabled={!activeTab.canGoForward}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title={t("browser.toolbar.forward", { defaultValue: "前进" })}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </button>
          <button
            onClick={handleReloadStop}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
            title={
              activeTab.loading
                ? t("browser.toolbar.stop", { defaultValue: "停止" })
                : t("browser.toolbar.reload", { defaultValue: "刷新" })
            }
          >
            {activeTab.loading ? (
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 0 1 15.36-6.36L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-15.36 6.36L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
            )}
          </button>
          <input
            ref={addressRef}
            type="text"
            value={addressValue}
            onChange={(event) => setAddressValue(event.target.value)}
            onKeyDown={handleAddressKeyDown}
            placeholder={t("browser.toolbar.addressPlaceholder", {
              defaultValue: "输入网址或搜索…",
            })}
            className="flex-1 min-w-0 h-7 px-2.5 rounded-lg text-[12px] font-mono text-ink placeholder:text-ink-ghost/60 bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/30 focus:bg-cloud transition-all outline-none"
          />
          <button
            onClick={() => handleZoom(-0.1)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[14px] text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
            title={t("browser.toolbar.zoomOut", { defaultValue: "缩小字号" })}
          >
            A−
          </button>
          <span className="w-8 text-center text-[10px] font-mono tabular-nums text-ink-ghost select-none">
            {Math.round(activeTab.zoom * 100)}%
          </span>
          <button
            onClick={() => handleZoom(0.1)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[14px] text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
            title={t("browser.toolbar.zoomIn", { defaultValue: "放大字号" })}
          >
            A+
          </button>
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 min-h-0">
        {showEmptyState ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 px-6">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-paper-warm/70 border border-paper-deep/40">
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-bamboo"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                <path d="M2 12h20" />
              </svg>
            </div>
            <div className="text-center">
              <div className="text-[13px] font-display font-medium text-ink-soft mb-1">
                {t("browser.empty.title", { defaultValue: "浏览器" })}
              </div>
              <div className="text-[11px] text-ink-ghost">
                {t("browser.empty.hint", { defaultValue: "输入网址或关键词开始浏览" })}
              </div>
            </div>
            <input
              type="text"
              value={addressValue}
              onChange={(event) => setAddressValue(event.target.value)}
              onKeyDown={handleAddressKeyDown}
              placeholder={t("browser.toolbar.addressPlaceholder", {
                defaultValue: "输入网址或搜索…",
              })}
              className="w-full max-w-[280px] h-9 px-3 rounded-xl text-[12px] font-mono text-ink placeholder:text-ink-ghost/60 bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/30 focus:bg-cloud transition-all outline-none"
            />
          </div>
        ) : activeTab ? (
          <div className="h-full flex items-center justify-center text-[12px] text-ink-ghost">
            {t("browser.content.hint", {
              defaultValue: "网页内容在右侧停靠窗口中显示",
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
});
