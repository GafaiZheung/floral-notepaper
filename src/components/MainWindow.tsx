import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { emit, listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { exportMarkdownNote, importMarkdownNote } from "../features/importExport/api";
import { extractHeadings } from "../features/markdown/extractHeadings";
import { OutlinePanel } from "./OutlinePanel";
import {
  chooseNotesDirectory,
  getConfig,
  normalizeViewMode,
  saveConfig,
  selectNotesDir,
  addNotesDir,
  deleteNotesDir,
  classifyOpenedFile,
} from "../features/settings/api";
import { getOneDriveSyncedPaths } from "../features/onedrive/api";
import type { AppConfig } from "../features/settings/types";
import { displayPathLabel, parentDirFromFilePath } from "../features/settings/notePaths";
import { normalizeTileColor } from "../features/settings/tileColor";
import { BackgroundLayer } from "./BackgroundLayer";
import { LeftIconSidebar, type SidebarPanel } from "./LeftIconSidebar";
import { GitPanel } from "./GitPanel";
import { SettingsTab } from "./SettingsTab";
import { TabBar } from "./TabBar";
import type { TabMenuAction } from "./TabBar";
import { WysiwygEditor } from "./WysiwygEditor";
import type { WysiwygEditorHandle } from "./WysiwygEditor";
import {
  createNote,
  createCategory,
  deleteCategory,
  deleteNote,
  getErrorMessage,
  getFileModifiedTime,
  getNote,
  listCategories,
  listNotes,
  moveNoteCategory,
  readExternalFile,
  openFileWithSystemApp,
  openNoteWithSystemApp,
  renameCategory,
  renameNoteFileStem,
  saveExternalFile,
  updateNote,
} from "../features/notes/api";
import type { ExternalFile, Note, NoteMetadata } from "../features/notes/types";
import {
  countNoteChars,
  filterNotes,
  formatShortDate,
  formatTime,
  getDisplayTitle,
  getFileTypeIconColor,
  getFileTypeLabel,
  groupNotesByCategory,
  isReadOnlyNote,
  metadataFromNote,
} from "../features/notes/noteUtils";
import type { CategoryGroup } from "../features/notes/noteUtils";
import {
  getNoteContextMenuItems,
  type NoteContextMenuAction,
} from "../features/notes/noteContextMenu";
import { openNotepadWindow, toggleTileWindow } from "../features/windows/api";
import {
  closeCurrentWindow,
  minimizeCurrentWindow,
  toggleMaximizeCurrentWindow,
  isCurrentWindowMaximized,
  startCurrentWindowDrag,
} from "../features/windows/controls";
import {
  TILE_WINDOW_CLOSED_EVENT,
  TILE_WINDOW_UNPINNED_EVENT,
  syncPinnedTileIds,
} from "../features/windows/tileWindowEvents";
import {
  browserActivate,
  browserClose,
  browserGetState,
  browserOpen,
  browserSetVisible,
  browserSetWidth,
} from "../features/browser/api";
import { subscribeBrowserState } from "../features/browser/events";
import { DEFAULT_BROWSER_STATE, type BrowserState } from "../features/browser/types";

import { BrowserPanel, type BrowserPanelHandle } from "./BrowserPanel";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

interface NoteMenuState {
  x: number;
  y: number;
  noteId: string;
}

interface CategoryMenuState {
  x: number;
  y: number;
  category: string;
}

export function runEditorUndo(_editor: unknown): boolean {
  return false;
}

export function pinTileButtonTitle(isPinned: boolean): string {
  return isPinned ? "取消钉屏" : "钉到屏幕";
}

interface MainWindowProps {
  initialSettingsOpen?: boolean;
  initialConfig?: AppConfig;
  initialErrorMessage?: string | null;
}

export function MainWindow({
  initialSettingsOpen = false,
  initialConfig = undefined,
  initialErrorMessage = null,
}: MainWindowProps = {}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<NoteMetadata[]>([]);
  const [externalFiles, setExternalFiles] = useState<ExternalFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // --- Tab state ---
  interface TabState {
    noteId: string;
    title: string;
    fileStem: string;
    content: string;
    contentFormat: string; // "markdown" | "html"
    saveState: SaveState;
  }

  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [previewTabId, setPreviewTabId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarPanel>("directory");
  const [browserState, setBrowserState] = useState<BrowserState>(DEFAULT_BROWSER_STATE);
  const [browserWidth, setBrowserWidth] = useState<number>(420);
  const [isResizingBrowser, setIsResizingBrowser] = useState(false);
  const browserPanelRef = useRef<BrowserPanelHandle>(null);
  const browserWidthRef = useRef<number>(420);
  const sidebarTabRef = useRef<SidebarPanel>("directory");
  const browserStateRef = useRef<BrowserState>(DEFAULT_BROWSER_STATE);
  sidebarTabRef.current = sidebarTab;
  browserStateRef.current = browserState;
  const [content, setContent] = useState("");
  const [contentFormat, setContentFormat] = useState<string>("markdown");
  const [title, setTitle] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialErrorMessage);
  const [noteMenu, setNoteMenu] = useState<NoteMenuState | null>(null);
  const [noteMenuClosing, setNoteMenuClosing] = useState(false);
  const [settingsTabActive, setSettingsTabActive] = useState(initialSettingsOpen);
  const [settingsConfig, setSettingsConfig] = useState<AppConfig | null>(initialConfig ?? null);
  const [savedNotesDir, setSavedNotesDir] = useState<string | null>(
    initialConfig?.notesDir ?? null,
  );
  const [noteTransitionKey, setNoteTransitionKey] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteExiting, setDeleteExiting] = useState(false);
  const [pinnedTileIds, setPinnedTileIds] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<string[]>([]);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [showCategoryInput, setShowCategoryInput] = useState(false);
  const [categoryInputValue, setCategoryInputValue] = useState("");
  const [noteMenuMode, setNoteMenuMode] = useState<"main" | "move">("main");
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameCategoryValue, setRenameCategoryValue] = useState("");
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const wysiwygRef = useRef<WysiwygEditorHandle>(null);
  const [categoryMenu, setCategoryMenu] = useState<CategoryMenuState | null>(null);
  const [categoryMenuClosing, setCategoryMenuClosing] = useState(false);
  const [categoryMenuConfirmDelete, setCategoryMenuConfirmDelete] = useState(false);
  const [pendingPathPrompt, setPendingPathPrompt] = useState<{
    filePath: string;
    inputValue: string;
  } | null>(null);
  const [notesDirDropdownOpen, setNotesDirDropdownOpen] = useState(false);
  const [deleteConfirmDir, setDeleteConfirmDir] = useState<string | null>(null);
  const [oneDriveSyncedPaths, setOneDriveSyncedPaths] = useState<string[]>([]);

  const refreshOneDrivePaths = useCallback(async () => {
    try {
      const paths = await getOneDriveSyncedPaths();
      setOneDriveSyncedPaths(paths);
    } catch {
      // Ignore — OneDrive service may not be available.
    }
  }, []);
  const [renameFileFor, setRenameFileFor] = useState<string | null>(null);
  const [renameFileValue, setRenameFileValue] = useState("");
  const externalFileMtimeRef = useRef<number>(0);
  const lastExternalSaveRef = useRef<number>(0);
  const savedHiddenCategoriesRef = useRef<string[] | undefined>(undefined);
  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedId) ?? null,
    [notes, selectedId],
  );
  const selectedNoteRef = useRef(selectedNote);
  selectedNoteRef.current = selectedNote;

  // Extract headings for outline panel and scroll tracking.
  const headings = useMemo(() => {
    if (!content) return [];
    return extractHeadings(content);
  }, [content]);

  // Auto-open outline when user scrolls past a threshold.
  // Only switch to directory when the user scrolls back to the very top (not on heading clicks).
  const AUTO_OUTLINE_SCROLL_PX = 300;
  const outlineTriggeredRef = useRef(false);
  const headingJumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleEditorScroll = useCallback(
    (scrollTop: number) => {
      if (!settingsConfig?.autoOpenOutline) return;
      if (settingsTabActive) return;
      // Suppress revert while a heading-jump scroll animation is in flight
      if (headingJumpTimerRef.current) return;
      if (scrollTop > AUTO_OUTLINE_SCROLL_PX && !outlineTriggeredRef.current) {
        setSidebarTab("outline");
        outlineTriggeredRef.current = true;
      } else if (scrollTop < 4 && outlineTriggeredRef.current) {
        // Only switch back when the user manually scrolls to the absolute top
        setSidebarTab("directory");
        outlineTriggeredRef.current = false;
      }
    },
    [settingsConfig?.autoOpenOutline, settingsTabActive],
  );

  // When clicking a heading, briefly suppress the scroll-to-top revert.
  const handleJumpToHeading = useCallback((lineNumber: number) => {
    wysiwygRef.current?.scrollToHeading(lineNumber);
    if (outlineTriggeredRef.current) {
      if (headingJumpTimerRef.current) clearTimeout(headingJumpTimerRef.current);
      headingJumpTimerRef.current = setTimeout(() => {
        headingJumpTimerRef.current = null;
      }, 800);
    }
  }, []);

  const selectedExternalFile = useMemo(
    () => externalFiles.find((f) => f.id === selectedId) ?? null,
    [externalFiles, selectedId],
  );

  const isExternal = selectedExternalFile !== null;
  const isReadOnlyExternal = selectedExternalFile?.readOnly === true;
  const isReadOnlyInternal = selectedNote ? isReadOnlyNote(selectedNote) : false;

  const noteMenuTarget = useMemo(
    () => notes.find((note) => note.id === noteMenu?.noteId) ?? null,
    [noteMenu?.noteId, notes],
  );
  const noteContextMenuItems = useMemo(() => getNoteContextMenuItems(t), [t]);
  const saveStateLabel = useMemo<Record<SaveState, string>>(
    () => ({
      idle: t("main.statusBar.saveState.idle", { defaultValue: "未选择" }),
      dirty: t("main.statusBar.saveState.dirty", { defaultValue: "未保存" }),
      saving: t("main.statusBar.saveState.saving", { defaultValue: "保存中" }),
      saved: t("main.statusBar.saveState.saved", { defaultValue: "已保存" }),
      error: t("main.statusBar.saveState.error", { defaultValue: "保存失败" }),
    }),
    [t],
  );

  // Derived tab list: inject settings as a virtual tab when active
  const displayTabs = useMemo(() => {
    const noteTabs = tabs.map((t) => ({
      noteId: t.noteId,
      title: t.fileStem || t.title,
      saveState: t.saveState as "idle" | "dirty" | "saving" | "saved" | "error",
      isPreview: t.noteId === previewTabId,
    }));
    if (settingsTabActive) {
      noteTabs.push({
        noteId: "__settings__",
        title: t("settings.title", { defaultValue: "应用设置" }),
        saveState: "idle" as const,
        isPreview: false,
      });
    }
    return noteTabs;
  }, [tabs, settingsTabActive, previewTabId, t]);

  const filteredNotes = useMemo(() => filterNotes(notes, searchQuery), [notes, searchQuery]);

  const categoryGroups = useMemo(
    () => groupNotesByCategory(filteredNotes, categories),
    [filteredNotes, categories],
  );

  const lineCount = useMemo(() => content.split("\n").length, [content]);
  const byteSize = useMemo(
    () => (new TextEncoder().encode(content).length / 1024).toFixed(1),
    [content],
  );
  const charCount = useMemo(() => countNoteChars(content), [content]);

  const replaceNoteMetadata = useCallback((note: Note) => {
    const metadata = metadataFromNote(note);
    setNotes((current) => {
      const exists = current.some((item) => item.id === metadata.id);
      const next = exists
        ? current.map((item) => (item.id === metadata.id ? metadata : item))
        : [metadata, ...current];
      return [...next].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }, []);

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
        t.noteId === activeTabId ? { ...t, content, contentFormat, title, saveState } : t,
      ),
    );
  }, [activeTabId, content, contentFormat, title, saveState]);

  /** Open a note as a tab (or activate if already open) */
  const openTab = useCallback(
    async (noteId: string) => {
      // If tab already exists, just activate (fast path — instant switch)
      const existing = findTab(noteId);
      if (existing) {
        flushActiveTab();
        setActiveTabId(noteId);
        setContent(existing.content);
        setContentFormat(existing.contentFormat);
        setTitle(existing.title);
        setSaveState(existing.saveState);
        setSelectedId(noteId);
        setNoteTransitionKey((k) => k + 1);
        return;
      }

      // New tab: immediately show loading state so UI responds instantly
      flushActiveTab();
      setSelectedId(noteId);
      setActiveTabId(noteId);
      setContent("");
      setTitle("");
      setSaveState("idle");
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const note = await getNote(noteId);
        const newTab: TabState = {
          noteId: note.id,
          title: note.title,
          fileStem: note.fileStem,
          content: note.content,
          contentFormat: note.fileFormat && note.fileFormat !== "md" ? "html" : "markdown",
          saveState: "saved" as SaveState,
        };
        setTabs((prev) => [...prev, newTab]);
        setContent(note.content);
        setContentFormat(newTab.contentFormat);
        setTitle(note.title);
        setSaveState("saved");
        setNoteTransitionKey((k) => k + 1);
        replaceNoteMetadata(note);
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
        // Clean up on error: remove from tabs and reset selection
        setTabs((prev) => prev.filter((t) => t.noteId !== noteId));
        setActiveTabId(null);
        setSelectedId(null);
        setContent("");
        setTitle("");
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

      if (tab.saveState === "dirty") {
        const confirmed = window.confirm(
          t("tabs.unsavedConfirm", {
            defaultValue: `"${tab.title || "无标题"}" 有未保存的更改，是否关闭？`,
          }),
        );
        if (!confirmed) return;
      }

      setTabs((prev) => prev.filter((t) => t.noteId !== noteId));

      // If closing the preview tab, clear the preview marker
      if (previewTabId === noteId) {
        setPreviewTabId(null);
      }

      if (noteId === activeTabId) {
        // Need to compute from the updated tabs — use a local snapshot
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
          toClose = toClose.filter((id) => !dirtyClosing.includes(id));
        }
      }

      // Close tabs
      for (const id of toClose) {
        setTabs((prev) => prev.filter((t) => t.noteId !== id));
      }

      // If active tab was among closed, switch to a remaining one
      if (activeTabId && toClose.includes(activeTabId)) {
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
    [activeTabId, t, tabs],
  );

  // Sync saveState changes back to active tab
  useEffect(() => {
    if (!activeTabId) return;
    setTabs((prev) => prev.map((t) => (t.noteId === activeTabId ? { ...t, saveState } : t)));
  }, [activeTabId, saveState]);

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

  const applyNote = useCallback((note: Note) => {
    setSelectedId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setContentFormat(note.fileFormat && note.fileFormat !== "md" ? "html" : "markdown");
    setSaveState("saved");
    setErrorMessage(null);
    setNoteTransitionKey((k) => k + 1);
  }, []);

  const loadNote = useCallback(
    async (id: string) => {
      setErrorMessage(null);
      const note = await getNote(id);
      applyNote(note);
      replaceNoteMetadata(note);
    },
    [applyNote, replaceNoteMetadata],
  );

  const refreshNotes = useCallback(async () => {
    const [loadedNotes, loadedCategories] = await Promise.all([listNotes(), listCategories()]);
    setNotes(loadedNotes);
    setCategories(loadedCategories);
    return loadedNotes;
  }, []);

  const clearCurrentNote = useCallback(() => {
    setSelectedId(null);
    setTitle("");
    setContent("");
    setContentFormat("markdown");
    setSaveState("idle");
  }, []);

  const loadExternalFile = useCallback(async (filePath: string) => {
    setErrorMessage(null);
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    const displayTitle = fileName.replace(/\.(md|txt|docx?|pdf|xlsx)$/i, "");
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    const isReadOnlyFormat = /^(docx?|pdf|xlsx)$/i.test(ext);

    // Add the file to the external files list immediately so it's visible
    // even if reading fails (user can retry by clicking).
    setExternalFiles((current) => {
      if (current.some((f) => f.id === filePath)) {
        return current;
      }
      const entry: ExternalFile = {
        id: filePath,
        title: displayTitle,
        filePath,
        readOnly: isReadOnlyFormat,
      };
      if (isReadOnlyFormat) {
        entry.contentFormat = "html";
        entry.mimeType =
          ext === "docx" || ext === "doc"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : ext === "pdf"
              ? "application/pdf"
              : ext === "xlsx"
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : "application/octet-stream";
      }
      return [...current, entry];
    });
    setSelectedId(filePath);
    setTitle(displayTitle);

    try {
      if (isReadOnlyFormat) {
        // Open with system default app (WPS/Word/Excel/PDF reader)
        setContent("");
        setSaveState("saved");
        try {
          await openFileWithSystemApp(filePath);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      } else {
        const [fileContent, mtime] = await Promise.all([
          readExternalFile(filePath),
          getFileModifiedTime(filePath),
        ]);
        setContent(fileContent);
        externalFileMtimeRef.current = mtime;
      }
      setSaveState("saved");
      setNoteTransitionKey((k) => k + 1);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      setSaveState("error");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setIsLoading(true);
      try {
        const [loadedConfig, loadedNotes, loadedCategories] = await Promise.all([
          getConfig(),
          listNotes(),
          listCategories(),
        ]);
        if (cancelled) return;
        // Normalize defaultViewMode through the same function used by persistSettings
        const patchedConfig: AppConfig = {
          ...loadedConfig,
          defaultViewMode: normalizeViewMode(loadedConfig.defaultViewMode),
          tabLayout: (loadedConfig.tabLayout ??
            localStorage.getItem("fn:tabLayout") ??
            "compact") as "compact" | "default",
          autoOpenOutline:
            loadedConfig.autoOpenOutline ?? localStorage.getItem("fn:autoOpenOutline") === "1",
        };
        setSettingsConfig(patchedConfig);
        setSavedNotesDir(patchedConfig.notesDir ?? null);
        setNotes(loadedNotes);
        setCategories(loadedCategories);
        setCollapsedCategories(new Set(loadedCategories));

        // Restore persisted tabs, or fall back to loading the first note
        const persistedTabs = loadedConfig.openTabs;
        if (persistedTabs && persistedTabs.length > 0) {
          const restoredTabs: TabState[] = [];
          for (const tabId of persistedTabs) {
            const meta = loadedNotes.find((n) => n.id === tabId);
            if (!meta) continue;
            try {
              const note = await getNote(tabId);
              restoredTabs.push({
                noteId: note.id,
                title: note.title,
                fileStem: note.fileStem,
                content: note.content,
                contentFormat: note.fileFormat && note.fileFormat !== "md" ? "html" : "markdown",
                saveState: "saved" as SaveState,
              });
            } catch {
              // Note may have been deleted — skip
            }
          }
          if (restoredTabs.length > 0 && !cancelled) {
            setTabs(restoredTabs);
            const restoreActiveId =
              loadedConfig.activeTabId &&
              restoredTabs.some((t) => t.noteId === loadedConfig.activeTabId)
                ? loadedConfig.activeTabId
                : restoredTabs[0].noteId;
            const activeTab = restoredTabs.find((t) => t.noteId === restoreActiveId)!;
            setActiveTabId(activeTab.noteId);
            setSelectedId(activeTab.noteId);
            setContent(activeTab.content);
            setContentFormat(activeTab.contentFormat);
            setTitle(activeTab.title);
            setSaveState("saved");
          }
        } else if (loadedNotes[0]) {
          const note = await getNote(loadedNotes[0].id);
          if (!cancelled) applyNote(note);
        } else {
          clearCurrentNote();
        }
      } catch (error) {
        if (!cancelled) setErrorMessage(getErrorMessage(error));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applyNote, clearCurrentNote]);

  useEffect(() => {
    const unlisten = listen("notes-changed", () => {
      void refreshNotes().then((loaded) => {
        const currentId = selectedIdRef.current;
        if (!currentId) return;
        const stillExists = loaded.some((n) => n.id === currentId);
        if (stillExists) {
          if (saveStateRef.current !== "dirty") {
            void getNote(currentId)
              .then((note) => {
                if (selectedIdRef.current !== currentId) return;
                setTitle(note.title);
                setContent(note.content);
                setSaveState("saved");
              })
              .catch(() => undefined);
          }
        } else if (selectedNoteRef.current) {
          if (loaded[0]) {
            void loadNote(loaded[0].id);
          } else {
            clearCurrentNote();
          }
        }
      });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refreshNotes, loadNote, clearCurrentNote]);

  useEffect(() => {
    function handleFocus() {
      void refreshNotes();
    }
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshNotes]);

  useEffect(() => {
    const unlisten = listen<string>("open-external-file", (event) => {
      // Always open as external file first
      void loadExternalFile(event.payload);
      // Then check if we should prompt to record the directory
      void classifyOpenedFile(event.payload)
        .then((result) => {
          if (!result.known) {
            const suggestedDir = parentDirFromFilePath(event.payload);
            setPendingPathPrompt({
              filePath: event.payload,
              inputValue: suggestedDir || event.payload,
            });
          }
        })
        .catch(() => {});
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [loadExternalFile]);

  useEffect(() => {
    const unlisten = listen<string>("open-note", (event) => {
      void loadNote(event.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [loadNote]);

  useEffect(() => {
    const unlisten = listen<string>("shortcut-register-failed", (event) => {
      setErrorMessage(event.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<string>(TILE_WINDOW_CLOSED_EVENT, (event) => {
      setPinnedTileIds((previous) => syncPinnedTileIds(previous, event.payload, false));
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<string>(TILE_WINDOW_UNPINNED_EVENT, (event) => {
      setPinnedTileIds((previous) => syncPinnedTileIds(previous, event.payload, false));
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!selectedExternalFile) return;

    const interval = window.setInterval(async () => {
      if (Date.now() - lastExternalSaveRef.current < 2000) return;
      // Read-only files are opened with system app — skip polling content
      if (selectedExternalFile.readOnly) return;
      try {
        const mtime = await getFileModifiedTime(selectedExternalFile.filePath);
        if (mtime !== externalFileMtimeRef.current) {
          externalFileMtimeRef.current = mtime;
          const fileContent = await readExternalFile(selectedExternalFile.filePath);
          setContent(fileContent);
          setSaveState("saved");
        }
      } catch {
        // file may have been deleted or become inaccessible
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [selectedExternalFile]);

  useEffect(() => {
    // Reset sidebar tab when switching notes.
    setSidebarTab("directory");
  }, [selectedId]);

  // Trigger tab-switch animation on the editor container without re-mounting
  useEffect(() => {
    const el = splitContainerRef.current;
    if (!el || !selectedId) return;
    el.classList.remove("animate-tab-switch");
    // Force reflow to restart the animation
    void (el as HTMLElement).offsetWidth;
    el.classList.add("animate-tab-switch");
  }, [noteTransitionKey]);

  useEffect(() => {
    function closeMenus() {
      setNoteMenuClosing(true);
      setCategoryMenuClosing(true);
      setNotesDirDropdownOpen(false);
      setDeleteConfirmDir(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenus();
    }

    document.addEventListener("mousedown", closeMenus);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", closeMenus);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!noteMenuClosing || !noteMenu) return;
    const timer = window.setTimeout(() => {
      setNoteMenu(null);
      setNoteMenuClosing(false);
      setNoteMenuMode("main");
    }, 150);
    return () => window.clearTimeout(timer);
  }, [noteMenuClosing, noteMenu]);

  useEffect(() => {
    if (!categoryMenuClosing || !categoryMenu) return;
    const timer = window.setTimeout(() => {
      setCategoryMenu(null);
      setCategoryMenuClosing(false);
      setCategoryMenuConfirmDelete(false);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [categoryMenuClosing, categoryMenu]);

  const saveCurrentNote = useCallback(async () => {
    if (!selectedId) return null;

    // Read-only files cannot be saved
    if (selectedExternalFile?.readOnly || isReadOnlyInternal) {
      return null;
    }

    if (isExternal && selectedExternalFile) {
      setSaveState("saving");
      try {
        await saveExternalFile(selectedExternalFile.filePath, content);
        lastExternalSaveRef.current = Date.now();
        const mtime = await getFileModifiedTime(selectedExternalFile.filePath);
        externalFileMtimeRef.current = mtime;
        setSaveState("saved");
        setTabs((prev) =>
          prev.map((t) =>
            t.noteId === selectedId ? { ...t, title, saveState: "saved" as SaveState } : t,
          ),
        );
        setErrorMessage(null);
        return { id: selectedId, title, content } as Note;
      } catch (error) {
        setSaveState("error");
        setErrorMessage(getErrorMessage(error));
        return null;
      }
    }

    setSaveState("saving");
    try {
      const category = selectedNote?.category ?? "";
      const note = await updateNote(selectedId, { title, content, category });
      replaceNoteMetadata(note);
      setSaveState("saved");
      setTabs((prev) =>
        prev.map((t) =>
          t.noteId === note.id ? { ...t, title: note.title, saveState: "saved" as SaveState } : t,
        ),
      );
      // Saving promotes preview tab to permanent
      if (previewTabId === note.id) {
        setPreviewTabId(null);
      }
      setErrorMessage(null);
      return note;
    } catch (error) {
      setSaveState("error");
      setErrorMessage(getErrorMessage(error));
      return null;
    }
  }, [
    content,
    isExternal,
    replaceNoteMetadata,
    selectedExternalFile,
    selectedId,
    selectedNote,
    title,
  ]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        void saveCurrentNote();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [saveCurrentNote]);

  useEffect(() => {
    if (!selectedId || saveState !== "dirty") return undefined;
    if (isExternal) {
      if (!settingsConfig?.externalFileAutoSave) return undefined;
    } else {
      if (!settingsConfig?.noteAutoSave) return undefined;
    }

    const timer = window.setTimeout(() => {
      void saveCurrentNote();
    }, 900);

    return () => window.clearTimeout(timer);
  }, [
    isExternal,
    saveCurrentNote,
    saveState,
    selectedId,
    settingsConfig?.noteAutoSave,
    settingsConfig?.externalFileAutoSave,
  ]);

  const handleNewNote = async () => {
    setErrorMessage(null);
    if (saveState === "dirty") {
      await saveCurrentNote();
    }
    try {
      const note = await createNote({ title: "", content: "", category: activeCategory });
      replaceNoteMetadata(note);
      // Open as new tab (permanent, not preview)
      flushActiveTab();
      setPreviewTabId(null);
      const newTab: TabState = {
        noteId: note.id,
        title: note.title,
        fileStem: note.fileStem,
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

  const toggleSettingsTab = useCallback(async () => {
    // Always open settings; never toggle-close. Close via tab or note selection.
    if (settingsTabActive) return;
    setSettingsTabActive(true);
    if (settingsConfig) return;

    setErrorMessage(null);
    try {
      const config = await getConfig();
      setSettingsConfig(config);
      setSavedNotesDir(config.notesDir ?? null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }, [settingsTabActive, settingsConfig]);

  const handleChooseNotesDir = async () => {
    setErrorMessage(null);
    try {
      const notesDir = await chooseNotesDirectory();
      if (!notesDir) return;
      await switchNotesDir(notesDir, true);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const settingsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistSettings = useCallback(
    (nextConfig: AppConfig) => {
      if (settingsSaveTimer.current) {
        clearTimeout(settingsSaveTimer.current);
      }
      settingsSaveTimer.current = setTimeout(async () => {
        const previousNotesDir = savedNotesDir ?? nextConfig.notesDir;
        const normalizedConfig = {
          ...nextConfig,
          defaultViewMode: normalizeViewMode(nextConfig.defaultViewMode),
          tileColor: normalizeTileColor(nextConfig.tileColor),
        };
        try {
          const savedConfig = await saveConfig(normalizedConfig);
          setSettingsConfig(savedConfig);
          setSavedNotesDir(savedConfig.notesDir ?? null);

          const notesDirChanged = savedConfig.notesDir !== previousNotesDir;
          const hiddenChanged =
            (savedConfig.hiddenCategories ?? []).join(",") !==
            (savedHiddenCategoriesRef.current ?? []).join(",");
          savedHiddenCategoriesRef.current = savedConfig.hiddenCategories;

          if (notesDirChanged || hiddenChanged) {
            const loadedNotes = await refreshNotes();
            if (loadedNotes[0]) {
              await loadNote(loadedNotes[0].id);
            } else {
              clearCurrentNote();
            }
          }
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      }, 300);
    },
    [savedNotesDir, refreshNotes, loadNote, clearCurrentNote],
  );

  const handleSettingsChange = useCallback(
    (nextConfig: AppConfig) => {
      setSettingsConfig(nextConfig);
      void emit("config-changed", nextConfig);
      persistSettings(nextConfig);
    },
    [persistSettings],
  );

  const handleImportNote = async () => {
    setErrorMessage(null);
    try {
      if (selectedId && saveState === "dirty") {
        const saved = await saveCurrentNote();
        if (!saved) return;
      }

      const note = await importMarkdownNote(activeCategory);
      if (!note) return;

      replaceNoteMetadata(note);
      applyNote(note);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleSelectNote = async (id: string) => {
    if (id === activeTabId) return;
    setSettingsTabActive(false);
    setDeleteConfirm(false);
    if (saveState === "dirty") {
      await saveCurrentNote();
    }

    // Non-md files: open with system default app instead of loading in-app
    const note = notes.find((n) => n.id === id);
    if (note && isReadOnlyNote(note)) {
      setErrorMessage(null);
      setSelectedId(id);
      setTitle(note.fileStem || note.title);
      setContent("");
      setSaveState("saved");
      setNoteTransitionKey((k) => k + 1);
      try {
        await openNoteWithSystemApp(id);
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      }
      return;
    }

    // Single click → preview tab (italic, reused).
    // If the target note already has a permanent tab, just switch to it —
    // keep the preview tab around for future single-click overwrites.
    const existingTab = findTab(id);
    if (existingTab && previewTabId !== id) {
      flushActiveTab();
      setActiveTabId(id);
      setContent(existingTab.content);
      setContentFormat(existingTab.contentFormat);
      setTitle(existingTab.title);
      setSaveState(existingTab.saveState);
      setSelectedId(id);
      setNoteTransitionKey((k) => k + 1);
      return;
    }

    if (previewTabId) {
      // Reuse the existing preview tab: replace its content with the new note
      await replacePreviewTab(id);
      return;
    }

    // No preview tab yet: open as preview
    flushActiveTab();
    await openTab(id);
    setPreviewTabId(id);
  };

  /** Replace the current preview tab with a different note */
  const replacePreviewTab = useCallback(
    async (noteId: string) => {
      flushActiveTab();
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const note = await getNote(noteId);
        setTabs((prev) =>
          prev.map((t) =>
            t.noteId === previewTabId
              ? {
                  noteId: note.id,
                  title: note.title,
                  fileStem: note.fileStem,
                  content: note.content,
                  contentFormat: note.fileFormat && note.fileFormat !== "md" ? "html" : "markdown",
                  saveState: "saved" as SaveState,
                }
              : t,
          ),
        );
        setPreviewTabId(note.id);
        setActiveTabId(note.id);
        setSelectedId(note.id);
        setContent(note.content);
        setContentFormat(note.fileFormat && note.fileFormat !== "md" ? "html" : "markdown");
        setTitle(note.title);
        setSaveState("saved");
        setNoteTransitionKey((k) => k + 1);
        replaceNoteMetadata(note);
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      } finally {
        setIsLoading(false);
      }
    },
    [flushActiveTab, previewTabId, replaceNoteMetadata],
  );

  /** Double-click → permanent tab (or promote preview) */
  const handleDoubleClickNote = async (id: string) => {
    // If already the active permanent tab, nothing to do
    if (id === activeTabId && previewTabId !== id) return;
    setSettingsTabActive(false);
    setDeleteConfirm(false);
    if (saveState === "dirty") {
      await saveCurrentNote();
    }

    // Non-md files: same as single click
    const note = notes.find((n) => n.id === id);
    if (note && isReadOnlyNote(note)) {
      setErrorMessage(null);
      setSelectedId(id);
      setTitle(note.fileStem || note.title);
      setContent("");
      setSaveState("saved");
      setNoteTransitionKey((k) => k + 1);
      try {
        await openNoteWithSystemApp(id);
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      }
      return;
    }

    // Double-click promotes preview → permanent (or opens as permanent)
    setPreviewTabId(null);
    flushActiveTab();
    await openTab(id);
  };

  const handleSelectExternalFile = async (id: string) => {
    if (id === selectedId) return;
    setSettingsTabActive(false);
    setDeleteConfirm(false);
    if (saveState === "dirty") {
      await saveCurrentNote();
    }

    const file = externalFiles.find((f) => f.id === id);
    if (!file) return;

    setIsLoading(true);
    try {
      if (file.readOnly) {
        // Open with system default app
        setSelectedId(id);
        setTitle(file.title);
        setContent("");
        setSaveState("saved");
        setErrorMessage(null);
        try {
          await openFileWithSystemApp(file.filePath);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
        return;
      }

      const [fileContent, mtime] = await Promise.all([
        readExternalFile(file.filePath),
        getFileModifiedTime(file.filePath),
      ]);

      setSelectedId(id);
      setTitle(file.title);
      setContent(fileContent);
      setSaveState("saved");
      setErrorMessage(null);
      setNoteTransitionKey((k) => k + 1);
      externalFileMtimeRef.current = mtime;
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveExternalFile = async (id: string) => {
    if (selectedId === id && saveState === "dirty") {
      const shouldSave = window.confirm(
        t("main.confirm.unsavedExternalFile", {
          title: title || t("common.untitledFile", { defaultValue: "未命名文件" }),
          defaultValue: "「{{title}}」有未保存的更改，是否保存到原文件？",
        }),
      );
      if (shouldSave) {
        const saved = await saveCurrentNote();
        if (!saved) return;
      }
    }
    setExternalFiles((current) => current.filter((f) => f.id !== id));
    if (selectedId === id) {
      clearCurrentNote();
    }
  };

  const handleDeleteNote = async (noteId = selectedId) => {
    if (!noteId) return;

    setDeleteConfirm(false);
    setErrorMessage(null);
    try {
      await deleteNote(noteId);
      // Close tab for deleted note
      setTabs((prev) => prev.filter((t) => t.noteId !== noteId));
      const remaining = await refreshNotes();
      if (noteId === activeTabId) {
        if (remaining[0]) {
          await openTab(remaining[0].id);
        } else {
          setActiveTabId(null);
          setSelectedId(null);
          setContent("");
          setContentFormat("markdown");
          setTitle("");
          setSaveState("idle");
        }
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleOpenNoteMenu = (event: MouseEvent<HTMLElement>, noteId: string) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 168;
    const menuHeight = 76;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - 4);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - 4);

    setNoteMenuClosing(false);
    setHoveredId(noteId);
    setNoteMenu({
      x: Math.max(4, x),
      y: Math.max(4, y),
      noteId,
    });
  };

  const handleExportNote = async (note: NoteMetadata) => {
    setErrorMessage(null);
    try {
      if (note.id === selectedId && saveState === "dirty") {
        const saved = await saveCurrentNote();
        if (!saved) return;
      }

      await exportMarkdownNote({
        id: note.id,
        title: note.id === selectedId ? title : note.title,
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleNoteMenuAction = (action: NoteContextMenuAction) => {
    const note = noteMenuTarget;
    if (!note) return;

    if (action === "export") {
      setNoteMenuClosing(true);
      void handleExportNote(note);
      return;
    }

    if (action === "move") {
      setNoteMenuMode("move");
      return;
    }

    if (action === "openFileLocation") {
      setNoteMenuClosing(true);
      const notesDir = savedNotesDir || settingsConfig?.notesDir;
      if (!notesDir) return;
      const filePath = note.category
        ? `${notesDir}/${note.category}/${note.fileName}`
        : `${notesDir}/${note.fileName}`;
      revealItemInDir(filePath).catch((err) => {
        setErrorMessage(getErrorMessage(err));
      });
      return;
    }

    setNoteMenuClosing(true);
    void handleDeleteNote(note.id);
  };

  const handleMoveNote = async (noteId: string, targetCategory: string) => {
    setNoteMenuClosing(true);
    setErrorMessage(null);
    try {
      await moveNoteCategory(noteId, targetCategory);
      await refreshNotes();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const switchNotesDir = async (path: string, addToCache = true) => {
    if (saveState === "dirty" && selectedId) {
      await saveCurrentNote();
    }
    setErrorMessage(null);
    try {
      const savedConfig = await selectNotesDir(path, addToCache);
      setSettingsConfig(savedConfig);
      setSavedNotesDir(savedConfig.notesDir ?? null);
      const loaded = await refreshNotes();
      if (loaded[0]) {
        await loadNote(loaded[0].id);
      } else {
        clearCurrentNote();
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleDeleteNotesDir = async (path: string) => {
    setDeleteConfirmDir(null);
    setNotesDirDropdownOpen(false);
    setErrorMessage(null);
    try {
      const savedConfig = await deleteNotesDir(path);
      setSettingsConfig(savedConfig);
      setSavedNotesDir(savedConfig.notesDir ?? null);
      const loaded = await refreshNotes();
      if (loaded[0]) {
        await loadNote(loaded[0].id);
      } else {
        clearCurrentNote();
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleCreateCategory = async () => {
    const name = categoryInputValue.trim();
    if (!name) {
      setShowCategoryInput(false);
      return;
    }
    setErrorMessage(null);
    try {
      await createCategory(name);
      setCategories((prev) => [...prev, name].sort());
      setShowCategoryInput(false);
      setCategoryInputValue("");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleRenameCategory = async (oldName: string) => {
    const newName = renameCategoryValue.trim();
    if (!newName || newName === oldName) {
      setRenamingCategory(null);
      return;
    }
    setErrorMessage(null);
    try {
      await renameCategory(oldName, newName);
      await refreshNotes();
      setRenamingCategory(null);
      setRenameCategoryValue("");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleDeleteCategory = async (name: string) => {
    setErrorMessage(null);
    try {
      await deleteCategory(name);
      await refreshNotes();
      if (activeCategory === name) {
        setActiveCategory("");
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const toggleCategoryCollapse = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const markDirty = () => {
    if (selectedId) setSaveState("dirty");
  };

  const handleUndo = () => {
    if (!selectedId) return;
    // Undo is handled natively by CodeMirror in source mode
    markDirty();
  };

  const handleOpenNotepad = async () => {
    setErrorMessage(null);
    try {
      await openNotepadWindow();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    void isCurrentWindowMaximized().then(setIsMaximized);
  }, []);

  useEffect(() => {
    if (!isResizingSidebar) return;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (e: globalThis.MouseEvent) => {
      const newWidth = Math.min(Math.max(e.clientX, 180), 500);
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => setIsResizingSidebar(false);

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizingSidebar]);

  // --- 浏览器侧边栏 ---

  // 订阅 Rust 侧浏览器状态（唯一数据源）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void subscribeBrowserState((state) => {
      setBrowserState(state);
      setBrowserWidth(state.dockWidth);
    }).then((fn) => {
      unlisten = fn;
    });
    void browserGetState()
      .then((state) => {
        setBrowserState(state);
        setBrowserWidth(state.dockWidth);
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  // 展开浏览列时让停靠子窗口可见
  useEffect(() => {
    if (sidebarTab === "browser") {
      void browserSetVisible(true);
    }
  }, [sidebarTab]);

  // 浏览列宽度拖拽（300px 至主窗口宽 60%）
  useEffect(() => {
    if (!isResizingBrowser) return;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (e: globalThis.MouseEvent) => {
      const maxWidth = Math.max(window.innerWidth * 0.6, 300);
      const next = Math.min(Math.max(window.innerWidth - e.clientX, 300), maxWidth);
      browserWidthRef.current = next;
      setBrowserWidth(next);
    };
    const onMouseUp = () => {
      setIsResizingBrowser(false);
      void browserSetWidth(browserWidthRef.current).catch(() => {});
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizingBrowser]);

  // 侧边栏面板选择：浏览器图标展开/收回浏览列，切其他面板时收回浏览列
  const handleSidebarSelect = useCallback((panel: SidebarPanel) => {
    if (panel === "browser") {
      if (sidebarTabRef.current === "browser") {
        setSidebarTab("directory");
        void browserSetVisible(false).catch(() => {});
      } else {
        setSidebarTab("browser");
      }
      return;
    }
    setSidebarTab(panel);
    void browserSetVisible(false).catch(() => {});
  }, []);

  // 笔记正文链接 → 侧边栏浏览器
  const openBrowserTab = useCallback((href: string) => {
    setSidebarTab("browser");
    void browserOpen(href).catch(() => {});
  }, []);

  // 浏览器快捷键（浏览列展开时）：Ctrl+W 关标签、Ctrl+Tab 切换、Ctrl+L 聚焦地址栏
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (sidebarTabRef.current !== "browser") return;
      if (!(event.ctrlKey || event.metaKey)) return;

      const target = event.target as HTMLElement | null;
      const isEditing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;

      if (event.key.toLowerCase() === "w") {
        if (isEditing) return;
        event.preventDefault();
        const tabId = browserStateRef.current.activeTabId;
        if (tabId) void browserClose(tabId).catch(() => {});
      } else if (event.key.toLowerCase() === "l") {
        event.preventDefault();
        browserPanelRef.current?.focusAddressBar();
      } else if (event.key === "Tab") {
        if (isEditing) return;
        event.preventDefault();
        const tabs = browserStateRef.current.tabs;
        if (tabs.length === 0) return;
        const activeIndex = tabs.findIndex((tab) => tab.active);
        const nextIndex = event.shiftKey
          ? (activeIndex - 1 + tabs.length) % tabs.length
          : (activeIndex + 1) % tabs.length;
        void browserActivate(tabs[nextIndex].tabId).catch(() => {});
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handlePinEntry = async () => {
    if (!selectedId) return;
    const isPinned = pinnedTileIds.has(selectedId);
    if (!isPinned && saveState === "dirty") {
      await saveCurrentNote();
    }

    setErrorMessage(null);
    try {
      const pinned = await toggleTileWindow(selectedId);
      setPinnedTileIds((previous) => {
        return syncPinnedTileIds(previous, selectedId, pinned);
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const selectedTilePinned = selectedId ? pinnedTileIds.has(selectedId) : false;

  const handleTitleBarDrag = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    void startCurrentWindowDrag().catch(() => undefined);
  };

  const toggleMaximize = () => {
    void toggleMaximizeCurrentWindow().then(() => isCurrentWindowMaximized().then(setIsMaximized));
  };

  const handleTitleBarDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    toggleMaximize();
  };

  const handleMinimize = () => {
    void minimizeCurrentWindow();
  };

  const handleMaximize = () => {
    toggleMaximize();
  };

  const handleClose = () => {
    void closeCurrentWindow();
  };

  return (
    <div className="w-full h-screen flex flex-col">
      <div className="relative noise-bg bg-cloud flex flex-col flex-1 min-h-0">
        <BackgroundLayer config={settingsConfig} />
        <div
          className="relative z-20 flex items-center pr-0 h-11 bg-paper/55 backdrop-blur-[1px] border-b border-paper-deep/30 shrink-0 select-none cursor-default"
          onMouseDown={handleTitleBarDrag}
          onDoubleClick={handleTitleBarDoubleClick}
        >
          {(() => {
            const isCompact = (settingsConfig?.tabLayout as string) !== "default";
            return (
              <>
                {/* LEFT: compact window controls — slide in/out */}
                <div
                  className={`shrink-0 min-w-0 overflow-hidden transition-[max-width,opacity] duration-300 ease-in-out ${
                    isCompact ? "max-w-[132px] opacity-100" : "max-w-0 opacity-0"
                  }`}
                >
                  <div className="flex items-center pl-1">
                    <button
                      onClick={handleClose}
                      className="w-9 h-9 flex items-center justify-center rounded-full text-ink-ghost hover:text-red-500 hover:bg-danger-bg transition-all cursor-pointer"
                      title={t("main.window.close", { defaultValue: "关闭" })}
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      >
                        <path d="M2 2l8 8M10 2l-8 8" />
                      </svg>
                    </button>
                    <button
                      onClick={handleMinimize}
                      className="w-9 h-9 flex items-center justify-center rounded-full text-ink-ghost hover:text-ink-soft hover:bg-paper-warm transition-all cursor-pointer"
                      title={t("main.window.minimize", { defaultValue: "最小化" })}
                    >
                      <svg width="10" height="10" viewBox="0 0 12 12">
                        <rect x="1" y="5.5" width="10" height="1" fill="currentColor" rx="0.5" />
                      </svg>
                    </button>
                    <button
                      onClick={handleMaximize}
                      className="w-9 h-9 flex items-center justify-center rounded-full text-ink-ghost hover:text-ink-soft hover:bg-paper-warm transition-all cursor-pointer"
                      title={
                        isMaximized
                          ? t("main.window.restore", { defaultValue: "还原" })
                          : t("main.window.maximize", { defaultValue: "最大化" })
                      }
                    >
                      {isMaximized ? (
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.2"
                        >
                          <rect x="3" y="3" width="7" height="7" rx="1" />
                          <path d="M3 5H2V2a1 1 0 0 1 1-1h5v1" />
                        </svg>
                      ) : (
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.2"
                        >
                          <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* Folder selector (compact only) */}
                {isCompact && (
                  <div
                    className="shrink-0 flex items-center"
                    style={{ width: `${Math.max(sidebarWidth - 76, 130)}px`, paddingLeft: 8 }}
                  >
                    {settingsConfig && (
                      <div className="flex items-center gap-1.5 w-full">
                        <div className="relative flex-1 min-w-0">
                          <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => {
                              setDeleteConfirmDir(null);
                              setNotesDirDropdownOpen((prev) => !prev);
                              void refreshOneDrivePaths();
                            }}
                            className="w-full flex items-center gap-1 h-7 rounded-lg text-[11px] font-body bg-paper-warm/80 border border-paper-deep/40 pl-2.5 pr-1.5 hover:border-bamboo/30 hover:bg-cloud transition-colors cursor-pointer"
                            title={t("main.notesDir.select", { defaultValue: "切换笔记目录" })}
                          >
                            <span className="flex-1 truncate text-left text-ink-faint">
                              {displayPathLabel(settingsConfig.notesDir ?? "")}
                            </span>
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className={`text-ink-ghost shrink-0 transition-transform duration-200 ${notesDirDropdownOpen ? "rotate-180" : ""}`}
                            >
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </button>
                          <div
                            onMouseDown={(e) => e.stopPropagation()}
                            className={`absolute top-full left-0 right-0 mt-1 z-[9999] bg-cloud border border-paper-deep/40 rounded-xl shadow-lg overflow-hidden py-1 transition-all duration-200 origin-top ${notesDirDropdownOpen ? "opacity-100 scale-y-100" : "opacity-0 scale-y-95 pointer-events-none"}`}
                          >
                            {(settingsConfig.notesDirs ?? [settingsConfig.notesDir]).map((dir) => {
                              const isCurrent = dir === settingsConfig.notesDir;
                              return (
                                <div key={dir} className="flex items-center">
                                  {deleteConfirmDir === dir ? (
                                    <div className="flex-1">
                                      <div className="px-3 py-1.5 text-[10px] font-body text-ink-faint border-b border-paper-deep/20">
                                        {t("main.notesDir.confirmDelete", {
                                          path: displayPathLabel(dir),
                                          defaultValue: "确认删除「{{path}}」？",
                                        })}
                                      </div>
                                      <div className="flex">
                                        <button
                                          onClick={() => void handleDeleteNotesDir(dir)}
                                          className="flex-1 text-center px-2 py-1.5 text-[11px] font-body text-red-400 hover:bg-danger-bg hover:text-red-500 transition-colors cursor-pointer"
                                        >
                                          {t("main.notesDir.confirmDeleteAction", {
                                            defaultValue: "确认删除",
                                          })}
                                        </button>
                                        <button
                                          onClick={() => setDeleteConfirmDir(null)}
                                          className="flex-1 text-center px-2 py-1.5 text-[11px] font-body text-ink-soft hover:bg-paper-warm transition-colors cursor-pointer"
                                        >
                                          {t("common.cancel", { defaultValue: "取消" })}
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        setNotesDirDropdownOpen(false);
                                        void switchNotesDir(dir);
                                      }}
                                      className={`flex-1 text-left truncate px-3 py-1.5 text-[11px] font-mono transition-colors cursor-pointer ${isCurrent ? "text-bamboo font-medium bg-bamboo-mist/30" : "text-ink-faint hover:text-ink-soft hover:bg-paper-warm/60"}`}
                                    >
                                      <span className="flex items-center gap-1.5">
                                        {oneDriveSyncedPaths.includes(dir) && (
                                          <svg
                                            width="11"
                                            height="11"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.7"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="shrink-0 opacity-60"
                                          >
                                            <path d="M6.5 17.5c-2.3-.5-4-2.5-4-4.9 0-3 2.3-5 5-4.8.8-2.7 3.3-4.5 6.1-4.1a5.2 5.2 0 0 1 3.6 2.1c2.7.2 4.8 2.6 4.8 5.3 0 2.3-1.3 4.2-3.2 5.1" />
                                            <path d="M9 19a3 3 0 0 0 6 0" />
                                            <path d="M12 16v3" />
                                          </svg>
                                        )}
                                        {displayPathLabel(dir)}
                                      </span>
                                    </button>
                                  )}
                                  {!isCurrent && deleteConfirmDir !== dir && (
                                    <button
                                      onClick={() => setDeleteConfirmDir(dir)}
                                      className="shrink-0 w-6 h-6 flex items-center justify-center opacity-30 hover:opacity-100 text-ink-ghost hover:text-red-400 hover:bg-danger-bg rounded transition-all cursor-pointer mr-0.5"
                                      title={t("common.delete", { defaultValue: "删除" })}
                                    >
                                      <svg
                                        width="10"
                                        height="10"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2.5"
                                        strokeLinecap="round"
                                      >
                                        <path d="M18 6L6 18M6 6l12 12" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            void handleChooseNotesDir();
                          }}
                          className="h-7 w-7 flex items-center justify-center rounded-lg text-[10px] text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 transition-colors cursor-pointer shrink-0"
                          title={t("main.notesDir.add", { defaultValue: "添加目录" })}
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
                    )}
                  </div>
                )}

                {/* Compact TabBar (in titlebar) */}
                <div className={`flex-1 min-w-0 overflow-hidden ${isCompact ? "" : "hidden"}`}>
                  <TabBar
                    tabs={displayTabs}
                    activeTabId={settingsTabActive ? "__settings__" : activeTabId}
                    onSelectTab={(noteId) => {
                      if (noteId === "__settings__") return;
                      setSettingsTabActive(false);
                      flushActiveTab();
                      void openTab(noteId);
                    }}
                    onCloseTab={(noteId) => {
                      if (noteId === "__settings__") {
                        setSettingsTabActive(false);
                        return;
                      }
                      void closeTab(noteId);
                    }}
                    onNewTab={() => void handleNewNote()}
                    onTabMenuAction={(action, noteId) => void handleTabMenuAction(action, noteId)}
                    inTitlebar
                    hideNewTab
                  />
                </div>

                {/* Default title text — slide animation */}
                <div
                  className={`flex items-center gap-3 min-w-0 overflow-hidden transition-[max-width,opacity] duration-300 ease-in-out ${
                    isCompact ? "max-w-0 opacity-0" : "max-w-[480px] opacity-100 flex-1"
                  }`}
                >
                  <span className="text-[13px] font-display font-medium text-ink-soft tracking-wide shrink-0 pl-5">
                    花笺
                  </span>
                  <span className="text-[11px] text-ink-ghost font-body shrink-0">—</span>
                  <span className="text-[11px] text-ink-faint font-body truncate">
                    {title ||
                      selectedNote?.preview ||
                      t("common.untitledNote", { defaultValue: "无标题笔记" })}
                  </span>
                </div>

                {/* Compact toolbar buttons (right) */}
                {isCompact && (
                  <div className="flex items-center shrink-0 pr-2">
                    {errorMessage && (
                      <span className="max-w-[160px] truncate text-[11px] text-red-400 mr-2">
                        {errorMessage}
                      </span>
                    )}
                    <button
                      onClick={() => void handleImportNote()}
                      className="w-9 h-9 flex items-center justify-center text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 rounded-lg transition-all cursor-pointer"
                      title={t("main.sidebar.importMarkdown", { defaultValue: "导入 Markdown" })}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 3v12" />
                        <path d="m7 10 5 5 5-5" />
                        <path d="M5 21h14" />
                      </svg>
                    </button>
                    <button
                      onClick={handleNewNote}
                      className="w-9 h-9 flex items-center justify-center text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 rounded-lg transition-all cursor-pointer"
                      title={t("main.sidebar.newNote", { defaultValue: "新建笔记" })}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      >
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </button>
                    <button
                      onClick={() => void handleOpenNotepad()}
                      className="w-9 h-9 flex items-center justify-center text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 rounded-lg transition-all cursor-pointer"
                      title={t("main.window.quickNotepad", { defaultValue: "快捷便签" })}
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
                        <path d="M4 4h16v14H7l-3 3V4z" />
                        <path d="M8 9h8M8 13h5" />
                      </svg>
                    </button>
                  </div>
                )}

                {/* RIGHT: default window controls — slide animation */}
                <div
                  className={`shrink-0 ml-auto overflow-hidden transition-[max-width,opacity] duration-300 ease-in-out ${
                    isCompact ? "max-w-0 opacity-0" : "max-w-[172px] opacity-100"
                  }`}
                >
                  <div className="flex items-center">
                    {errorMessage && !isCompact && (
                      <span className="max-w-[200px] truncate text-[11px] text-red-400 mr-2">
                        {errorMessage}
                      </span>
                    )}
                    <button
                      onClick={() => void handleOpenNotepad()}
                      className="w-10 h-11 flex items-center justify-center text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer"
                      title={t("main.window.quickNotepad", { defaultValue: "快捷便签" })}
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
                        <path d="M4 4h16v14H7l-3 3V4z" />
                        <path d="M8 9h8M8 13h5" />
                      </svg>
                    </button>
                    <div className="w-px h-4 bg-paper-deep/30 mx-0.5" />
                    <button
                      onClick={handleMinimize}
                      className="w-11 h-11 flex items-center justify-center text-ink-ghost hover:text-ink-soft hover:bg-paper-warm transition-all cursor-pointer"
                      title={t("main.window.minimize", { defaultValue: "最小化" })}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12">
                        <rect x="1" y="5.5" width="10" height="1" fill="currentColor" rx="0.5" />
                      </svg>
                    </button>
                    <button
                      onClick={handleMaximize}
                      className="w-11 h-11 flex items-center justify-center text-ink-ghost hover:text-ink-soft hover:bg-paper-warm transition-all cursor-pointer"
                      title={
                        isMaximized
                          ? t("main.window.restore", { defaultValue: "还原" })
                          : t("main.window.maximize", { defaultValue: "最大化" })
                      }
                    >
                      {isMaximized ? (
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.2"
                        >
                          <rect x="3" y="3" width="7" height="7" rx="1" />
                          <path d="M3 5H2V2a1 1 0 0 1 1-1h5v1" />
                        </svg>
                      ) : (
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.2"
                        >
                          <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={handleClose}
                      className="w-11 h-11 flex items-center justify-center text-ink-ghost hover:text-red-500 hover:bg-danger-bg transition-all cursor-pointer"
                      title={t("main.window.close", { defaultValue: "关闭" })}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      >
                        <path d="M2 2l8 8M10 2l-8 8" />
                      </svg>
                    </button>
                  </div>
                </div>
              </>
            );
          })()}
        </div>

        <div className="relative z-10 flex flex-1 min-h-0">
          <LeftIconSidebar
            activePanel={sidebarTab}
            onSelectPanel={handleSidebarSelect}
            onSettings={() => void toggleSettingsTab()}
          />
          <div
            className={`border-r border-paper-deep/30 bg-paper/40 flex flex-col shrink-0 ${
              sidebarCollapsed ? "w-0 overflow-hidden transition-all duration-[600ms]" : ""
            }`}
            style={sidebarCollapsed ? undefined : { width: `${sidebarWidth}px` }}
          >
            {sidebarTab !== "git" && sidebarTab !== "browser" && (
              <div className="px-3 pt-3 pb-2 shrink-0">
                <div className="flex items-center gap-2 px-2.5 h-8 rounded-lg bg-paper-warm/80 border border-paper-deep/40 focus-within:border-bamboo/30 focus-within:bg-cloud transition-all">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="text-ink-ghost shrink-0"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t("main.sidebar.searchPlaceholder", { defaultValue: "搜索笔记…" })}
                    className="flex-1 text-[12px] font-body text-ink placeholder:text-ink-ghost/60 bg-transparent"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="text-ink-ghost hover:text-ink-faint transition-colors cursor-pointer"
                      title={t("main.sidebar.clearSearch", { defaultValue: "清空搜索" })}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                      >
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )}

            {sidebarTab === "directory" && (
              <div key="dir" className="flex flex-col flex-1 min-h-0 animate-view-fade">
                <>
                  {/* Notes directory selector — hidden in compact mode (moved to titlebar) */}
                  {settingsConfig && settingsConfig?.tabLayout === "default" && (
                    <div className="px-3 pb-1.5 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <div className="relative flex-1 min-w-0">
                          <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => {
                              setDeleteConfirmDir(null);
                              setNotesDirDropdownOpen((prev) => !prev);
                              void refreshOneDrivePaths();
                            }}
                            className="w-full flex items-center gap-1 h-7 rounded-lg text-[11px] font-body bg-paper-warm/80 border border-paper-deep/40 pl-2.5 pr-1.5 hover:border-bamboo/30 hover:bg-cloud transition-colors cursor-pointer"
                            title={t("main.notesDir.select", { defaultValue: "切换笔记目录" })}
                          >
                            <span className="flex-1 truncate text-left text-ink-faint">
                              {displayPathLabel(settingsConfig.notesDir ?? "")}
                            </span>
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className={`text-ink-ghost shrink-0 transition-transform duration-200 ${notesDirDropdownOpen ? "rotate-180" : ""}`}
                            >
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </button>
                          <div
                            onMouseDown={(e) => e.stopPropagation()}
                            className={`absolute top-full left-0 right-0 mt-1 z-[9999] bg-cloud border border-paper-deep/40 rounded-xl shadow-lg overflow-hidden py-1 transition-all duration-200 origin-top ${notesDirDropdownOpen ? "opacity-100 scale-y-100" : "opacity-0 scale-y-95 pointer-events-none"}`}
                          >
                            {(settingsConfig.notesDirs ?? [settingsConfig.notesDir]).map((dir) => {
                              const isCurrent = dir === settingsConfig.notesDir;
                              return (
                                <div key={dir} className="flex items-center">
                                  {deleteConfirmDir === dir ? (
                                    <div className="flex-1">
                                      <div className="px-3 py-1.5 text-[10px] font-body text-ink-faint border-b border-paper-deep/20">
                                        {t("main.notesDir.confirmDelete", {
                                          path: displayPathLabel(dir),
                                          defaultValue: "确认删除「{{path}}」？",
                                        })}
                                      </div>
                                      <div className="flex">
                                        <button
                                          onClick={() => void handleDeleteNotesDir(dir)}
                                          className="flex-1 text-center px-2 py-1.5 text-[11px] font-body text-red-400 hover:bg-danger-bg hover:text-red-500 transition-colors cursor-pointer"
                                        >
                                          {t("main.notesDir.confirmDeleteAction", {
                                            defaultValue: "确认删除",
                                          })}
                                        </button>
                                        <button
                                          onClick={() => setDeleteConfirmDir(null)}
                                          className="flex-1 text-center px-2 py-1.5 text-[11px] font-body text-ink-soft hover:bg-paper-warm transition-colors cursor-pointer"
                                        >
                                          {t("common.cancel", { defaultValue: "取消" })}
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        setNotesDirDropdownOpen(false);
                                        void switchNotesDir(dir);
                                      }}
                                      className={`flex-1 text-left truncate px-3 py-1.5 text-[11px] font-mono transition-colors cursor-pointer ${
                                        isCurrent
                                          ? "text-bamboo font-medium bg-bamboo-mist/30"
                                          : "text-ink-faint hover:text-ink-soft hover:bg-paper-warm/60"
                                      }`}
                                    >
                                      <span className="flex items-center gap-1.5">
                                        {oneDriveSyncedPaths.includes(dir) && (
                                          <svg
                                            width="11"
                                            height="11"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.7"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="shrink-0 opacity-60"
                                          >
                                            <path d="M6.5 17.5c-2.3-.5-4-2.5-4-4.9 0-3 2.3-5 5-4.8.8-2.7 3.3-4.5 6.1-4.1a5.2 5.2 0 0 1 3.6 2.1c2.7.2 4.8 2.6 4.8 5.3 0 2.3-1.3 4.2-3.2 5.1" />
                                            <path d="M9 19a3 3 0 0 0 6 0" />
                                            <path d="M12 16v3" />
                                          </svg>
                                        )}
                                        {displayPathLabel(dir)}
                                      </span>
                                    </button>
                                  )}
                                  {!isCurrent && deleteConfirmDir !== dir && (
                                    <button
                                      onClick={() => setDeleteConfirmDir(dir)}
                                      className="shrink-0 w-6 h-6 flex items-center justify-center opacity-30 hover:opacity-100 text-ink-ghost hover:text-red-400 hover:bg-danger-bg rounded transition-all cursor-pointer mr-0.5"
                                      title={t("common.delete", { defaultValue: "删除" })}
                                    >
                                      <svg
                                        width="10"
                                        height="10"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2.5"
                                        strokeLinecap="round"
                                      >
                                        <path d="M18 6L6 18M6 6l12 12" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            void handleChooseNotesDir();
                          }}
                          className="h-7 w-7 flex items-center justify-center rounded-lg text-[10px] text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 transition-colors cursor-pointer shrink-0"
                          title={t("main.notesDir.add", { defaultValue: "添加目录" })}
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
                    </div>
                  )}

                  {settingsConfig?.tabLayout === "default" && (
                    <div className="px-3 pb-2 shrink-0 space-y-1">
                      <button
                        onClick={handleNewNote}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-body text-bamboo hover:bg-bamboo-mist/60 transition-all cursor-pointer group"
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          className="group-hover:rotate-90 transition-transform duration-200"
                        >
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                        <span>{t("main.sidebar.newNote", { defaultValue: "新建笔记" })}</span>
                      </button>
                      <button
                        onClick={() => void handleImportNote()}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-body text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer group"
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 3v12" />
                          <path d="m7 10 5 5 5-5" />
                          <path d="M5 21h14" />
                        </svg>
                        <span>
                          {t("main.sidebar.importMarkdown", { defaultValue: "导入 Markdown" })}
                        </span>
                      </button>
                    </div>
                  )}

                  <div className="flex items-center justify-between px-5 pb-1.5 shrink-0">
                    <span className="text-[10px] text-ink-ghost font-mono tracking-wider uppercase">
                      {t("common.noteCount", {
                        count: filteredNotes.length,
                        defaultValue: "{{count}} 篇笔记",
                      })}
                      {externalFiles.length > 0
                        ? ` · ${t("common.externalFileCount", {
                            count: externalFiles.length,
                            defaultValue: "{{count}} 个外部文件",
                          })}`
                        : ""}
                    </span>
                    <button
                      onClick={() => setShowCategoryInput(true)}
                      className="text-[10px] text-ink-ghost hover:text-bamboo transition-colors cursor-pointer"
                      title={t("main.category.new", { defaultValue: "新建分类" })}
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

                  {showCategoryInput && (
                    <div className="px-3 pb-2 shrink-0">
                      <input
                        type="text"
                        autoFocus
                        value={categoryInputValue}
                        onChange={(e) => setCategoryInputValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleCreateCategory();
                          if (e.key === "Escape") {
                            setShowCategoryInput(false);
                            setCategoryInputValue("");
                          }
                        }}
                        onBlur={() => void handleCreateCategory()}
                        placeholder={t("main.category.placeholder", {
                          defaultValue: "输入分类名…",
                        })}
                        className="w-full px-2.5 h-7 rounded-lg text-[12px] font-body text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/30 placeholder:text-ink-ghost/60"
                      />
                    </div>
                  )}

                  <div className="flex-1 overflow-y-scroll px-2 pb-2">
                    <div className="space-y-0.5">
                      {externalFiles.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 text-[10px] text-ink-ghost/50 font-mono tracking-wider uppercase">
                            {t("main.externalFiles.title", { defaultValue: "外部文件" })}
                          </div>
                          {externalFiles.map((file) => {
                            const isSelected = file.id === selectedId;
                            const isHovered = file.id === hoveredId;

                            return (
                              <button
                                key={file.id}
                                onClick={() => void handleSelectExternalFile(file.id)}
                                onMouseEnter={() => setHoveredId(file.id)}
                                onMouseLeave={() => setHoveredId(null)}
                                className={`w-full text-left rounded-xl px-3 py-2.5 transition-all duration-[600ms] cursor-pointer group relative ${
                                  isSelected
                                    ? "bg-bamboo-mist/70"
                                    : isHovered
                                      ? "bg-paper-warm/70"
                                      : "bg-transparent"
                                }`}
                              >
                                <div
                                  className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-bamboo/60 transition-all duration-[600ms] ${
                                    isSelected ? "h-5 opacity-100" : "h-0 opacity-0"
                                  }`}
                                />

                                <div className="flex items-baseline justify-between mb-0.5">
                                  <span
                                    className={`text-[13px] font-display font-medium truncate pr-2 transition-colors flex items-center gap-1.5 ${
                                      isSelected ? "text-bamboo" : "text-ink-soft"
                                    }`}
                                  >
                                    <svg
                                      width="12"
                                      height="12"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      className="shrink-0 opacity-60"
                                    >
                                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                      <polyline points="14 2 14 8 20 8" />
                                    </svg>
                                    {file.title}
                                    {file.readOnly && (
                                      <span className="text-[9px] text-ink-ghost/50 font-mono bg-paper-deep/30 px-1 rounded">
                                        {file.mimeType
                                          ? file.mimeType.split("/").pop()?.toUpperCase()
                                          : "📎"}
                                      </span>
                                    )}
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveExternalFile(file.id);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 text-ink-ghost hover:text-red-400 transition-all p-0.5"
                                    title={t("main.externalFiles.remove", {
                                      defaultValue: "从列表移除",
                                    })}
                                  >
                                    <svg
                                      width="12"
                                      height="12"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                    >
                                      <line x1="18" y1="6" x2="6" y2="18" />
                                      <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                  </button>
                                </div>

                                <p className="text-[11px] text-ink-ghost leading-relaxed line-clamp-2 group-hover:text-ink-faint transition-colors pl-[18px]">
                                  {file.filePath}
                                </p>
                              </button>
                            );
                          })}
                        </>
                      )}

                      {categoryGroups.map((group: CategoryGroup) => {
                        if (!group.category) {
                          return (
                            <div
                              key="__uncategorized__"
                              className={`rounded-lg transition-all duration-200 ${
                                dragOverCategory === "" ? "bg-bamboo/10 ring-1 ring-bamboo/20" : ""
                              }`}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                                setDragOverCategory("");
                              }}
                              onDragLeave={(e) => {
                                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                  setDragOverCategory(null);
                                }
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                setDragOverCategory(null);
                                const noteId = e.dataTransfer.getData("text/plain");
                                if (noteId) void handleMoveNote(noteId, "");
                              }}
                            >
                              {group.notes.map((note) => {
                                const isSelected = note.id === selectedId;
                                const isHovered = note.id === hoveredId;
                                return (
                                  <div
                                    key={note.id}
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData("text/plain", note.id);
                                      e.dataTransfer.effectAllowed = "move";
                                    }}
                                    onClick={() => void handleSelectNote(note.id)}
                                    onDoubleClick={() => void handleDoubleClickNote(note.id)}
                                    onContextMenu={(event) => handleOpenNoteMenu(event, note.id)}
                                    onMouseEnter={() => setHoveredId(note.id)}
                                    onMouseLeave={() => setHoveredId(null)}
                                    className={`w-full text-left rounded-xl px-3 py-2.5 transition-all duration-[600ms] cursor-pointer group relative ${
                                      isSelected
                                        ? "bg-bamboo-mist/70"
                                        : isHovered
                                          ? "bg-paper-warm/70"
                                          : "bg-transparent"
                                    }`}
                                  >
                                    <div
                                      className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-bamboo/60 transition-all duration-[600ms] ${
                                        isSelected ? "h-5 opacity-100" : "h-0 opacity-0"
                                      }`}
                                    />
                                    <div className="flex items-baseline mb-0.5">
                                      <div className="min-w-0 flex-1">
                                        <span
                                          className={`text-[13px] font-display font-medium block truncate transition-colors flex items-center gap-1.5 ${
                                            isSelected ? "text-bamboo" : "text-ink-soft"
                                          }`}
                                        >
                                          {isReadOnlyNote(note) && (
                                            <span
                                              className={`text-[9px] font-mono shrink-0 px-1 rounded ${getFileTypeIconColor(note)} bg-current/10`}
                                            >
                                              {getFileTypeLabel(note)}
                                            </span>
                                          )}
                                          {getDisplayTitle(note, t)}
                                        </span>
                                        {note.fileStem &&
                                          note.title &&
                                          note.title !== note.fileStem && (
                                            <span className="text-[10px] text-ink-ghost/50 font-mono block truncate mt-0.5">
                                              {note.fileStem}
                                            </span>
                                          )}
                                      </div>
                                    </div>
                                    <p className="text-[11px] text-ink-ghost leading-relaxed line-clamp-2 group-hover:text-ink-faint transition-colors">
                                      {note.preview ||
                                        t("common.blankNote", { defaultValue: "空白笔记" })}
                                    </p>
                                    <div className="flex items-center gap-2 mt-1">
                                      <span className="text-[10px] text-ink-ghost/60 font-mono tabular-nums">
                                        {formatShortDate(note.updatedAt)}{" "}
                                        {formatTime(note.updatedAt)}
                                      </span>
                                      <span className="text-[10px] text-ink-ghost/40">·</span>
                                      <span className="text-[10px] text-ink-ghost/60 font-mono tabular-nums">
                                        {t("common.wordCount", {
                                          count: note.wordCount,
                                          defaultValue: "{{count}} 字",
                                        })}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        }

                        const isCollapsed = collapsedCategories.has(group.category);

                        return (
                          <div key={group.category} className="mb-0.5">
                            <div
                              className={`flex items-center gap-1.5 pl-2 pr-3 py-2 rounded-xl group/cat cursor-pointer select-none transition-all duration-[600ms] ${
                                dragOverCategory === group.category
                                  ? "bg-bamboo/10 ring-1 ring-bamboo/20"
                                  : isCollapsed
                                    ? "hover:bg-paper-warm/70"
                                    : "bg-bamboo-mist/30"
                              }`}
                              onClick={() => toggleCategoryCollapse(group.category)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setCategoryMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  category: group.category,
                                });
                                setCategoryMenuClosing(false);
                                setCategoryMenuConfirmDelete(false);
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                                setDragOverCategory(group.category);
                              }}
                              onDragLeave={() => setDragOverCategory(null)}
                              onDrop={(e) => {
                                e.preventDefault();
                                setDragOverCategory(null);
                                const noteId = e.dataTransfer.getData("text/plain");
                                if (noteId) void handleMoveNote(noteId, group.category);
                              }}
                            >
                              <svg
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={`text-bamboo/50 shrink-0 transition-transform duration-200 ${isCollapsed ? "" : "rotate-90"}`}
                              >
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="text-bamboo/50 shrink-0"
                              >
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                              </svg>
                              {renamingCategory === group.category ? (
                                <input
                                  type="text"
                                  autoFocus
                                  value={renameCategoryValue}
                                  onChange={(e) => setRenameCategoryValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter")
                                      void handleRenameCategory(group.category);
                                    if (e.key === "Escape") setRenamingCategory(null);
                                  }}
                                  onBlur={() => void handleRenameCategory(group.category)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="flex-1 min-w-0 px-1 text-[10px] font-mono text-ink bg-paper-warm/80 border border-bamboo/30 rounded"
                                />
                              ) : (
                                <span className="text-[11px] text-bamboo/70 font-medium truncate">
                                  {group.category}
                                </span>
                              )}
                              <span className="text-[9px] text-bamboo/40 font-mono ml-auto shrink-0">
                                {group.notes.length}
                              </span>
                            </div>

                            <div className={`category-body ${isCollapsed ? "" : "expanded"}`}>
                              <div
                                className="category-body-inner relative ml-[14px] pl-3 border-l-[1.5px] border-bamboo/15 pt-0.5 pb-0.5"
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = "move";
                                  setDragOverCategory(group.category);
                                }}
                                onDragLeave={(e) => {
                                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                    setDragOverCategory(null);
                                  }
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  setDragOverCategory(null);
                                  const noteId = e.dataTransfer.getData("text/plain");
                                  if (noteId) void handleMoveNote(noteId, group.category);
                                }}
                              >
                                {group.notes.length === 0 ? (
                                  <div className="px-2 py-3 text-center text-[11px] text-ink-ghost/50">
                                    {t("main.category.emptyFolder", { defaultValue: "空文件夹" })}
                                  </div>
                                ) : (
                                  group.notes.map((note) => {
                                    const isSelected = note.id === selectedId;
                                    const isHovered = note.id === hoveredId;

                                    return (
                                      <div
                                        key={note.id}
                                        draggable
                                        onDragStart={(e) => {
                                          e.dataTransfer.setData("text/plain", note.id);
                                          e.dataTransfer.effectAllowed = "move";
                                        }}
                                        onClick={() => void handleSelectNote(note.id)}
                                        onDoubleClick={() => void handleDoubleClickNote(note.id)}
                                        onContextMenu={(event) =>
                                          handleOpenNoteMenu(event, note.id)
                                        }
                                        onMouseEnter={() => setHoveredId(note.id)}
                                        onMouseLeave={() => setHoveredId(null)}
                                        className={`w-full text-left rounded-xl px-3 py-2.5 transition-all duration-[600ms] cursor-pointer group relative ${
                                          isSelected
                                            ? "bg-bamboo-mist/70"
                                            : isHovered
                                              ? "bg-paper-warm/70"
                                              : "bg-transparent"
                                        }`}
                                      >
                                        <div
                                          className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-bamboo/60 transition-all duration-[600ms] ${
                                            isSelected ? "h-5 opacity-100" : "h-0 opacity-0"
                                          }`}
                                        />

                                        <div className="flex items-baseline mb-0.5">
                                          <div className="min-w-0 flex-1">
                                            <span
                                              className={`text-[13px] font-display font-medium block truncate transition-colors flex items-center gap-1.5 ${
                                                isSelected ? "text-bamboo" : "text-ink-soft"
                                              }`}
                                            >
                                              {isReadOnlyNote(note) && (
                                                <span
                                                  className={`text-[9px] font-mono shrink-0 px-1 rounded ${getFileTypeIconColor(note)} bg-current/10`}
                                                >
                                                  {getFileTypeLabel(note)}
                                                </span>
                                              )}
                                              {getDisplayTitle(note, t)}
                                            </span>
                                            {note.fileStem &&
                                              note.title &&
                                              note.title !== note.fileStem && (
                                                <span className="text-[10px] text-ink-ghost/50 font-mono block truncate mt-0.5">
                                                  {note.fileStem}
                                                </span>
                                              )}
                                          </div>
                                        </div>

                                        <p className="text-[11px] text-ink-ghost leading-relaxed line-clamp-2 group-hover:text-ink-faint transition-colors">
                                          {note.preview ||
                                            t("common.blankNote", { defaultValue: "空白笔记" })}
                                        </p>

                                        <div className="flex items-center gap-2 mt-1">
                                          <span className="text-[10px] text-ink-ghost/60 font-mono tabular-nums">
                                            {formatShortDate(note.updatedAt)}{" "}
                                            {formatTime(note.updatedAt)}
                                          </span>
                                          <span className="text-[10px] text-ink-ghost/40">·</span>
                                          <span className="text-[10px] text-ink-ghost/60 font-mono tabular-nums">
                                            {t("common.wordCount", {
                                              count: note.wordCount,
                                              defaultValue: "{{count}} 字",
                                            })}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {!isLoading && filteredNotes.length === 0 && externalFiles.length === 0 && (
                        <div className="px-3 py-8 text-center text-[12px] text-ink-ghost leading-relaxed">
                          {searchQuery
                            ? t("main.search.noResults", { defaultValue: "没有匹配的笔记" })
                            : t("main.search.empty", { defaultValue: "还没有笔记" })}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              </div>
            )}

            {sidebarTab === "outline" && selectedId && (
              <div key="outline" className="flex flex-col flex-1 min-h-0 animate-view-fade">
                <OutlinePanel
                  headings={headings}
                  onJumpTo={handleJumpToHeading}
                  emptyText={t("main.outline.empty", { defaultValue: "当前文档暂无标题" })}
                />
              </div>
            )}

            {sidebarTab === "git" && savedNotesDir && (
              <div key="git" className="flex flex-col flex-1 min-h-0 animate-view-fade">
                <GitPanel
                  repoPath={savedNotesDir}
                  onRefresh={() => {
                    void refreshNotes();
                  }}
                />
              </div>
            )}
          </div>

          {!sidebarCollapsed && (
            <div
              className={`w-1 shrink-0 cursor-col-resize group relative ${isResizingSidebar ? "bg-bamboo/30" : "hover:bg-bamboo/20"} transition-colors`}
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingSidebar(true);
              }}
            >
              <div
                className={`absolute inset-y-0 -left-1 -right-1 ${isResizingSidebar ? "" : "group-hover:bg-bamboo/5"}`}
              />
            </div>
          )}

          <div className="flex-1 flex flex-col min-w-0">
            <div
              className="grid transition-[grid-template-rows] duration-300 ease-in-out"
              style={{
                gridTemplateRows: settingsConfig?.tabLayout === "default" ? "1fr" : "0fr",
              }}
            >
              <div className="overflow-hidden">
                <TabBar
                  tabs={displayTabs}
                  activeTabId={settingsTabActive ? "__settings__" : activeTabId}
                  onSelectTab={(noteId) => {
                    if (noteId === "__settings__") return;
                    setSettingsTabActive(false);
                    flushActiveTab();
                    void openTab(noteId);
                  }}
                  onCloseTab={(noteId) => {
                    if (noteId === "__settings__") {
                      setSettingsTabActive(false);
                      return;
                    }
                    void closeTab(noteId);
                  }}
                  onNewTab={() => void handleNewNote()}
                  onTabMenuAction={(action, noteId) => void handleTabMenuAction(action, noteId)}
                />
              </div>
            </div>
            {settingsTabActive && settingsConfig ? (
              <SettingsTab
                config={settingsConfig}
                onChange={handleSettingsChange}
                onChooseNotesDir={() => void handleChooseNotesDir()}
              />
            ) : (
              <>
                <div className="flex items-center justify-between px-4 h-10 border-b border-paper-deep/20 shrink-0 bg-paper/20">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
                      title={
                        sidebarCollapsed
                          ? t("main.window.expandSidebar", { defaultValue: "展开侧栏" })
                          : t("main.window.collapseSidebar", { defaultValue: "收起侧栏" })
                      }
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
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <line x1="9" y1="3" x2="9" y2="21" />
                      </svg>
                    </button>

                    <div className="h-4 w-px bg-paper-deep/30 mx-1" />

                    <button
                      onClick={() => void handlePinEntry()}
                      disabled={!selectedId}
                      aria-label={pinTileButtonTitle(selectedTilePinned)}
                      className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                        selectedTilePinned
                          ? "text-bamboo bg-bamboo-mist/40 hover:text-red-400 hover:bg-danger-bg"
                          : "text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50"
                      }`}
                      title={pinTileButtonTitle(selectedTilePinned)}
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 17v5" />
                        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z" />
                      </svg>
                    </button>

                    <button
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={handleUndo}
                      disabled={!selectedId}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      title={t("main.editor.undo", { defaultValue: "撤销（Ctrl+Z）" })}
                      aria-label={t("main.editor.undoLabel", { defaultValue: "撤销" })}
                    >
                      <svg
                        data-testid="main-editor-undo-icon"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M9 14 4 9l5-5" />
                        <path d="M4 9h10a6 6 0 0 1 0 12h-1" />
                      </svg>
                    </button>

                    <button
                      onClick={() => void saveCurrentNote()}
                      disabled={!selectedId || saveState === "saving"}
                      className="px-2.5 h-7 flex items-center justify-center rounded-lg text-[11px] text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      title={t("common.save", { defaultValue: "保存" })}
                    >
                      {t("common.save", { defaultValue: "保存" })}
                    </button>

                    {deleteConfirm ? (
                      <div
                        className={`flex items-center gap-1 ml-1 ${deleteExiting ? "animate-delete-confirm-exit" : "animate-delete-confirm"}`}
                      >
                        <span className="text-[11px] text-red-400 whitespace-nowrap">
                          {t("main.editor.confirmDelete", { defaultValue: "确认删除？" })}
                        </span>
                        <button
                          onClick={() => {
                            setDeleteExiting(true);
                            setTimeout(() => {
                              setDeleteExiting(false);
                              setDeleteConfirm(false);
                              void handleDeleteNote();
                            }, 150);
                          }}
                          className="px-2 h-6 rounded-md text-[11px] text-cloud bg-red-400 hover:bg-red-500 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          {t("common.delete", { defaultValue: "删除" })}
                        </button>
                        <button
                          onClick={() => {
                            setDeleteExiting(true);
                            setTimeout(() => {
                              setDeleteExiting(false);
                              setDeleteConfirm(false);
                            }, 150);
                          }}
                          className="px-2 h-6 rounded-md text-[11px] text-ink-faint hover:text-ink-soft hover:bg-paper-warm transition-colors cursor-pointer"
                        >
                          {t("common.cancel", { defaultValue: "取消" })}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(true)}
                        disabled={!selectedId}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-red-400 hover:bg-danger-bg transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        title={t("noteMenu.delete", { defaultValue: "删除笔记" })}
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="3,6 5,6 21,6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                    {/* Rename file button */}
                    {renameFileFor === selectedNote?.id ? (
                      <input
                        type="text"
                        value={renameFileValue}
                        onChange={(e) => setRenameFileValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const v = renameFileValue.trim();
                            if (v && selectedNote) {
                              void renameNoteFileStem(selectedNote.id, v)
                                .then(() => refreshNotes())
                                .catch((err) => setErrorMessage(getErrorMessage(err)));
                            }
                            setRenameFileFor(null);
                          }
                          if (e.key === "Escape") setRenameFileFor(null);
                        }}
                        onBlur={() => setRenameFileFor(null)}
                        autoFocus
                        className="w-28 px-1.5 h-6 rounded text-[11px] font-mono text-ink bg-paper-warm border border-bamboo/40"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <button
                        onClick={() => {
                          if (selectedNote) {
                            setRenameFileFor(selectedNote.id);
                            setRenameFileValue(selectedNote.fileStem);
                          }
                        }}
                        disabled={!selectedId}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        title={t("noteMenu.renameFile", { defaultValue: "重命名文件" })}
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
                          <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        </svg>
                      </button>
                    )}
                    {/* Sync title to filename button */}
                    <button
                      onClick={() => {
                        if (selectedNote) {
                          void renameNoteFileStem(
                            selectedNote.id,
                            selectedNote.title || selectedNote.fileStem,
                          )
                            .then(() => refreshNotes())
                            .catch((err) => setErrorMessage(getErrorMessage(err)));
                        }
                      }}
                      disabled={!selectedId}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      title={t("noteMenu.syncTitleToFile", { defaultValue: "标题同步为文件名" })}
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
                        <polyline points="17 1 21 5 17 9" />
                        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                        <polyline points="7 23 3 19 7 15" />
                        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div
                  key={`title-${noteTransitionKey}`}
                  className="animate-note-enter px-6 pt-4 pb-2 shrink-0 border-b border-paper-deep/15"
                >
                  <input
                    type="text"
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      markDirty();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        // Focus is handled by WysiwygEditor internally
                      }
                    }}
                    placeholder={t("common.untitledNote", { defaultValue: "无标题笔记" })}
                    disabled={!selectedId || isReadOnlyExternal || isReadOnlyInternal}
                    className="w-full text-[20px] font-display font-bold text-ink placeholder:text-ink-ghost/50 tracking-wide disabled:opacity-60"
                  />
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] text-ink-ghost font-mono tabular-nums truncate max-w-[200px]">
                      {selectedExternalFile
                        ? t("main.externalFile.label", {
                            path: selectedExternalFile.filePath,
                            defaultValue: "外部文件 · {{path}}",
                          })
                        : selectedNote
                          ? `${formatShortDate(selectedNote.updatedAt)} ${formatTime(selectedNote.updatedAt)}`
                          : "--"}
                    </span>
                    <span className="text-[10px] text-ink-ghost/40">·</span>
                    <span className="text-[10px] text-ink-ghost font-mono tabular-nums">
                      {t("common.wordCount", { count: charCount, defaultValue: "{{count}} 字" })}
                    </span>
                    <span className="text-[10px] text-ink-ghost/40">·</span>
                    <span
                      key={saveState}
                      className={`text-[10px] font-mono tabular-nums animate-status-fade ${
                        saveState === "error"
                          ? "text-red-400"
                          : saveState === "dirty"
                            ? "text-amber-500/70"
                            : "text-bamboo/60"
                      }`}
                    >
                      {isReadOnlyExternal || isReadOnlyInternal
                        ? t("main.statusBar.readOnly", { defaultValue: "只读" })
                        : saveStateLabel[saveState]}
                    </span>
                  </div>
                </div>

                <div
                  key={`editor-${noteTransitionKey}`}
                  ref={splitContainerRef}
                  className="flex-1 flex flex-col min-h-0 animate-view-fade"
                >
                  {!selectedId && !isLoading ? (
                    <div className="flex-1 flex items-center justify-center text-[13px] text-ink-ghost">
                      {t("main.editor.emptyHint", { defaultValue: "选择或新建一篇笔记" })}
                    </div>
                  ) : isLoading && selectedId ? (
                    <div className="flex-1 flex flex-col gap-3 px-6 pt-5 pb-4 animate-fade-in">
                      {/* Loading skeleton — mimics title + content layout */}
                      <div className="space-y-3">
                        <div className="h-7 w-2/5 rounded bg-ink-ghost/15 animate-pulse" />
                        <div className="flex items-center gap-3">
                          <div className="h-3 w-24 rounded bg-ink-ghost/10 animate-pulse" />
                          <div className="h-3 w-16 rounded bg-ink-ghost/10 animate-pulse" />
                          <div className="h-3 w-16 rounded bg-ink-ghost/10 animate-pulse" />
                        </div>
                      </div>
                      <div className="border-t border-paper-deep/15 pt-4 space-y-2.5">
                        {Array.from({ length: 8 }).map((_, i) => (
                          <div
                            key={i}
                            className="h-4 rounded bg-ink-ghost/10 animate-pulse"
                            style={{ width: `${60 + Math.random() * 35}%` }}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <WysiwygEditor
                      ref={wysiwygRef}
                      key={selectedId}
                      content={content}
                      onChange={(newValue) => {
                        setContent(newValue);
                        markDirty();
                      }}
                      fontSize={settingsConfig?.fontSize ?? 14}
                      disabled={!selectedId || isReadOnlyExternal || isReadOnlyInternal}
                      placeholder={t("main.editor.contentPlaceholder", {
                        defaultValue: "开始写作……",
                      })}
                      onDirty={markDirty}
                      hideFirstHeading={!!title.trim()}
                      onScrollTop={handleEditorScroll}
                      initialMode={
                        settingsConfig?.defaultViewMode as "wysiwyg" | "source" | "read" | undefined
                      }
                      onExternalLink={openBrowserTab}
                    />
                  )}
                </div>

                <div className="flex items-center justify-between px-4 h-7 border-t border-paper-deep/20 bg-paper/30 shrink-0">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-ink-ghost font-mono tabular-nums">
                      {t("main.statusBar.lineNumber", {
                        count: lineCount,
                        defaultValue: "Ln {{count}}",
                      })}
                    </span>
                    <span className="text-[10px] text-ink-ghost/40">|</span>
                    <span className="text-[10px] text-ink-ghost font-mono">
                      {isReadOnlyInternal && selectedNote
                        ? getFileTypeLabel(selectedNote)
                        : isReadOnlyExternal && selectedExternalFile
                          ? selectedExternalFile.contentFormat === "html"
                            ? (selectedExternalFile.mimeType ?? "HTML")
                            : (selectedExternalFile.mimeType ?? "Document")
                          : t("main.statusBar.format", { defaultValue: "Markdown + LaTeX" })}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-ink-ghost font-mono">
                      {t("main.statusBar.encoding", { defaultValue: "UTF-8" })}
                    </span>
                    <span className="text-[10px] text-ink-ghost/40">|</span>
                    <span className="text-[10px] text-ink-ghost font-mono tabular-nums">
                      {t("main.statusBar.byteSize", {
                        size: byteSize,
                        defaultValue: "{{size}} KB",
                      })}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 浏览器侧边栏：浏览列 + 拖拽分隔条 */}
          {sidebarTab === "browser" && (
            <>
              <div
                className={`w-1 shrink-0 cursor-col-resize group relative ${isResizingBrowser ? "bg-bamboo/30" : "hover:bg-bamboo/20"} transition-colors`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setIsResizingBrowser(true);
                }}
              >
                <div
                  className={`absolute inset-y-0 -left-1 -right-1 ${isResizingBrowser ? "" : "group-hover:bg-bamboo/5"}`}
                />
              </div>
              <div
                className="shrink-0 flex flex-col min-h-0 border-l border-paper-deep/30 bg-paper/40"
                style={{ width: `${browserWidth}px` }}
              >
                <BrowserPanel
                  state={browserState}
                  ref={browserPanelRef}
                  onRetract={() => {
                    setSidebarTab("directory");
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>
      {noteMenu && noteMenuTarget && (
        <div
          className={`fixed z-[9999] min-w-[168px] py-1.5 bg-cloud/95 backdrop-blur-sm border border-paper-deep/50 rounded-lg overflow-hidden select-none ${noteMenuClosing ? "animate-menu-exit" : "animate-menu-enter"}`}
          style={{ left: noteMenu.x, top: noteMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {noteMenuMode === "main" ? (
            <div key="main" className="animate-menu-slide-right">
              {noteContextMenuItems.map((item, index) => (
                <button
                  key={item.action}
                  onClick={() => handleNoteMenuAction(item.action)}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-[12px] font-body transition-colors cursor-pointer ${
                    item.tone === "danger"
                      ? "text-red-400 hover:bg-danger-bg hover:text-red-500"
                      : "text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo"
                  } ${index > 0 ? "border-t border-paper-deep/20" : ""}`}
                >
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div key="move" className="animate-menu-slide-left">
              <button
                onClick={() => setNoteMenuMode("main")}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-body text-ink-ghost hover:bg-paper-warm transition-colors cursor-pointer border-b border-paper-deep/20"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                <span>{t("common.back", { defaultValue: "返回" })}</span>
              </button>
              <button
                onClick={() => void handleMoveNote(noteMenuTarget.id, "")}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer"
              >
                {t("main.category.uncategorized", { defaultValue: "未分类" })}
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => void handleMoveNote(noteMenuTarget.id, cat)}
                  className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer"
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {categoryMenu && (
        <div
          className={`fixed z-[9999] min-w-[140px] py-1.5 bg-cloud/95 backdrop-blur-sm border border-paper-deep/50 rounded-lg overflow-hidden select-none ${categoryMenuClosing ? "animate-menu-exit" : "animate-menu-enter"}`}
          style={{ left: categoryMenu.x, top: categoryMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {categoryMenuConfirmDelete ? (
            <div className="animate-menu-slide-left">
              <div className="px-3 py-1.5 text-[11px] font-body text-ink-faint border-b border-paper-deep/20">
                {t("main.category.confirmDelete", {
                  category: categoryMenu.category,
                  defaultValue: "确认删除「{{category}}」？",
                })}
              </div>
              <button
                onClick={() => {
                  void handleDeleteCategory(categoryMenu.category);
                  setCategoryMenuClosing(true);
                }}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-red-400 hover:bg-danger-bg hover:text-red-500 transition-colors cursor-pointer"
              >
                {t("main.category.confirmDeleteAction", { defaultValue: "确认删除" })}
              </button>
              <button
                onClick={() => setCategoryMenuConfirmDelete(false)}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer"
              >
                {t("common.cancel", { defaultValue: "取消" })}
              </button>
            </div>
          ) : (
            <div className="animate-menu-slide-right">
              <button
                onClick={() => {
                  setCategoryMenuClosing(true);
                  setRenamingCategory(categoryMenu.category);
                  setRenameCategoryValue(categoryMenu.category);
                }}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer"
              >
                {t("main.category.rename", { defaultValue: "重命名" })}
              </button>
              <button
                onClick={() => setCategoryMenuConfirmDelete(true)}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-red-400 hover:bg-danger-bg hover:text-red-500 transition-colors cursor-pointer border-t border-paper-deep/20"
              >
                {t("main.category.delete", { defaultValue: "删除分类" })}
              </button>
            </div>
          )}
        </div>
      )}

      {/* External file path recording prompt */}
      {pendingPathPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
          onClick={() => setPendingPathPrompt(null)}
        >
          <div
            className="bg-cloud border border-paper-deep/40 rounded-2xl shadow-lg p-5 w-[420px] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[14px] font-display font-medium text-ink-soft mb-2">
              {t("main.externalPathPrompt.title", {
                defaultValue: "记录新的笔记目录？",
              })}
            </h3>
            <p className="text-[12px] text-ink-faint mb-3 leading-relaxed">
              {t("main.externalPathPrompt.message", {
                defaultValue: "打开的文件不在已知笔记目录下。是否将以下路径记录为笔记目录？",
              })}
            </p>
            <label className="block text-[11px] text-ink-faint mb-1">
              {t("main.externalPathPrompt.pathLabel", {
                defaultValue: "笔记目录路径",
              })}
            </label>
            <input
              type="text"
              value={pendingPathPrompt.inputValue}
              onChange={(e) =>
                setPendingPathPrompt({
                  ...pendingPathPrompt,
                  inputValue: e.target.value,
                })
              }
              className="w-full px-2.5 h-8 rounded-lg text-[12px] font-mono text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/30 mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingPathPrompt(null)}
                className="px-4 py-1.5 rounded-lg text-[12px] text-ink-faint hover:bg-paper-warm border border-paper-deep/30 transition-colors cursor-pointer"
              >
                {t("main.externalPathPrompt.cancel", {
                  defaultValue: "取消记录",
                })}
              </button>
              <button
                onClick={async () => {
                  const path = pendingPathPrompt.inputValue.trim();
                  if (!path) return;
                  setErrorMessage(null);
                  try {
                    await addNotesDir(path);
                    await switchNotesDir(path, true);
                    setPendingPathPrompt(null);
                  } catch (error) {
                    setErrorMessage(getErrorMessage(error));
                  }
                }}
                className="px-4 py-1.5 rounded-lg text-[12px] text-white bg-bamboo hover:bg-bamboo-light transition-colors cursor-pointer"
              >
                {t("main.externalPathPrompt.save", {
                  defaultValue: "保存并切换",
                })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
