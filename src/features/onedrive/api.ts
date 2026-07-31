import { invoke } from "@tauri-apps/api/core";
import type { OneDriveFolder, OneDriveStatus, SyncStatus } from "./types";

/** Get OneDrive connection status and list of synced folders. */
export function getOneDriveStatus(): Promise<OneDriveStatus> {
  return invoke("one_drive_status");
}

/** List subfolders at a given local path. */
export function listOneDriveFolders(parentPath: string): Promise<OneDriveFolder[]> {
  return invoke("one_drive_list_folders", { parentPath });
}

/** List folders at the auto-detected OneDrive root. */
export function listOneDriveRootFolders(): Promise<OneDriveFolder[]> {
  return invoke("one_drive_list_root_folders");
}

/** Add a folder to the sync config. */
export function addOneDriveSyncFolder(
  folderId: string,
  folderName: string,
  localPath: string,
): Promise<void> {
  return invoke("one_drive_add_sync_folder", { folderId, folderName, localPath });
}

/** Remove a sync folder from the config. */
export function removeOneDriveSyncFolder(folderId: string): Promise<void> {
  return invoke("one_drive_remove_sync_folder", { folderId });
}

/** Get sync status for all folders. */
export function getOneDriveSyncStatus(): Promise<SyncStatus[]> {
  return invoke("one_drive_sync_status");
}

/** Get the list of local paths managed by OneDrive sync config. */
export function getOneDriveSyncedPaths(): Promise<string[]> {
  return invoke("one_drive_synced_paths");
}

/** Clear sync config (logout). */
export function logoutOneDrive(): Promise<void> {
  return invoke("one_drive_logout");
}
