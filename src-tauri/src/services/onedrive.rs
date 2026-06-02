use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use super::notes::AppError;

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OneDriveFolder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncInfo {
    pub folder_id: String,
    pub folder_name: String,
    pub local_path: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OneDriveStatus {
    pub logged_in: bool,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub sync_folders: Vec<SyncInfo>,
    pub one_drive_root: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub folder_id: String,
    pub status: String,
    pub last_sync: Option<String>,
    pub message: Option<String>,
    pub files_downloaded: u32,
    pub files_uploaded: u32,
}

// ---------------------------------------------------------------------------
// OneDrive service
// ---------------------------------------------------------------------------

pub struct OneDriveService {
    data_dir: PathBuf,
    sync_infos: Mutex<Vec<SyncInfo>>,
}

impl OneDriveService {
    pub fn new(data_dir: PathBuf) -> Self {
        let svc = Self {
            data_dir,
            sync_infos: Mutex::new(Vec::new()),
        };
        let _ = svc.load_sync_config();
        svc
    }

    // -------------------------------------------------------------------
    // OneDrive root detection
    // -------------------------------------------------------------------

    pub fn detect_one_drive_root() -> Option<PathBuf> {
        // 1. Environment variables
        for var in &["OneDrive", "OneDriveConsumer"] {
            if let Ok(val) = std::env::var(var) {
                let p = PathBuf::from(val.trim());
                if p.is_dir() {
                    return Some(p);
                }
            }
        }

        // 2. Windows registry
        #[cfg(target_os = "windows")]
        {
            if let Some(p) = Self::detect_from_registry() {
                return Some(p);
            }
        }

        // 3. Default path
        let home = dirs_fallback();
        for name in &["OneDrive", "OneDrive - Personal"] {
            let p = home.join(name);
            if p.is_dir() {
                return Some(p);
            }
        }

        None
    }

    #[cfg(target_os = "windows")]
    fn detect_from_registry() -> Option<PathBuf> {
        let output = std::process::Command::new("reg")
            .args([
                "query",
                r"HKCU\Software\Microsoft\OneDrive\Accounts\Personal",
                "/v",
                "UserFolder",
            ])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.contains("UserFolder") {
                let parts: Vec<&str> = line.splitn(4, "REG_SZ").collect();
                if parts.len() >= 2 {
                    let p = PathBuf::from(parts[1].trim());
                    if p.is_dir() {
                        return Some(p);
                    }
                }
            }
        }
        None
    }

    #[cfg(not(target_os = "windows"))]
    fn detect_from_registry() -> Option<PathBuf> {
        None
    }

    // -------------------------------------------------------------------
    // Folder listing (local filesystem)
    // -------------------------------------------------------------------

    pub fn list_folders(&self, parent: &Path) -> Result<Vec<OneDriveFolder>, AppError> {
        let mut folders = Vec::new();
        for entry in fs::read_dir(parent)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.starts_with('~') {
                continue;
            }
            let full = entry.path();
            folders.push(OneDriveFolder {
                id: full.to_string_lossy().to_string(),
                name,
                parent_id: Some(parent.to_string_lossy().to_string()),
            });
        }
        folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(folders)
    }

    pub fn list_root_folders(&self, root: &Path) -> Result<Vec<OneDriveFolder>, AppError> {
        self.list_folders(root)
    }

    // -------------------------------------------------------------------
    // Status
    // -------------------------------------------------------------------

    pub fn is_logged_in(&self) -> bool {
        Self::detect_one_drive_root().is_some()
    }

    pub fn get_sync_infos(&self) -> Vec<SyncInfo> {
        self.sync_infos.lock().unwrap().clone()
    }

    pub fn get_status(&self) -> OneDriveStatus {
        let root = Self::detect_one_drive_root();
        OneDriveStatus {
            logged_in: root.is_some(),
            email: None,
            display_name: None,
            sync_folders: self.get_sync_infos(),
            one_drive_root: root.map(|p| p.to_string_lossy().to_string()),
        }
    }

    // -------------------------------------------------------------------
    // Sync folder config persistence
    // -------------------------------------------------------------------

    fn sync_config_file(&self) -> PathBuf {
        self.data_dir.join("sync_config.json")
    }

    fn load_sync_config(&self) -> Result<(), AppError> {
        let path = self.sync_config_file();
        if path.exists() {
            let raw = fs::read_to_string(&path)?;
            if let Ok(infos) = serde_json::from_str::<Vec<SyncInfo>>(&raw) {
                *self.sync_infos.lock().unwrap() = infos;
            }
        }
        Ok(())
    }

    fn save_sync_config(&self, infos: &[SyncInfo]) -> Result<(), AppError> {
        fs::create_dir_all(&self.data_dir)?;
        fs::write(
            &self.sync_config_file(),
            serde_json::to_string_pretty(infos)?,
        )?;
        Ok(())
    }

    pub fn add_sync_folder(
        &self,
        folder_id: &str,
        folder_name: &str,
        local_path: &str,
    ) -> Result<(), AppError> {
        let mut infos = self.sync_infos.lock().unwrap();
        infos.retain(|i| i.folder_id != folder_id);
        infos.push(SyncInfo {
            folder_id: folder_id.to_string(),
            folder_name: folder_name.to_string(),
            local_path: local_path.to_string(),
            enabled: true,
        });
        self.save_sync_config(&infos)
    }

    pub fn remove_sync_folder(&self, folder_id: &str) -> Result<(), AppError> {
        let mut infos = self.sync_infos.lock().unwrap();
        infos.retain(|i| i.folder_id != folder_id);
        self.save_sync_config(&infos)
    }

    /// Return all local paths currently tracked as OneDrive sync folders.
    pub fn get_synced_paths(&self) -> Vec<String> {
        self.sync_infos
            .lock()
            .unwrap()
            .iter()
            .map(|i| i.local_path.clone())
            .collect()
    }

    pub fn logout(&self) -> Result<(), AppError> {
        let mut infos = self.sync_infos.lock().unwrap();
        infos.clear();
        let cf = self.sync_config_file();
        if cf.exists() {
            let _ = fs::remove_file(&cf);
        }
        Ok(())
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }
}

fn dirs_fallback() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("C:\\"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/"))
    }
}
