import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppConfig, ViewMode } from "./types";

export interface ShortcutCheckResult {
  available: boolean;
  conflictType: "none" | "current" | "invalid" | "system" | "registered" | "unknown";
  message: string;
}

export function getConfig(): Promise<AppConfig> {
  return invoke("config_get");
}

export function saveConfig(config: AppConfig): Promise<AppConfig> {
  return invoke("config_save", { config });
}

export function checkGlobalShortcut(shortcut: string): Promise<ShortcutCheckResult> {
  return invoke("global_shortcut_check", { shortcut });
}

export async function chooseNotesDirectory(): Promise<string | null> {
  const path = await open({
    directory: true,
    multiple: false,
  });

  return typeof path === "string" ? path : null;
}

export async function chooseBackgroundImage(): Promise<string | null> {
  const path = await open({
    directory: false,
    multiple: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  });

  return typeof path === "string" ? path : null;
}

export function normalizeViewMode(value: string): ViewMode {
  if (value === "wysiwyg" || value === "source") {
    return value;
  }
  // Migrate legacy values
  if (value === "edit" || value === "split") {
    return "source";
  }
  if (value === "preview") {
    return "wysiwyg";
  }
  return "wysiwyg";
}

export interface OpenedFileClassification {
  filePath: string;
  known: boolean;
  matchedNotesDir: string | null;
}

export function listNotesDirs(): Promise<string[]> {
  return invoke("notes_dirs_list");
}

export function selectNotesDir(path: string, addToCache?: boolean): Promise<AppConfig> {
  return invoke("notes_dirs_select", { path, addToCache: addToCache ?? true });
}

export function addNotesDir(path: string): Promise<AppConfig> {
  return invoke("notes_dirs_add", { path });
}

export function deleteNotesDir(path: string): Promise<AppConfig> {
  return invoke("notes_dirs_delete", { path });
}

export function classifyOpenedFile(filePath: string): Promise<OpenedFileClassification> {
  return invoke("open_file_classify", { filePath });
}
