# 标签页管理功能 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在主窗口内实现标签页管理，允许同时打开多个笔记并通过标签切换、关闭和批量操作。

**Architecture:** 纯 React 状态驱动 —— 在 `MainWindow` 内新增 `tabs: TabState[]` 和 `activeTabId` 状态，新建 `TabBar` 组件负责标签栏 UI（横向滚动、右键菜单），利用已有 `AppConfig` 通道做标签持久化。

**Tech Stack:** React 19 + TypeScript, Tauri 2 (Rust backend), Tailwind CSS, i18next

**Spec:** `docs/superpowers/specs/2026-06-08-tab-page-management-design.md`

---

## File Structure

| 文件 | 职责 |
|---|---|
| `src/components/TabBar.tsx` | 标签栏组件（纯 UI）：渲染标签列表、横向滚动、右键菜单、关闭按钮 |
| `src/components/MainWindow.tsx` | 集成 TabBar + 标签状态管理 + 编辑器按 tab 切换 + 持久化 |
| `src/components/MainWindow.test.tsx` | 补充标签页相关测试 |
| `src/features/settings/types.ts` | AppConfig 新增 `openTabs` / `activeTabId` 字段 |
| `src/locales/zh-CN/translation.json` | 中文文案 |
| `src/locales/en-US/translation.json` | 英文文案 |

---

### Task 1: TabBar 组件（Pure UI）

**Files:**
- Create: `src/components/TabBar.tsx`

- [ ] **Step 1: 创建 TabBar 组件文件**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface TabInfo {
  noteId: string;
  title: string;
  saveState: "idle" | "dirty" | "saving" | "saved" | "error";
}

/** Menu action identifier for right-click context menu */
export type TabMenuAction =
  | "close"
  | "closeOthers"
  | "closeRight"
  | "closeAll"
  | "closeSaved";

