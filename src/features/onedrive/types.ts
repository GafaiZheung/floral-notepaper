/** OneDrive folder info returned from Graph API. */
export interface OneDriveFolder {
  id: string;
  name: string;
  parentId?: string;
}

/** Sync folder configuration. */
export interface OneDriveSyncFolder {
  folderId: string;
  folderName: string;
  localPath: string;
  enabled: boolean;
}

/** Overall OneDrive connection and sync status. */
export interface OneDriveStatus {
  loggedIn: boolean;
  email?: string;
  displayName?: string;
  syncFolders: OneDriveSyncFolder[];
  /** Auto-detected OneDrive root folder path. */
  oneDriveRoot?: string;
}

/** Per-folder sync status. */
export interface SyncStatus {
  folderId: string;
  status: "idle" | "syncing" | "error";
  lastSync?: string;
  message?: string;
  filesDownloaded: number;
  filesUploaded: number;
}
