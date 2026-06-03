pub mod desktop;
pub mod locales;
pub mod services;

use locales::Locale;
use services::notes::{
    default_store, AppConfig, AppError, Note, NoteMetadata, OpenedFileClassification,
    SaveNoteRequest,
};
use services::onedrive::{OneDriveFolder, OneDriveService, OneDriveStatus, SyncStatus};
use services::watcher::NotesWatcher;
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager};

const APP_FONT_FAMILY: &str = "HarmonyOS Sans SC";
const APP_FONT_BYTES: &[u8] = include_bytes!("../../src/assets/fonts/HarmonyOS_Sans_SC.ttf");

#[tauri::command]
fn app_name() -> Result<String, AppError> {
    let locale = Locale::from_tag(&default_store()?.load_config()?.locale);
    Ok(locales::app_name(locale).to_string())
}

#[tauri::command]
fn notes_list() -> Result<Vec<NoteMetadata>, AppError> {
    default_store()?.list_notes()
}

#[tauri::command]
fn notes_get(id: String) -> Result<Note, AppError> {
    default_store()?.read_note(&id)
}

#[tauri::command]
fn notes_create(app: AppHandle, request: SaveNoteRequest) -> Result<Note, AppError> {
    let note = default_store()?.create_note(request)?;
    let _ = app.emit("notes-changed", ());
    Ok(note)
}

#[tauri::command]
fn notes_update(app: AppHandle, id: String, request: SaveNoteRequest) -> Result<Note, AppError> {
    let note = default_store()?.update_note(&id, request)?;
    let _ = app.emit("notes-changed", ());
    Ok(note)
}

#[tauri::command]
fn notes_delete(app: AppHandle, id: String) -> Result<(), AppError> {
    default_store()?.delete_note(&id)?;
    let _ = app.emit("notes-changed", ());
    Ok(())
}

#[tauri::command]
fn notes_import_markdown(
    app: AppHandle,
    path: String,
    category: Option<String>,
) -> Result<Note, AppError> {
    let note = default_store()?
        .import_markdown_file(&PathBuf::from(path), &category.unwrap_or_default())?;
    let _ = app.emit("notes-changed", ());
    Ok(note)
}

#[tauri::command]
fn notes_export_markdown(id: String, path: String) -> Result<(), AppError> {
    default_store()?.export_markdown_file(&id, &PathBuf::from(path))
}

#[tauri::command]
fn read_external_file(path: String) -> Result<String, AppError> {
    std::fs::read_to_string(&path).map_err(|e| AppError {
        code: "io".into(),
        message: e.to_string(),
        details: Default::default(),
    })
}

#[tauri::command]
fn get_file_modified_time(path: String) -> Result<f64, AppError> {
    let metadata = std::fs::metadata(&path).map_err(|e| AppError {
        code: "io".into(),
        message: e.to_string(),
        details: Default::default(),
    })?;
    let modified = metadata.modified().map_err(|e| AppError {
        code: "io".into(),
        message: e.to_string(),
        details: Default::default(),
    })?;
    let duration = modified
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    Ok(duration.as_secs_f64() * 1000.0)
}

#[tauri::command]
fn save_external_file(path: String, content: String) -> Result<(), AppError> {
    if let Some(parent) = PathBuf::from(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError {
            code: "io".into(),
            message: e.to_string(),
            details: Default::default(),
        })?;
    }
    std::fs::write(&path, content).map_err(|e| AppError {
        code: "io".into(),
        message: e.to_string(),
        details: Default::default(),
    })
}