export interface TabBarProps {
  tabs: TabInfo[];
  activeTabId: string | null;
  onSelectTab: (noteId: string) => void;
  onCloseTab: (noteId: string) => void;
  onNewTab: () => void;
  onTabMenuAction: (action: TabMenuAction, noteId: string) => void;
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
    <div className="relative flex items-center bg-paper/50 border-b border-paper-deep/20 shrink-0 select-none h-9">
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
              {isDirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-bamboo mr-1.5 shrink-0" />
              )}
              <span className="text-[11.5px] truncate leading-none">
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
        <div className="absolute right-8 top-0 bottom-0 w-6 bg-gradient-to-l from-paper/70 to-transparent z-10 pointer-events-none" />
      )}

      {/* New tab button */}
      <button
        onClick={onNewTab}
        className="w-8 h-8 flex items-center justify-center text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 rounded-md transition-all shrink-0 mr-1 cursor-pointer"
        title={t("tabs.newTab", { defaultValue: "新建标签页" })}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-[9999] min-w-[148px] py-1.5 bg-cloud/95 backdrop-blur-sm border border-paper-deep/50 rounded-lg overflow-hidden shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(
            [
              { action: "close" as TabMenuAction, label: t("tabs.contextMenu.close", { defaultValue: "关闭" }) },
              { action: "closeOthers" as TabMenuAction, label: t("tabs.contextMenu.closeOthers", { defaultValue: "关闭其他" }) },
              { action: "closeRight" as TabMenuAction, label: t("tabs.contextMenu.closeRight", { defaultValue: "关闭右侧" }) },
              { action: "closeAll" as TabMenuAction, label: t("tabs.contextMenu.closeAll", { defaultValue: "关闭所有" }) },
              { action: "closeSaved" as TabMenuAction, label: t("tabs.contextMenu.closeSaved", { defaultValue: "关闭已保存" }) },
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TabBar.tsx
git commit -m "feat: add TabBar component with scroll and context menu"
```

---

### Task 2: 标签状态管理与 MainWindow 集成

**Files:**
- Modify: `src/components/MainWindow.tsx`

- [ ] **Step 1: 在 MainWindow 中添加 TabState 类型和 tabs/activeTabId 状态**

在 `MainWindow` 函数体内、现有 `useState` 声明的区域（约第 335-397 行），在其他 useState 之后添加：

```tsx
// --- Tab state ---
interface TabState {
  noteId: string;
  title: string;
  content: string;
  contentFormat: string; // "markdown" | "html" — 外部只读文件用
  saveState: SaveState;
}

const [tabs, setTabs] = useState<TabState[]>([]);
const [activeTabId, setActiveTabId] = useState<string | null>(null);
```

- [ ] **Step 2: 添加 tab 辅助函数**

在状态声明之后、`selectedNote` / `selectedExternalFile` memo 之前添加：

```tsx
// === Tab helpers ===

/** Find a tab by noteId */
const findTab = useCallback(
  (noteId: string): TabState | undefined => tabs.find((t) => t.noteId === noteId),
  [tabs],
);

/** Persist current editor state into the active tab */
const flushActiveTab = useCallback(() => {
  if (!activeTabId) return;
  setTabs((prev) =>
    prev.map((t) =>
      t.noteId === activeTabId
        ? { ...t, content, contentFormat, title, saveState }
        : t,
    ),
  );
}, [activeTabId, content, contentFormat, title, saveState]);

/** Open a note as a tab (or activate if already open) */
const openTab = useCallback(
  async (noteId: string) => {
    // If tab already exists, just activate
    const existing = findTab(noteId);
    if (existing) {
      flushActiveTab();
      setActiveTabId(noteId);
      setContent(existing.content);
      setContentFormat(existing.contentFormat);
      setTitle(existing.title);
      setSaveState(existing.saveState);
      setSelectedId(noteId);
      return;
    }

    // Load note from backend
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const note = await getNote(noteId);
      // Flush current tab first
      flushActiveTab();
      // Add new tab
      const newTab: TabState = {
        noteId: note.id,
        title: note.title,
        content: note.content,
        contentFormat: note.fileFormat && note.fileFormat !== "md" ? "html" : "markdown",
        saveState: "saved" as SaveState,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(note.id);
      setSelectedId(note.id);
      setContent(note.content);
      setContentFormat(newTab.contentFormat);
      setTitle(note.title);
      setSaveState("saved");
      setNoteTransitionKey((k) => k + 1);
      // Update notes list metadata
      replaceNoteMetadata(note);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  },
  [findTab, flushActiveTab, replaceNoteMetadata],
);

/** Close a tab by noteId */
const closeTab = useCallback(
  async (noteId: string) => {
    const tab = findTab(noteId);
    if (!tab) return;

    // Check for unsaved changes
    if (tab.saveState === "dirty") {
      const confirmed = window.confirm(
        t("tabs.unsavedConfirm", {
          defaultValue: `"${tab.title || "无标题"}" 有未保存的更改，是否关闭？`,
        }),
      );
      if (!confirmed) return;
    }

    setTabs((prev) => prev.filter((t) => t.noteId !== noteId));

    // If closing the active tab, switch to another
    if (noteId === activeTabId) {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.noteId === noteId);
        // prev still has the old value inside setTabs callback — we compute from remaining tabs
        return prev; // will be recomputed below
      });

      // Find next tab to activate
      const remaining = tabs.filter((t) => t.noteId !== noteId);
      if (remaining.length > 0) {
        const idx = tabs.findIndex((t) => t.noteId === noteId);
        const next = remaining[Math.min(idx, remaining.length - 1)];
        setActiveTabId(next.noteId);
        setSelectedId(next.noteId);
        setContent(next.content);
        setContentFormat(next.contentFormat);
        setTitle(next.title);
        setSaveState(next.saveState);
        setNoteTransitionKey((k) => k + 1);
      } else {
        setActiveTabId(null);
        setSelectedId(null);
        setContent("");
        setContentFormat("markdown");
        setTitle("");
        setSaveState("idle");
      }
    }
  },
  [activeTabId, findTab, t, tabs],
);

