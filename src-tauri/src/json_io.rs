use crate::services::notes::AppError;
use serde::Serialize;
use std::{
    fs,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let temp_path = temporary_json_path(path);
    let result = (|| {
        let mut temp_file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)?;
        serde_json::to_writer_pretty(&mut temp_file, value)?;
        temp_file.write_all(b"\n")?;
        temp_file.sync_all()?;
        drop(temp_file);
        fs::rename(&temp_path, path)?;
        sync_parent_dir(path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

fn temporary_json_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("state.json");
    // load_config, list_notes and list_categories are intentionally started in
    // parallel by the frontend. A shared `<name>.tmp` made those atomic writes
    // truncate or rename each other's temporary file, producing intermittent
    // EOF / file-not-found errors during startup.
    path.with_file_name(format!("{file_name}.{}.tmp", Uuid::new_v4()))
}

#[cfg(not(target_os = "windows"))]
fn sync_parent_dir(path: &Path) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn sync_parent_dir(_path: &Path) -> Result<(), AppError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn concurrent_atomic_writes_never_share_a_temp_file() {
        let dir = tempfile::tempdir().expect("temp directory");
        let path = dir.path().join("config.json");
        let handles = (0..16)
            .map(|value| {
                let path = path.clone();
                std::thread::spawn(move || write_json_atomic(&path, &json!({ "value": value })))
            })
            .collect::<Vec<_>>();

        for handle in handles {
            handle.join().expect("writer thread").expect("atomic write");
        }

        let saved: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(path).expect("read final JSON after concurrent writes"),
        )
        .expect("final JSON is complete");
        assert!(saved["value"].as_u64().is_some());
    }
}