#[tauri::command]
fn convert_svg_to_png(svg: String, path: String) -> Result<(), AppError> {
    // Load system fonts and register generic family mappings.
    // Mermaid SVGs use font-family like "var(--font-body), sans-serif"
    // usvg can't resolve CSS vars, so it falls back to generic "sans-serif".
    // We must map generic families to actual system fonts.
    let mut fontdb = fontdb::Database::new();
    fontdb.load_system_fonts();
    fontdb.load_font_source(fontdb::Source::Binary(std::sync::Arc::new(APP_FONT_BYTES)));
    fontdb.set_sans_serif_family(APP_FONT_FAMILY);
    fontdb.set_serif_family("Times New Roman");
    fontdb.set_monospace_family("Consolas");

    let mut opts = usvg::Options::default();
    // Default when the SVG's font-family can't be resolved at all
    opts.font_family = APP_FONT_FAMILY.into();
    opts.font_size = 14.0;
    opts.fontdb = std::sync::Arc::new(fontdb);

    let tree = usvg::Tree::from_str(&svg, &opts).map_err(|e| AppError {
        code: "svgParse".into(),
        message: e.to_string(),
        details: Default::default(),
    })?;

    let size = tree.size();
    let pixmap_size =
        tiny_skia::IntSize::from_wh((size.width() as u32).max(1), (size.height() as u32).max(1))
            .ok_or_else(|| AppError {
                code: "svgRender".into(),
                message: "invalid SVG dimensions".into(),
                details: Default::default(),
            })?;

    let mut pixmap =
        tiny_skia::Pixmap::new(pixmap_size.width(), pixmap_size.height()).ok_or_else(|| {
            AppError {
                code: "svgRender".into(),
                message: "failed to create pixmap".into(),
                details: Default::default(),
            }
        })?;

    // Fill with white so background is not transparent
    pixmap.fill(tiny_skia::Color::from_rgba8(255, 255, 255, 255));

    resvg::render(&tree, usvg::Transform::default(), &mut pixmap.as_mut());

    let png_bytes = pixmap.encode_png().map_err(|e| AppError {
        code: "pngEncode".into(),
        message: e.to_string(),
        details: Default::default(),
    })?;

    if let Some(parent) = PathBuf::from(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError {
            code: "io".into(),
            message: e.to_string(),
            details: Default::default(),
        })?;
    }
    std::fs::write(&path, png_bytes).map_err(|e| AppError {
        code: "io".into(),
        message: e.to_string(),
        details: Default::default(),
    })
}

#[tauri::command]
fn categories_list() -> Result<Vec<String>, AppError> {
    default_store()?.list_categories()
}

#[tauri::command]
fn categories_create(app: AppHandle, name: String) -> Result<(), AppError> {
    default_store()?.create_category(&name)?;
    let _ = app.emit("notes-changed", ());
    Ok(())
}

#[tauri::command]
fn categories_rename(app: AppHandle, old_name: String, new_name: String) -> Result<(), AppError> {
    default_store()?.rename_category(&old_name, &new_name)?;
    let _ = app.emit("notes-changed", ());
    Ok(())
}

#[tauri::command]
fn categories_delete(app: AppHandle, name: String) -> Result<(), AppError> {
    default_store()?.delete_category(&name)?;
    let _ = app.emit("notes-changed", ());
    Ok(())
}

#[tauri::command]
fn notes_move_category(
    app: AppHandle,
    id: String,
    category: String,
) -> Result<NoteMetadata, AppError> {
    let result = default_store()?.move_note_to_category(&id, &category)?;
    let _ = app.emit("notes-changed", ());
    Ok(result)
}

#[tauri::command]
fn notes_rename_file_stem(
    app: AppHandle,
    id: String,
    stem: String,
) -> Result<NoteMetadata, AppError> {
    let result = default_store()?.rename_file_stem(&id, &stem)?;
    let _ = app.emit("notes-changed", ());
    Ok(result)
}

#[tauri::command]
fn notes_dirs_list() -> Result<Vec<String>, AppError> {
    default_store()?.list_notes_dirs()
}

#[tauri::command]
fn notes_dirs_select(
    app: AppHandle,
    path: String,
    add_to_cache: Option<bool>,
) -> Result<AppConfig, AppError> {
    let config = default_store()?.select_notes_dir(&path, add_to_cache.unwrap_or(true))?;
    let watch_dirs: Vec<PathBuf> = config.notes_dirs.iter().map(PathBuf::from).collect();
    let _ = start_or_reconfigure_watcher(&app, &watch_dirs);
    let _ = app.emit("notes-changed", ());
    let _ = app.emit("config-changed", &config);
    Ok(config)
}

#[tauri::command]
fn notes_dirs_add(app: AppHandle, path: String) -> Result<AppConfig, AppError> {
    let config = default_store()?.add_notes_dir(&path)?;
    let watch_dirs: Vec<PathBuf> = config.notes_dirs.iter().map(PathBuf::from).collect();
    let _ = start_or_reconfigure_watcher(&app, &watch_dirs);
    let _ = app.emit("config-changed", &config);
    Ok(config)
}

#[tauri::command]
fn notes_dirs_delete(app: AppHandle, path: String) -> Result<AppConfig, AppError> {
    let config = default_store()?.remove_notes_dir(&path)?;
    let watch_dirs: Vec<PathBuf> = config.notes_dirs.iter().map(PathBuf::from).collect();
    let _ = start_or_reconfigure_watcher(&app, &watch_dirs);
    let _ = app.emit("notes-changed", ());
    let _ = app.emit("config-changed", &config);
    Ok(config)
}

