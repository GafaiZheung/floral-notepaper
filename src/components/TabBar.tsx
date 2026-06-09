import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface TabInfo {
  noteId: string;
  title: string;
  saveState: "idle" | "dirty" | "saving" | "saved" | "error";
}

/** Menu action identifier for right-click context menu */
export type TabMenuAction = "close" | "closeOthers" | "closeRight" | "closeAll" | "closeSaved";

export interface TabBarProps {
  tabs: TabInfo[];
  activeTabId: string | null;
  onSelectTab: (noteId: string) => void;
  onCloseTab: (noteId: string) => void;
  onNewTab: () => void;
  onTabMenuAction: (action: TabMenuAction, noteId: string) => void;
  /** When true, renders compact without border — for titlebar integration */
  inTitlebar?: boolean;
  /** When true, hides the new-tab button */
  hideNewTab?: boolean;
}

function getDisplayTitle(title: string): string {
  return title.trim() || "无标题笔记";
}

export function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onTabMenuAction,
  inTitlebar = false,
  hideNewTab = false,
}: TabBarProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    noteId: string;
  } | null>(null);

  // Check overflow for fade indicators
  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowLeftFade(el.scrollLeft > 2);
    setShowRightFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    updateFade();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateFade, { passive: true });
    window.addEventListener("resize", updateFade);
    return () => {
      el.removeEventListener("scroll", updateFade);
      window.removeEventListener("resize", updateFade);
    };
  }, [updateFade, tabs]);

  // Auto-scroll active tab into view
  useEffect(() => {
    if (!activeTabId || !scrollRef.current) return;
    const el = scrollRef.current;
    const activeEl = el.querySelector(`[data-tab-id="${activeTabId}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [activeTabId]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent, noteId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, noteId });
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollLeft += e.deltaY;
  };

  return (
    <div
      className={`relative flex items-center shrink-0 select-none px-1 ${
        inTitlebar ? "h-full flex-1 min-w-0" : "h-9 border-b border-paper-deep/15"
      }`}
    >
      {/* Left fade */}
      {showLeftFade && (
        <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-paper/70 to-transparent z-10 pointer-events-none" />
      )}

      {/* Tab scroll area */}
      <div
        ref={scrollRef}
        className="flex items-center flex-1 overflow-x-hidden px-1 gap-0.5"
        onWheel={handleWheel}
      >
        {tabs.map((tab) => {
          const isActive = tab.noteId === activeTabId;
          const isDirty = tab.saveState === "dirty";
          return (
            <div
              key={tab.noteId}
              data-tab-id={tab.noteId}
              onClick={() => onSelectTab(tab.noteId)}
              onContextMenu={(e) => handleContextMenu(e, tab.noteId)}
              onMouseDown={(e) => {
                // Middle-click to close
                if (e.button === 1) {
                  e.preventDefault();
                  onCloseTab(tab.noteId);
                }
              }}
              className={`group relative flex items-center h-8 max-w-[160px] px-2.5 rounded-t-md cursor-pointer transition-colors shrink-0 ${
                isActive
                  ? "bg-cloud text-ink border-b-2 border-bamboo"
                  : "text-ink-faint hover:bg-paper-warm/60 hover:text-ink-soft"
              }`}
              title={getDisplayTitle(tab.title)}
            >
              {/* Dirty indicator */}
              {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-bamboo mr-1.5 shrink-0" />}
              <span className="text-[11.5px] truncate leading-snug">
                {getDisplayTitle(tab.title)}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.noteId);
                }}
                className={`ml-1.5 w-4 h-4 flex items-center justify-center rounded-sm text-[10px] transition-all shrink-0 ${
                  isActive
                    ? "opacity-60 hover:opacity-100 hover:bg-paper-deep/20"
                    : "opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-paper-deep/15"
                }`}
                title={t("tabs.close", { defaultValue: "关闭" })}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* Right fade */}
      {showRightFade && (
        <div
          className={`absolute top-0 bottom-0 w-6 bg-gradient-to-l from-paper/70 to-transparent z-10 pointer-events-none ${
            hideNewTab ? "right-0" : "right-8"
          }`}
        />
      )}

      {/* New tab button */}
      {!hideNewTab && (
        <button
          onClick={onNewTab}
          className="w-8 h-8 flex items-center justify-center text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 rounded-md transition-all shrink-0 mr-1 cursor-pointer"
          title={t("tabs.newTab", { defaultValue: "新建标签页" })}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-[99999] min-w-[148px] py-1.5 bg-cloud/95 backdrop-blur-sm border border-paper-deep/50 rounded-lg overflow-hidden shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(
            [
              {
                action: "close" as TabMenuAction,
                label: t("tabs.contextMenu.close", { defaultValue: "关闭" }),
              },
              {
                action: "closeOthers" as TabMenuAction,
                label: t("tabs.contextMenu.closeOthers", { defaultValue: "关闭其他" }),
              },
              {
                action: "closeRight" as TabMenuAction,
                label: t("tabs.contextMenu.closeRight", { defaultValue: "关闭右侧" }),
              },
              {
                action: "closeAll" as TabMenuAction,
                label: t("tabs.contextMenu.closeAll", { defaultValue: "关闭所有" }),
              },
              {
                action: "closeSaved" as TabMenuAction,
                label: t("tabs.contextMenu.closeSaved", { defaultValue: "关闭已保存" }),
              },
            ] as const
          ).map((item) => (
            <button
              key={item.action}
              onClick={() => {
                onTabMenuAction(item.action, contextMenu.noteId);
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 text-[12px] text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