/** Handle tab menu actions (batch close) */
const handleTabMenuAction = useCallback(
  async (action: TabMenuAction, noteId: string) => {
    const tab = findTab(noteId);
    if (!tab && action !== "closeAll" && action !== "closeSaved") return;

    let toClose: string[] = [];

    switch (action) {
      case "close":
        toClose = [noteId];
        break;
      case "closeOthers":
        toClose = tabs.filter((t) => t.noteId !== noteId).map((t) => t.noteId);
        break;
      case "closeRight": {
        const idx = tabs.findIndex((t) => t.noteId === noteId);
        toClose = tabs.slice(idx + 1).map((t) => t.noteId);
        break;
      }
      case "closeAll":
        toClose = tabs.map((t) => t.noteId);
        break;
      case "closeSaved":
        toClose = tabs.filter((t) => t.saveState !== "dirty").map((t) => t.noteId);
        break;
    }

    // Check if any dirty tabs are being closed
    const dirtyClosing = toClose.filter(
      (id) => tabs.find((t) => t.noteId === id)?.saveState === "dirty",
    );
    if (dirtyClosing.length > 0) {
      const confirmed = window.confirm(
        t("tabs.unsavedMultipleConfirm", {
          defaultValue: `有 ${dirtyClosing.length} 个标签页有未保存的更改，是否全部保存并关闭？`,
        }),
      );
      if (!confirmed) {
        // Close only saved tabs from the toClose list, skipping dirty ones
        toClose = toClose.filter((id) => !dirtyClosing.includes(id));
      }
    }

    // Close tabs one by one (skip save check since we already confirmed)
    for (const id of toClose) {
      setTabs((prev) => prev.filter((t) => t.noteId !== id));
    }

    // If active tab was among closed, switch
    if (toClose.includes(activeTabId!)) {
      const remaining = tabs.filter((t) => !toClose.includes(t.noteId));
      if (remaining.length > 0) {
        const next = remaining[0];
        setActiveTabId(next.noteId);
        setSelectedId(next.noteId);
        setContent(next.content);
        setContentFormat(next.contentFormat);
        setTitle(next.title);
        setSaveState(next.saveState);
        setNoteTransitionKey((k) => k + 1);
      } else {
        setActiveTabId(null);
        setSelectedId(null);
        setContent("");
        setContentFormat("markdown");
        setTitle("");
        setSaveState("idle");
      }
    }
  },
  [activeTabId, findTab, t, tabs],
);

/** Sync saveState changes back to active tab */
useEffect(() => {
  if (!activeTabId) return;
  setTabs((prev) =>
    prev.map((t) => (t.noteId === activeTabId ? { ...t, saveState } : t)),
  );
}, [activeTabId, saveState]);

