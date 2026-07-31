import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppConfig } from "../settings/types";
import type { OneDriveFolder, OneDriveStatus, OneDriveSyncFolder } from "./types";
import {
  getOneDriveStatus,
  listOneDriveRootFolders,
  listOneDriveFolders,
  addOneDriveSyncFolder,
  removeOneDriveSyncFolder,
  logoutOneDrive,
} from "./api";
import { addNotesDir, deleteNotesDir } from "../settings/api";

// ---------------------------------------------------------------------------
// Themed inline SVG icons
// ---------------------------------------------------------------------------

function CloudIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Flowing, organic cloud silhouette fitting 花笺's ink-brush aesthetic */}
      <path d="M6.5 17.5c-2.3-.5-4-2.5-4-4.9 0-3 2.3-5 5-4.8.8-2.7 3.3-4.5 6.1-4.1a5.2 5.2 0 0 1 3.6 2.1c2.7.2 4.8 2.6 4.8 5.3 0 2.3-1.3 4.2-3.2 5.1" />
      <path d="M9 19a3 3 0 0 0 6 0" />
      <path d="M12 16v3" />
    </svg>
  );
}

function FolderIcon({ open: isOpen, className }: { open?: boolean; className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {isOpen ? (
        <path d="M5 19a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1M5 19h14a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2z" />
      ) : (
        <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      )}
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: "right" | "down" }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: direction === "down" ? "rotate(90deg)" : "none",
        transition: "transform 0.15s ease",
        flexShrink: 0,
      }}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function OneDriveLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Stylized cloud-in-box mark — crisp, minimal, on-theme */}
      <rect x="3" y="10" width="18" height="10" rx="2" />
      <path d="M7 10V7.5a4.3 4.3 0 0 1 6.8-3.1" />
      <path d="M17 10h1.2a3 3 0 1 1 0 6H17" />
      {/* Subtle inner cloud detail */}
      <path d="M9 15.5a2 2 0 0 1 2.5-1.9 1.8 1.8 0 0 1 3.2.9" opacity="0.55" />
    </svg>
  );
}

interface OneDriveSettingsProps {
  config: AppConfig;
  onChange: (config: AppConfig) => void;
}