#[tauri::command]
fn open_file_classify(file_path: String) -> Result<OpenedFileClassification, AppError> {
    default_store()?.classify_opened_file(&file_path)
}

#[tauri::command]
fn config_get() -> Result<AppConfig, AppError> {
    default_store()?.load_config()
}

#[tauri::command]
fn copy_background_image(_app: AppHandle, source_path: String) -> Result<String, AppError> {
    let source = PathBuf::from(source_path.trim());
    if !source.is_file() {
        return Err(AppError {
            code: "invalidSource".into(),
            message: "background image source not found".into(),
            details: Default::default(),
        });
    }

    let store = default_store()?;
    let dir = store.base_dir().join("backgrounds");
    fs::create_dir_all(&dir)?;

    let old_config = store.load_config()?;
    if !old_config.background_image_path.is_empty() {
        let old_path = PathBuf::from(&old_config.background_image_path);
        if old_path.starts_with(&dir) && old_path.is_file() {
            let _ = fs::remove_file(&old_path);
        }
    }

    let ext = source
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("png");
    let dest = dir.join(format!("bg-{}.{}", uuid::Uuid::new_v4(), ext));
    fs::copy(&source, &dest)?;

    dest.to_str().map(str::to_string).ok_or_else(|| AppError {
        code: "path".into(),
        message: "invalid destination path".into(),
        details: Default::default(),
    })
}

#[tauri::command]
fn config_save(app: AppHandle, config: AppConfig) -> Result<AppConfig, AppError> {
    let store = default_store()?;
    let previous = store.load_config()?;
    let notes_dir_changed = previous.notes_dir != config.notes_dir;
    desktop::apply_runtime_config(&app, &previous, &config).map_err(|error| {
        match error.downcast::<AppError>() {
            Ok(app_error) => *app_error,
            Err(error) => AppError {
                code: "desktopConfig".into(),
                message: error.to_string(),
                details: Default::default(),
            },
        }
    })?;
    let saved = store.save_config(config)?;
    if let Err(error) = desktop::refresh_shell_state(&app, &saved) {
        eprintln!("failed to refresh desktop shell state: {error}");
    }
    let _ = app.emit("config-changed", &saved);

    // Reconfigure watcher on any config save (handles notes_dirs changes).
    let watch_dirs: Vec<PathBuf> = saved.notes_dirs.iter().map(PathBuf::from).collect();
    if let Err(e) = start_or_reconfigure_watcher(&app, &watch_dirs) {
        eprintln!("Failed to reconfigure notes watcher: {e}");
    }

    if notes_dir_changed {
        let _ = app.emit("notes-changed", ());
    }
    Ok(saved)
}

/// Helper to start or reconfigure the NotesWatcher managed state.
fn start_or_reconfigure_watcher(
    app: &AppHandle,
    dirs: &[PathBuf],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(state) = app.try_state::<Mutex<NotesWatcher>>() {
        state.lock().unwrap().reconfigure(app.clone(), dirs)
    } else {
        let watcher = NotesWatcher::start(app.clone(), dirs)?;
        app.manage(Mutex::new(watcher));
        Ok(())
    }
}

#[tauri::command]
fn global_shortcut_check(
    app: AppHandle,
    shortcut: String,
) -> Result<desktop::ShortcutCheckResult, AppError> {
    desktop::check_global_shortcut(&app, &shortcut)
}

#[tauri::command]
async fn open_notepad_window(
    app: AppHandle,
    note_id: Option<String>,
    bounds: Option<desktop::WindowBounds>,
) -> Result<String, AppError> {
    desktop::open_notepad_window(app, note_id, bounds).await
}

#[tauri::command]
async fn recycle_notepad_window(app: AppHandle, label: String) -> Result<(), AppError> {
    desktop::recycle_notepad_window(&app, &label)
}

#[tauri::command]
async fn open_tile_window(
    app: AppHandle,
    note_id: String,
    bounds: Option<desktop::WindowBounds>,
) -> Result<String, AppError> {
    desktop::open_tile_window(app, note_id, bounds).await
}

#[tauri::command]
async fn toggle_tile_window(
    app: AppHandle,
    note_id: String,
    bounds: Option<desktop::WindowBounds>,
) -> Result<bool, AppError> {
    desktop::toggle_tile_window(app, note_id, bounds).await
}

#[tauri::command]
async fn open_note_in_editor(app: AppHandle, note_id: String) -> Result<(), AppError> {
    desktop::show_main_window(&app)?;
    let _ = app.emit("open-note", &note_id);
    Ok(())
}