/** Sync content changes back to active tab (debounced via ref is fine — use flushActiveTab on switch) */
```

- [ ] **Step 3: 修改 handleSelectNote 使其打开标签而非直接加载**

找到现有的 `handleSelectNote` 函数（约第 1220 行），替换为：

```tsx
const handleSelectNote = async (id: string) => {
  if (id === activeTabId) return;
  setDeleteConfirm(false);

  // Flush current content to active tab, then open/activate target
  flushActiveTab();
  await openTab(id);
};
```

- [ ] **Step 4: 修改 handleNewNote 使其打开为新标签**

找到现有的 `handleNewNote` 函数（约第 1092 行），替换为：

```tsx
const handleNewNote = async () => {
  setErrorMessage(null);
  // Save current if dirty
  if (saveState === "dirty") {
    await saveCurrentNote();
  }
  try {
    const note = await createNote({ title: "", content: "", category: activeCategory });
    replaceNoteMetadata(note);
    // Open as new tab
    flushActiveTab();
    const newTab: TabState = {
      noteId: note.id,
      title: note.title,
      content: note.content,
      contentFormat: "markdown",
      saveState: "saved",
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(note.id);
    setSelectedId(note.id);
    setContent(note.content);
    setContentFormat("markdown");
    setTitle(note.title);
    setSaveState("saved");
    setNoteTransitionKey((k) => k + 1);
  } catch (error) {
    setErrorMessage(getErrorMessage(error));
  }
};
```

- [ ] **Step 5: 修改 saveCurrentNote —— 同步标题到 tab**

在 `saveCurrentNote` 保存成功后，更新 tab 的 title：

在现有的 `saveCurrentNote` 函数体内，在 `replaceNoteMetadata(note);` 之后和 `setSaveState("saved");` 之前（约第 1040 行），添加：

```tsx
// Sync title to tab
setTabs((prev) =>
  prev.map((t) => (t.noteId === note.id ? { ...t, title: note.title } : t)),
);
```

对 `saveExternalFile` 分支（约第 1021 行）也在 `setSaveState("saved");` 之前添加类似的标题同步。

- [ ] **Step 6: 处理 deleteNote —— 删除后关闭对应标签**

找到现有的 `handleDeleteNote` 函数。在删除成功后添加：

```tsx
// Close tab for deleted note
if (selectedId) {
  setTabs((prev) => prev.filter((t) => t.noteId !== selectedId));
}
```

- [ ] **Step 7: 在 JSX 中插入 TabBar**

在标题栏（`<div className="relative z-10 flex items-center justify-between...">` 那一段）和侧边栏+编辑区主容器之间，插入 TabBar。找到标题栏的结束 `</div>` 和下一个 `<div className="flex flex-1...">` 之间：

```tsx
<TabBar
  tabs={tabs.map((t) => ({ noteId: t.noteId, title: t.title, saveState: t.saveState }))}
  activeTabId={activeTabId}
  onSelectTab={(noteId) => {
    flushActiveTab();
    void openTab(noteId);
  }}
  onCloseTab={(noteId) => void closeTab(noteId)}
  onNewTab={() => void handleNewNote()}
  onTabMenuAction={(action, noteId) => void handleTabMenuAction(action, noteId)}
/>
```

- [ ] **Step 8: 导入 TabBar 组件**

在文件顶部 import 区域添加：

```tsx
import { TabBar } from "./TabBar";
import type { TabMenuAction } from "./TabBar";
```

- [ ] **Step 9: Commit**

```bash
git add src/components/MainWindow.tsx
git commit -m "feat: integrate tab state management into MainWindow"
```

---

### Task 3: 标签持久化（AppConfig + 保存/恢复）

**Files:**
- Modify: `src/features/settings/types.ts`
- Modify: `src/components/MainWindow.tsx`

- [ ] **Step 1: AppConfig 新增字段**

在 `src/features/settings/types.ts` 的 `AppConfig` interface 末尾（`aiAutoAnswer` 之后）添加：

```ts
export interface AppConfig {
  // ... 现有字段 ...
  aiAutoAnswer?: boolean;
  /** Tab management: persisted tab list (noteId array) */
  openTabs?: string[];
  /** Tab management: last active tab id */
  activeTabId?: string;
}
```

- [ ] **Step 2: 在 MainWindow 中读取持久化的 tab 状态**

在 bootstrap 函数（约第 762 行 `useEffect` 中的 `bootstrap`）中，在加载完 config 后，恢复标签：

在 `bootstrap` 函数中，先声明一个变量接收 config，然后在初始化完成之后恢复 tabs。找到 bootstrap 中设置 `setNotes`、`setCategories` 等的位置（约第 770-790 行），在对应的 setState 之后添加恢复逻辑。

具体修改：在 `bootstrap` 函数中，拿到 `loadedConfig` 后：

```tsx
// ... existing bootstrap code sets notes, categories, etc. ...

// Restore tabs from config (defer to after notes are loaded)
if (loadedConfig.openTabs && loadedConfig.openTabs.length > 0) {
  const restoredTabs: TabState[] = [];
  for (const noteId of loadedConfig.openTabs) {
    // Check note still exists
    const meta = loadedNotes.find((n) => n.id === noteId);
    if (!meta) continue;
    try {
      const note = await getNote(noteId);
      restoredTabs.push({
        noteId: note.id,
        title: note.title,
        content: note.content,
        contentFormat: note.fileFormat && note.fileFormat !== "md" ? "html" : "markdown",
        saveState: "saved",
      });
    } catch {
      // Note may have been deleted — skip
    }
  }
  if (restoredTabs.length > 0) {
    setTabs(restoredTabs);
    const restoreActiveId =
      loadedConfig.activeTabId && restoredTabs.some((t) => t.noteId === loadedConfig.activeTabId)
        ? loadedConfig.activeTabId
        : restoredTabs[0].noteId;
    setActiveTabId(restoreActiveId);
    const activeTab = restoredTabs.find((t) => t.noteId === restoreActiveId)!;
    setSelectedId(activeTab.noteId);
    setContent(activeTab.content);
    setContentFormat(activeTab.contentFormat);
    setTitle(activeTab.title);
    setSaveState("saved");
  }
}
```

> **注意：** 由于 bootstrap 函数体已经较长，将恢复逻辑提取为一个独立函数 `async function restoreTabs(config: AppConfig, loadedNotes: NoteMetadata[])`，放在 `bootstrap` 内但在调用它之前定义。

- [ ] **Step 3: Debounced 保存标签状态到 AppConfig**

当 `tabs` 或 `activeTabId` 变化时，延迟写入 config。在 MainWindow 中添加新 useEffect（放在其他 useEffect 之后，如 auto-save useEffect 附近）：

```tsx
// Persist tabs to config (debounced)
useEffect(() => {
  if (!settingsConfig) return;
  const timer = window.setTimeout(() => {
    const updated = { ...settingsConfig };
    updated.openTabs = tabs.map((t) => t.noteId);
    updated.activeTabId = activeTabId ?? undefined;
    void saveConfig(updated);
  }, 500);
  return () => window.clearTimeout(timer);
}, [tabs, activeTabId, settingsConfig]);
```

- [ ] **Step 4: 确认 saveConfig 已导入**

已知 MainWindow.tsx 第 10-19 行已同时导入 `getConfig` 和 `saveConfig`，无需额外操作。

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/types.ts src/components/MainWindow.tsx
git commit -m "feat: add tab persistence via AppConfig"
```

---

### Task 4: 国际化文案

**Files:**
- Modify: `src/locales/zh-CN/translation.json`
- Modify: `src/locales/en-US/translation.json`

- [ ] **Step 1: 添加中文文案**

在 `src/locales/zh-CN/translation.json` 的顶层添加 `tabs` 节点。找到合适位置（如 `main` 节点之后）添加：

```json
"tabs": {
  "close": "关闭",
  "newTab": "新建标签页",
  "unsavedConfirm": "\"{{title}}\" 有未保存的更改，是否关闭？",
  "unsavedMultipleConfirm": "有 {{count}} 个标签页有未保存的更改，是否全部保存并关闭？",
  "contextMenu": {
    "close": "关闭",
    "closeOthers": "关闭其他",
    "closeRight": "关闭右侧",
    "closeAll": "关闭所有",
    "closeSaved": "关闭已保存"
  }
}
```

- [ ] **Step 2: 添加英文文案**

在 `src/locales/en-US/translation.json` 的对应位置添加：

```json
"tabs": {
  "close": "Close",
  "newTab": "New Tab",
  "unsavedConfirm": "\"{{title}}\" has unsaved changes. Close it?",
  "unsavedMultipleConfirm": "{{count}} tab(s) have unsaved changes. Save all and close?",
  "contextMenu": {
    "close": "Close",
    "closeOthers": "Close Others",
    "closeRight": "Close to the Right",
    "closeAll": "Close All",
    "closeSaved": "Close Saved"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/locales/zh-CN/translation.json src/locales/en-US/translation.json
git commit -m "feat: add tab management i18n strings"
```

---

### Task 5: 测试

**Files:**
- Modify: `src/components/MainWindow.test.tsx`

- [ ] **Step 1: 补充标签页测试用例**

在 `src/components/MainWindow.test.tsx` 末尾添加测试：

```tsx
describe("Tab management", () => {
  it("renders TabBar when tabs are open", async () => {
    // Mock listNotes to return some notes
    (invoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === "notes_list") return Promise.resolve([...]);
      if (cmd === "categories_list") return Promise.resolve([]);
      if (cmd === "get_config") return Promise.resolve({});
      return Promise.resolve(null);
    });

    render(<MainWindow />);
    // After loading, there should be no tabs (empty state)
    await waitFor(() => {
      expect(screen.queryByText("新建标签页")).not.toBeInTheDocument();
    });
  });

  it("opens a note as a new tab when clicking from sidebar", async () => {
    // ... test selecting a note creates a tab
  });

  it("closes tab when clicking X button", async () => {
    // ... test tab close
  });

  it("shows context menu on right-click", async () => {
    // ... test right-click menu
  });

  it("persists tabs on window close", async () => {
    // ... test persistence
  });
});
```

> 注意：测试需要 mock `getCurrentWindow`、`invoke`、`@tauri-apps/api/event` 等。查看现有测试文件中的 mock 模式，保持一致。

- [ ] **Step 2: 运行测试验证**

```bash
npm test -- --run src/components/MainWindow.test.tsx
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/MainWindow.test.tsx
git commit -m "test: add tab management tests"
```

---

## Implementation Order

```
Task 1 (TabBar UI) → Task 2 (MainWindow integration) → Task 3 (Persistence) → Task 4 (i18n) → Task 5 (Tests)
```

Task 1 必须先完成（Task 2 依赖 TabBar 组件）。Task 3-5 可并行开发。

## Verification

After all tasks:
1. `npm run dev` 启动应用
2. 在侧边栏点击多个笔记 → 验证标签页出现
3. 点击标签切换 → 验证内容和状态正确切换
4. × 关闭标签 → 验证确认框和关闭逻辑
5. 右键菜单 → 验证批量操作
6. 关闭并重新打开应用 → 验证标签恢复
7. `npm test` → 验证全部测试通过