export function OneDriveSettings({ config: _config, onChange }: OneDriveSettingsProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<OneDriveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [folders, setFolders] = useState<OneDriveFolder[]>([]);
  const [subfolders, setSubfolders] = useState<Record<string, OneDriveFolder[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFolder, setSelectedFolder] = useState<OneDriveFolder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await getOneDriveStatus();
      setStatus(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleBrowseFolders = async () => {
    try {
      setError(null);
      setFolders([]);
      setSubfolders({});
      setExpanded(new Set());
      const roots = await listOneDriveRootFolders();
      setFolders(roots);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleToggleExpand = async (folder: OneDriveFolder) => {
    const id = folder.id;
    if (expanded.has(id)) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } else {
      if (!subfolders[id]) {
        try {
          const subs = await listOneDriveFolders(id);
          setSubfolders((prev) => ({ ...prev, [id]: subs }));
        } catch (e) {
          setError(String(e));
          return;
        }
      }
      setExpanded((prev) => new Set(prev).add(id));
    }
  };

  const handleSelectFolder = (folder: OneDriveFolder) => {
    setSelectedFolder(folder);
  };

  const handleAddAsNotesDir = async () => {
    if (!selectedFolder) return;
    try {
      const path = selectedFolder.id;
      await addOneDriveSyncFolder(path, selectedFolder.name, path);
      // Also register as a notes directory so it shows up in the main window.
      const updatedConfig = await addNotesDir(path);
      onChange(updatedConfig);
      setSelectedFolder(null);
      await loadStatus();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleChooseCopyPath = async () => {
    if (!selectedFolder) return;
    try {
      const chosen = await open({ directory: true, multiple: false });
      if (typeof chosen !== "string") return;
      const dest = `${chosen.replace(/\\/g, "/").replace(/\/+$/, "")}/${selectedFolder.name}`;
      await addOneDriveSyncFolder(selectedFolder.id, selectedFolder.name, dest);
      // Also register as a notes directory.
      const updatedConfig = await addNotesDir(dest);
      onChange(updatedConfig);
      setSelectedFolder(null);
      await loadStatus();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleRemoveFolder = async (folderId: string) => {
    try {
      // Find the sync info to get the path for notesDirs removal.
      const info = status?.syncFolders.find((f) => f.folderId === folderId);
      await removeOneDriveSyncFolder(folderId);
      if (info) {
        const updatedConfig = await deleteNotesDir(info.localPath);
        onChange(updatedConfig);
      }
      await loadStatus();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleLogout = async () => {
    try {
      await logoutOneDrive();
      setStatus(null);
      setFolders([]);
      setSubfolders({});
      setExpanded(new Set());
      setSelectedFolder(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const renderFolderTree = (items: OneDriveFolder[], depth: number): React.ReactNode =>
    items.map((f) => (
      <div key={f.id}>
        <button
          type="button"
          onClick={() => handleToggleExpand(f)}
          className="w-full flex items-center gap-1.5 py-1.5 px-2 rounded text-[11px] text-ink-soft hover:bg-paper-warm/70 transition-colors text-left cursor-pointer"
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          <ChevronIcon direction={expanded.has(f.id) ? "down" : "right"} />
          <FolderIcon open={expanded.has(f.id)} className="text-ink-faint/60 shrink-0" />
          <span className="truncate flex-1">{f.name}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleSelectFolder(f);
            }}
            className="text-[10px] px-1.5 py-0.5 rounded border border-bamboo/30 text-bamboo hover:bg-bamboo-mist/30 cursor-pointer"
          >
            {t("settings.oneDrive.useFolder", { defaultValue: "选择" })}
          </button>
        </button>
        {expanded.has(f.id) && subfolders[f.id] && renderFolderTree(subfolders[f.id], depth + 1)}
      </div>
    ));

  if (loading) {
    return (
      <section className="space-y-2">
        <label className="block text-[11px] font-body text-ink-faint">
          {t("settings.oneDrive.sectionTitle", { defaultValue: "OneDrive 云同步" })}
        </label>
        <p className="text-[11px] text-ink-ghost">…</p>
      </section>
    );
  }

  const loggedIn = status?.loggedIn ?? false;
  const rootPath = status?.oneDriveRoot ?? "";

  return (
    <section className="space-y-2">
      <label className="flex items-center gap-1.5 text-[11px] font-body text-ink-faint">
        <OneDriveLogo className="text-ink-faint/70" />
        {t("settings.oneDrive.sectionTitle", { defaultValue: "OneDrive 云同步" })}
      </label>

      {error && <p className="text-[11px] text-red-400 bg-red-50/50 px-2 py-1 rounded">{error}</p>}

      {!loggedIn ? (
        <div className="space-y-2">
          <p className="text-[10px] text-ink-ghost/70 leading-relaxed">
            {t("settings.oneDrive.notFoundHint", {
              defaultValue:
                "未检测到 OneDrive 本地文件夹。请确保已安装 OneDrive 桌面客户端并完成首次同步。",
            })}
          </p>
          <p className="text-[10px] text-ink-ghost/50">
            {t("settings.oneDrive.notFoundDetail", {
              defaultValue:
                "OneDrive 客户端会自动将云端文件同步到本地文件夹，花笺可直接读取该文件夹中的内容。",
            })}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span
              className="flex items-center gap-1.5 text-[11px] text-ink-soft truncate max-w-[220px]"
              title={rootPath}
            >
              <CloudIcon className="text-bamboo/70 shrink-0" />
              <span className="truncate">{rootPath}</span>
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="text-[10px] text-ink-ghost hover:text-red-400 transition-colors cursor-pointer"
            >
              {t("settings.oneDrive.clearConfig", { defaultValue: "清除配置" })}
            </button>
          </div>

          {/* Synced folders */}
          {status!.syncFolders.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-ink-faint/70">
                {t("settings.oneDrive.syncedFolders", { defaultValue: "已记录的文件夹" })}:
              </p>
              {status!.syncFolders.map((sf: OneDriveSyncFolder) => (
                <div
                  key={sf.folderId}
                  className="flex items-center justify-between px-2 py-1 rounded bg-paper-warm/50 border border-paper-deep/25"
                >
                  <span className="flex items-center gap-1.5 text-[11px] text-ink-soft truncate flex-1">
                    <CloudIcon className="text-bamboo/50 shrink-0" />
                    <span className="truncate">{sf.folderName}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveFolder(sf.folderId)}
                    className="text-ink-ghost hover:text-red-400 transition-colors cursor-pointer ml-2"
                    title={t("common.delete", { defaultValue: "删除" })}
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Browse OneDrive folders */}
          <button
            type="button"
            onClick={handleBrowseFolders}
            className="w-full h-7 rounded-lg border border-paper-deep/35 text-[11px] text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/30 transition-colors cursor-pointer"
          >
            {t("settings.oneDrive.browseFolders", { defaultValue: "浏览 OneDrive 文件夹" })}
          </button>

          {folders.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-lg border border-paper-deep/25 bg-paper-warm/30 p-1">
              {renderFolderTree(folders, 0)}
            </div>
          )}

          {/* Selected folder actions */}
          {selectedFolder && (
            <div className="rounded-lg border border-bamboo/30 bg-bamboo-mist/10 p-2 space-y-1.5">
              <p className="flex items-center gap-1.5 text-[11px] text-ink-soft">
                <FolderIcon open className="text-bamboo/60 shrink-0" />
                <span className="truncate">{selectedFolder.name}</span>
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAddAsNotesDir}
                  className="flex-1 h-7 rounded-lg border border-bamboo/40 text-[11px] text-bamboo hover:bg-bamboo-mist/30 transition-colors cursor-pointer"
                >
                  {t("settings.oneDrive.useDirectly", { defaultValue: "直接使用" })}
                </button>
                <button
                  type="button"
                  onClick={handleChooseCopyPath}
                  className="flex-1 h-7 rounded-lg border border-paper-deep/40 text-[11px] text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/30 transition-colors cursor-pointer"
                >
                  {t("settings.oneDrive.copyTo", { defaultValue: "复制到…" })}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