// ---------------------------------------------------------------------------
// OneDrive commands (local folder approach — no OAuth / Graph API needed)
// ---------------------------------------------------------------------------

/// Get OneDrive status: detected root path, sync folder list.
#[tauri::command]
fn one_drive_status(svc: tauri::State<'_, OneDriveService>) -> Result<OneDriveStatus, AppError> {
    Ok(svc.get_status())
}

/// List subfolders at a given local path (used for OneDrive folder browsing).
#[tauri::command]
fn one_drive_list_folders(
    svc: tauri::State<'_, OneDriveService>,
    parent_path: String,
) -> Result<Vec<OneDriveFolder>, AppError> {
    svc.list_folders(&PathBuf::from(&parent_path))
}

/// List folders at the OneDrive root (auto-detected).
#[tauri::command]
fn one_drive_list_root_folders(
    svc: tauri::State<'_, OneDriveService>,
) -> Result<Vec<OneDriveFolder>, AppError> {
    let root = OneDriveService::detect_one_drive_root()
        .ok_or_else(|| AppError::new("oneDrive", "未检测到 OneDrive 文件夹"))?;
    svc.list_folders(&root)
}

/// Add a OneDrive folder to the sync config.
#[tauri::command]
fn one_drive_add_sync_folder(
    svc: tauri::State<'_, OneDriveService>,
    folder_id: String,
    folder_name: String,
    local_path: String,
) -> Result<(), AppError> {
    svc.add_sync_folder(&folder_id, &folder_name, &local_path)
}

/// Remove a sync folder mapping.
#[tauri::command]
fn one_drive_remove_sync_folder(
    svc: tauri::State<'_, OneDriveService>,
    folder_id: String,
) -> Result<(), AppError> {
    svc.remove_sync_folder(&folder_id)
}

/// Get current sync folder status list.
#[tauri::command]
fn one_drive_sync_status(
    svc: tauri::State<'_, OneDriveService>,
) -> Result<Vec<SyncStatus>, AppError> {
    let infos = svc.get_sync_infos();
    Ok(infos
        .into_iter()
        .map(|i| SyncStatus {
            folder_id: i.folder_id,
            status: "idle".into(),
            last_sync: None,
            message: None,
            files_downloaded: 0,
            files_uploaded: 0,
        })
        .collect())
}

/// Clear sync config.
#[tauri::command]
fn one_drive_logout(svc: tauri::State<'_, OneDriveService>) -> Result<(), AppError> {
    svc.logout()
}

/// Get the list of local paths managed by OneDrive sync config.
#[tauri::command]
fn one_drive_synced_paths(svc: tauri::State<'_, OneDriveService>) -> Result<Vec<String>, AppError> {
    Ok(svc.get_synced_paths())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(file_path) = desktop::extract_file_arg(&args) {
                let _ = app.emit("open-external-file", file_path);
            }
            let _ = desktop::show_main_window(app);
        }))
        .setup(|app| {
            // Initialize OneDrive service with data directory.
            let store = default_store()?;
            let onedrive_dir = store.base_dir().join("onedrive");
            app.manage(OneDriveService::new(onedrive_dir));

            desktop::setup_desktop(app)?;

            // Start filesystem watcher for notes directories.
            let config = store.load_config()?;
            let watch_dirs: Vec<PathBuf> = config.notes_dirs.iter().map(PathBuf::from).collect();
            if let Err(e) = start_or_reconfigure_watcher(app.handle(), &watch_dirs) {
                eprintln!("Failed to start notes watcher: {e}");
            }

            Ok(())
        })
        .on_window_event(desktop::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            app_name,
            notes_list,
            notes_get,
            notes_create,
            notes_update,
            notes_delete,
            notes_import_markdown,
            notes_export_markdown,
            notes_move_category,
            notes_rename_file_stem,
            read_external_file,
            save_external_file,
            convert_svg_to_png,
            get_file_modified_time,
            categories_list,
            categories_create,
            categories_rename,
            categories_delete,
            notes_dirs_list,
            notes_dirs_select,
            notes_dirs_add,
            notes_dirs_delete,
            open_file_classify,
            config_get,
            copy_background_image,
            config_save,
            global_shortcut_check,
            open_notepad_window,
            recycle_notepad_window,
            open_tile_window,
            toggle_tile_window,
            open_note_in_editor,
            // OneDrive
            one_drive_status,
            one_drive_list_folders,
            one_drive_list_root_folders,
            one_drive_add_sync_folder,
            one_drive_remove_sync_folder,
            one_drive_sync_status,
            one_drive_synced_paths,
            one_drive_logout
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
