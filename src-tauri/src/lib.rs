pub mod desktop;
pub mod json_io;
pub mod locales;
pub mod services;
pub mod updater;

use locales::Locale;
use services::ai::{
    ai_chat, ai_fim_completion, ai_format_note, ai_generate_title, ai_prefix_completion,
};
use services::git;
use services::notes::{
    default_store, AppConfig, AppError, Note, NoteMetadata, OpenedFileClassification,
    SaveNoteRequest,
};
use services::onedrive::{OneDriveFolder, OneDriveService, OneDriveStatus, SyncStatus};
use services::watcher::NotesWatcher;
use std::{env, fs, io::Write, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

const APP_FONT_FAMILY: &str = "HarmonyOS Sans SC";
const APP_FONT_BYTES: &[u8] = include_bytes!("../../src/assets/fonts/HarmonyOS_Sans_SC.ttf");

/// 在 tokio 阻塞线程池上执行同步 I/O（读/写大文件、JSON 序列化等），
/// 避免阻塞 Tauri 主线程（窗口事件循环）导致 UI 冻结。
async fn run_blocking<T, F>(f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|error| AppError::new("taskJoin", error.to_string()))?
}

#[tauri::command]
fn app_name() -> Result<String, AppError> {
    let locale = Locale::from_tag(&default_store()?.load_config()?.locale);
    Ok(locales::app_name(locale).to_string())
}

#[tauri::command]
async fn notes_list() -> Result<Vec<NoteMetadata>, AppError> {
    let store = default_store()?;
    run_blocking(move || store.list_notes()).await
}

#[tauri::command]
async fn notes_get(id: String) -> Result<Note, AppError> {
    let store = default_store()?;
    run_blocking(move || store.read_note(&id)).await
}

#[tauri::command]
async fn notes_create(app: AppHandle, request: SaveNoteRequest) -> Result<Note, AppError> {
    let store = default_store()?;
    let note = run_blocking(move || store.create_note(request)).await?;
    let _ = app.emit("notes-changed", ());
    Ok(note)
}

#[tauri::command]
async fn notes_update(
    app: AppHandle,
    id: String,
    request: SaveNoteRequest,
) -> Result<Note, AppError> {
    let store = default_store()?;
    let note = run_blocking(move || store.update_note(&id, request)).await?;
    let _ = app.emit("notes-changed", ());
    Ok(note)
}

#[tauri::command]
async fn notes_delete(app: AppHandle, id: String) -> Result<(), AppError> {
    let store = default_store()?;
    run_blocking(move || store.delete_note(&id)).await?;
    let _ = app.emit("notes-changed", ());
    Ok(())
}

#[tauri::command]
async fn notes_import_markdown(
    app: AppHandle,
    path: String,
    category: Option<String>,
) -> Result<Note, AppError> {
    let store = default_store()?;
    let note = run_blocking(move || {
        store.import_markdown_file(&PathBuf::from(path), &category.unwrap_or_default())
    })
    .await?;
    let _ = app.emit("notes-changed", ());
    Ok(note)
}

#[tauri::command]
async fn notes_export_markdown(id: String, path: String) -> Result<(), AppError> {
    let store = default_store()?;
    run_blocking(move || store.export_markdown_file(&id, &PathBuf::from(path))).await
}

#[tauri::command]
async fn read_external_file(path: String) -> Result<String, AppError> {
    run_blocking(move || {
        std::fs::read_to_string(&path).map_err(|e| AppError {
            code: "io".into(),
            message: e.to_string(),
            details: Default::default(),
        })
    })
    .await
}

#[tauri::command]
async fn get_file_modified_time(path: String) -> Result<f64, AppError> {
    run_blocking(move || {
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
    })
    .await
}

#[tauri::command]
async fn save_external_file(path: String, content: String) -> Result<(), AppError> {
    run_blocking(move || {
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
    })
    .await
}

#[tauri::command]
fn open_file_with_system_app(app: AppHandle, path: String) -> Result<(), AppError> {
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| AppError {
            code: "openFile".into(),
            message: e.to_string(),
            details: Default::default(),
        })
}

#[tauri::command]
fn open_note_with_system_app(app: AppHandle, id: String) -> Result<(), AppError> {
    let store = default_store()?;
    let metadata = store.find_note_metadata(&id)?;
    let path = store.note_path_for(&metadata.file_name, &metadata.category);
    app.opener()
        .open_path(path.display().to_string(), None::<&str>)
        .map_err(|e| AppError {
            code: "openFile".into(),
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
fn images_save(request: tauri::ipc::Request<'_>) -> Result<String, AppError> {
    // 前端以 raw payload 直传图片字节流（noteId / 扩展名走 headers），
    // 避免二进制经 JSON 数字数组序列化的巨大内存与耗时开销
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err(AppError {
            code: "invalidPayload".into(),
            message: "images_save expects a raw binary payload".into(),
            details: Default::default(),
        });
    };
    let header = |name: &str| -> Result<String, AppError> {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
            .ok_or_else(|| AppError {
                code: "invalidPayload".into(),
                message: format!("missing {name} header"),
                details: Default::default(),
            })
    };
    let note_id = header("x-note-id")?;
    let extension = header("x-image-ext")?;
    default_store()?.save_image(&note_id, data, &extension)
}

#[tauri::command]
fn images_save_from_path(note_id: String, file_path: String) -> Result<String, AppError> {
    let path = PathBuf::from(&file_path);
    let data = std::fs::read(&path)?;
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("png")
        .to_string();
    default_store()?.save_image(&note_id, &data, &extension)
}

#[tauri::command]
fn images_get_base_dir() -> Result<String, AppError> {
    let store = default_store()?;
    store
        .data_dir()
        .to_str()
        .map(str::to_string)
        .ok_or_else(|| AppError {
            code: "path".into(),
            message: "invalid data dir path".into(),
            details: Default::default(),
        })
}

#[tauri::command]
fn images_clean_unused(note_id: String, content: String) -> Result<Vec<String>, AppError> {
    default_store()?.clean_unused_images(&note_id, &content)
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
async fn config_get() -> Result<AppConfig, AppError> {
    let store = default_store()?;
    run_blocking(move || store.load_config()).await
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
    let dir = store.data_dir().join("backgrounds");
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
async fn config_save(app: AppHandle, config: AppConfig) -> Result<AppConfig, AppError> {
    // 移除 macOS 强制 close_to_tray=true：设置开关应全平台一致生效。
    // （关闭到托盘由 desktop::handle_window_event 按配置决定，Dock 图标由
    //   desktop::sync_macos_dock_icon 按主窗口可见性同步。）

    let store = default_store()?;
    let previous = run_blocking(move || store.load_config()).await?;
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
    let store = default_store()?;
    let saved = run_blocking(move || store.save_config(config)).await?;
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
fn config_migrate_data_dir(app: AppHandle, new_data_dir: String) -> Result<AppConfig, AppError> {
    let store = default_store()?;
    let new_path = PathBuf::from(&new_data_dir).join("floral");
    let new_store = store.migrate_data_to(&new_path)?;

    let scope = app.asset_protocol_scope();
    let _ = scope.allow_directory(new_path.join("images"), true);
    let _ = scope.allow_directory(new_path.join("backgrounds"), true);

    let config = new_store.load_config()?;
    let _ = app.emit("config-changed", &config);
    Ok(config)
}

#[tauri::command]
fn global_shortcut_check(
    app: AppHandle,
    shortcut: String,
) -> Result<desktop::ShortcutCheckResult, AppError> {
    desktop::check_global_shortcut(&app, &shortcut)
}

#[tauri::command]
fn start_shortcut_recording(app: AppHandle) -> Result<(), AppError> {
    desktop::start_shortcut_recording(&app).map_err(|error| AppError {
        code: "shortcutRecording".into(),
        message: error.to_string(),
        details: Default::default(),
    })
}

#[tauri::command]
fn stop_shortcut_recording(app: AppHandle) -> Result<(), AppError> {
    desktop::stop_shortcut_recording(&app).map_err(|error| AppError {
        code: "shortcutRecording".into(),
        message: error.to_string(),
        details: Default::default(),
    })
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

/// Pre-shift the window by `(dx, dy)` logical px before starting an OS drag,
/// so a JS-side deadzone (e.g. tile double-click-to-edit) does not leave the
/// window lagging the cursor by the deadzone displacement.
#[tauri::command]
fn start_window_drag_with_offset(
    window: tauri::WebviewWindow,
    dx: f64,
    dy: f64,
) -> Result<(), AppError> {
    let scale = window.scale_factor()?;
    let pos = window.outer_position()?;
    let next_x = pos.x + (dx * scale).round() as i32;
    let next_y = pos.y + (dy * scale).round() as i32;
    window.set_position(tauri::PhysicalPosition::new(next_x, next_y))?;
    window.start_dragging()?;
    Ok(())
}

/// 原生窗口位移动画：单次 IPC，动画循环在 Rust 侧线程按帧推进，
/// 替代前端逐帧 setPosition/setSize 的多次 IPC。
#[tauri::command]
async fn animate_window_bounds(
    window: tauri::WebviewWindow,
    target: desktop::WindowBounds,
    duration_ms: u64,
) -> Result<(), AppError> {
    desktop::animate_window_bounds(window, target, duration_ms).await
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

#[tauri::command]
fn take_startup_file() -> Option<String> {
    desktop::take_startup_file()
}

// --- 浏览器侧边栏 ---

#[tauri::command]
fn browser_get_state(app: AppHandle) -> services::browser::BrowserState {
    services::browser::get_state(&app)
}

#[tauri::command]
async fn browser_open(
    app: AppHandle,
    url: String,
) -> Result<services::browser::BrowserState, AppError> {
    services::browser::open(app, url).await
}

#[tauri::command]
async fn browser_activate(
    app: AppHandle,
    tab_id: String,
) -> Result<services::browser::BrowserState, AppError> {
    services::browser::activate(app, tab_id).await
}

#[tauri::command]
async fn browser_close(
    app: AppHandle,
    tab_id: String,
) -> Result<services::browser::BrowserState, AppError> {
    services::browser::close(app, tab_id).await
}

#[tauri::command]
async fn browser_navigate(
    app: AppHandle,
    tab_id: String,
    url: String,
) -> Result<services::browser::BrowserState, AppError> {
    services::browser::navigate(app, tab_id, url).await
}

#[tauri::command]
async fn browser_back(
    app: AppHandle,
    tab_id: String,
) -> Result<services::browser::BrowserState, AppError> {
    services::browser::back(app, tab_id).await
}

#[tauri::command]
async fn browser_forward(
    app: AppHandle,
    tab_id: String,
) -> Result<services::browser::BrowserState, AppError> {
    services::browser::forward(app, tab_id).await
}

#[tauri::command]
async fn browser_reload(
    app: AppHandle,
    tab_id: String,
) -> Result<services::browser::BrowserState, AppError> {
    services::browser::reload(app, tab_id).await
}

#[tauri::command]
async fn browser_stop(
    app: AppHandle,
    tab_id: String,
) -> Result<services::browser::BrowserState, AppError> {
    services::browser::stop(app, tab_id).await
}

#[tauri::command]
async fn browser_set_zoom(
    app: AppHandle,
    tab_id: String,
    zoom: f64,
) -> Result<services::browser::BrowserState, AppError> {
    services::browser::set_zoom(app, tab_id, zoom).await
}

#[tauri::command]
async fn browser_toggle_float(
    app: AppHandle,
    tab_id: String,
) -> Result<services::browser::BrowserState, AppError> {
    services::browser::toggle_float(app, tab_id).await
}

#[tauri::command]
async fn browser_set_width(
    app: AppHandle,
    width: f64,
) -> Result<services::browser::BrowserState, AppError> {
    services::browser::set_width(app, width).await
}

#[tauri::command]
async fn browser_set_visible(
    app: AppHandle,
    visible: bool,
) -> Result<services::browser::BrowserState, AppError> {
    services::browser::set_visible(app, visible).await
}

fn cli_version_or_help_requested() -> bool {
    env::args().any(|arg| matches!(arg.as_str(), "--version" | "-V" | "--help" | "-h"))
}

#[cfg(windows)]
fn ensure_console() {
    use windows_sys::Win32::System::Console::{AllocConsole, AttachConsole, ATTACH_PARENT_PROCESS};

    unsafe {
        if AttachConsole(ATTACH_PARENT_PROCESS) == 0 {
            let _ = AllocConsole();
        }
    }
}

#[cfg(not(windows))]
fn ensure_console() {}

fn flush_attached_console_stdout() {
    let _ = std::io::stdout().flush();
}

fn print_cli_version() {
    let _ = writeln!(
        std::io::stdout(),
        "floral-notepaper {}",
        env!("CARGO_PKG_VERSION")
    );
    flush_attached_console_stdout();
}

fn print_cli_help() {
    let _ = writeln!(
        std::io::stdout(),
        "floral-notepaper {}\nFloral Notepaper - lightweight local note app\n\nUSAGE:\n    floral-notepaper [OPTIONS]\n\nOPTIONS:\n    -V, --version\n            Print version\n    -h, --help\n            Print help",
        env!("CARGO_PKG_VERSION"),
    );
    flush_attached_console_stdout();
}

pub fn try_exit_for_cli_version_or_help() {
    if !cli_version_or_help_requested() {
        return;
    }

    ensure_console();

    let wants_version = env::args().any(|arg| arg == "--version" || arg == "-V");
    let wants_help = env::args().any(|arg| arg == "--help" || arg == "-h");

    if wants_version {
        print_cli_version();
        std::process::exit(0);
    }

    if wants_help {
        print_cli_help();
        std::process::exit(0);
    }

    std::process::exit(0);
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

// ---------------------------------------------------------------------------
// Git commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn git_check_installed() -> Result<bool, AppError> {
    Ok(git::check_git_installed())
}

#[tauri::command]
fn git_is_repo(path: String) -> Result<bool, AppError> {
    Ok(git::is_git_repo(std::path::Path::new(&path)))
}

#[tauri::command]
fn git_init(path: String) -> Result<String, AppError> {
    git::git_init(std::path::Path::new(&path))
}

#[tauri::command]
fn git_status(path: String) -> Result<git::GitStatus, AppError> {
    git::git_status(std::path::Path::new(&path))
}

#[tauri::command]
fn git_stage_files(path: String, files: Vec<String>) -> Result<String, AppError> {
    git::git_stage_files(std::path::Path::new(&path), &files)
}

#[tauri::command]
fn git_stage_all(path: String) -> Result<String, AppError> {
    git::git_stage_all(std::path::Path::new(&path))
}

#[tauri::command]
fn git_unstage_files(path: String, files: Vec<String>) -> Result<String, AppError> {
    git::git_unstage_files(std::path::Path::new(&path), &files)
}

#[tauri::command]
fn git_commit(path: String, message: String) -> Result<String, AppError> {
    git::git_commit(std::path::Path::new(&path), &message)
}

#[tauri::command]
fn git_log(path: String, count: Option<u32>) -> Result<Vec<git::GitCommit>, AppError> {
    git::git_log(std::path::Path::new(&path), count)
}

#[tauri::command]
fn git_revert_file(path: String, file: String) -> Result<String, AppError> {
    git::git_revert_file(std::path::Path::new(&path), &file)
}

// --- Branch commands ---

#[tauri::command]
fn git_branch_list(path: String) -> Result<Vec<git::GitBranch>, AppError> {
    git::git_branch_list(std::path::Path::new(&path))
}

#[tauri::command]
fn git_branch_create(path: String, name: String) -> Result<String, AppError> {
    git::git_branch_create(std::path::Path::new(&path), &name)
}

#[tauri::command]
fn git_branch_switch(path: String, name: String) -> Result<String, AppError> {
    git::git_branch_switch(std::path::Path::new(&path), &name)
}

#[tauri::command]
fn git_branch_delete(path: String, name: String, force: bool) -> Result<String, AppError> {
    git::git_branch_delete(std::path::Path::new(&path), &name, force)
}

#[tauri::command]
fn git_branch_merge(path: String, name: String) -> Result<String, AppError> {
    git::git_branch_merge(std::path::Path::new(&path), &name)
}

// --- Remote commands ---

#[tauri::command]
fn git_remote_list(path: String) -> Result<Vec<git::GitRemote>, AppError> {
    git::git_remote_list(std::path::Path::new(&path))
}

#[tauri::command]
fn git_remote_add(path: String, name: String, url: String) -> Result<String, AppError> {
    git::git_remote_add(std::path::Path::new(&path), &name, &url)
}

#[tauri::command]
fn git_remote_remove(path: String, name: String) -> Result<String, AppError> {
    git::git_remote_remove(std::path::Path::new(&path), &name)
}

#[tauri::command]
fn git_push(
    path: String,
    remote: Option<String>,
    branch: Option<String>,
) -> Result<String, AppError> {
    git::git_push(
        std::path::Path::new(&path),
        remote.as_deref(),
        branch.as_deref(),
    )
}

#[tauri::command]
fn git_pull(
    path: String,
    remote: Option<String>,
    branch: Option<String>,
) -> Result<String, AppError> {
    git::git_pull(
        std::path::Path::new(&path),
        remote.as_deref(),
        branch.as_deref(),
    )
}

#[tauri::command]
fn git_fetch(path: String, remote: Option<String>) -> Result<String, AppError> {
    git::git_fetch(std::path::Path::new(&path), remote.as_deref())
}

// --- Diff commands ---

#[tauri::command]
fn git_diff_unstaged(path: String, file: Option<String>) -> Result<String, AppError> {
    git::git_diff_unstaged(std::path::Path::new(&path), file.as_deref())
}

#[tauri::command]
fn git_diff_staged(path: String, file: Option<String>) -> Result<String, AppError> {
    git::git_diff_staged(std::path::Path::new(&path), file.as_deref())
}

#[tauri::command]
fn git_diff_commit(path: String, hash: String) -> Result<String, AppError> {
    git::git_diff_commit(std::path::Path::new(&path), &hash)
}

// --- Stash commands ---

#[tauri::command]
fn git_stash_push(path: String, message: Option<String>) -> Result<String, AppError> {
    git::git_stash_push(std::path::Path::new(&path), message.as_deref())
}

#[tauri::command]
fn git_stash_pop(path: String, index: Option<u32>) -> Result<String, AppError> {
    git::git_stash_pop(std::path::Path::new(&path), index)
}

#[tauri::command]
fn git_stash_list(path: String) -> Result<Vec<git::GitStashEntry>, AppError> {
    git::git_stash_list(std::path::Path::new(&path))
}

#[tauri::command]
fn git_stash_drop(path: String, index: Option<u32>) -> Result<String, AppError> {
    git::git_stash_drop(std::path::Path::new(&path), index)
}

// --- Advanced commands ---

#[tauri::command]
fn git_commit_amend(path: String) -> Result<String, AppError> {
    git::git_commit_amend(std::path::Path::new(&path))
}

#[tauri::command]
fn git_has_conflicts(path: String) -> Result<bool, AppError> {
    git::git_has_conflicts(std::path::Path::new(&path))
}

#[tauri::command]
fn git_conflicted_files(path: String) -> Result<Vec<String>, AppError> {
    git::git_conflicted_files(std::path::Path::new(&path))
}

#[tauri::command]
fn git_abort_merge(path: String) -> Result<String, AppError> {
    git::git_abort_merge(std::path::Path::new(&path))
}

#[tauri::command]
fn git_read_gitignore(path: String) -> Result<String, AppError> {
    git::git_read_gitignore(std::path::Path::new(&path))
}

#[tauri::command]
fn git_write_gitignore(path: String, content: String) -> Result<(), AppError> {
    git::git_write_gitignore(std::path::Path::new(&path), &content)
}

// --- Graph command ---

#[tauri::command]
fn git_graph(path: String, count: Option<u32>) -> Result<Vec<git::GitGraphNode>, AppError> {
    git::git_graph(std::path::Path::new(&path), count)
}

// --- Remote repo creation ---

#[tauri::command]
fn git_create_remote_repo(request: git::GitCreateRepoRequest) -> Result<String, AppError> {
    git::git_create_remote_repo(&request)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(file_path) = desktop::extract_file_arg(&args) {
                let _ = app.emit("open-external-file", file_path);
            }
            let _ = desktop::show_main_window(app);
        }))
        .setup(|app| {
            if let Ok(store) = default_store() {
                let data = store.data_dir();
                let scope = app.asset_protocol_scope();
                let _ = scope.allow_directory(data.join("images"), true);
                let _ = scope.allow_directory(data.join("backgrounds"), true);
            }
            let updater_state = updater::UpdaterState::new(app.package_info().version.to_string());
            if let Err(error) = updater_state.initialize() {
                eprintln!("failed to initialize updater infrastructure: {error}");
            }
            app.manage(updater_state);
            updater::start_auto_check_scheduler(app.handle().clone());
            desktop::setup_desktop(app)?;
            // 多笔记目录支持：启动文件系统监视器
            if let Ok(store) = default_store() {
                if let Ok(config) = store.load_config() {
                    let watch_dirs: Vec<PathBuf> =
                        config.notes_dirs.iter().map(PathBuf::from).collect();
                    if let Err(e) = start_or_reconfigure_watcher(app.handle(), &watch_dirs) {
                        eprintln!("Failed to start notes watcher: {e}");
                    }
                }
            }
            #[cfg(target_os = "macos")]
            {
                // --silent 启动（仅菜单栏托盘）→ Accessory（无 Dock 图标）；
                // 正常启动 → Regular（Dock 图标随主窗口可见性由 desktop::sync_macos_dock_icon 管理）。
                let silent = std::env::args().any(|a| a == "--silent");
                app.set_activation_policy(if silent {
                    tauri::ActivationPolicy::Accessory
                } else {
                    tauri::ActivationPolicy::Regular
                });
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
            open_file_with_system_app,
            open_note_with_system_app,
            save_external_file,
            convert_svg_to_png,
            get_file_modified_time,
            categories_list,
            categories_create,
            categories_rename,
            categories_delete,
            images_save,
            images_save_from_path,
            images_get_base_dir,
            images_clean_unused,
            notes_dirs_list,
            notes_dirs_select,
            notes_dirs_add,
            notes_dirs_delete,
            open_file_classify,
            config_get,
            copy_background_image,
            config_save,
            config_migrate_data_dir,
            global_shortcut_check,
            start_shortcut_recording,
            stop_shortcut_recording,
            open_notepad_window,
            recycle_notepad_window,
            start_window_drag_with_offset,
            animate_window_bounds,
            open_tile_window,
            open_note_in_editor,
            ai_chat,
            ai_prefix_completion,
            ai_fim_completion,
            ai_generate_title,
            ai_format_note,
            toggle_tile_window,
            browser_get_state,
            browser_open,
            browser_activate,
            browser_close,
            browser_navigate,
            browser_back,
            browser_forward,
            browser_reload,
            browser_stop,
            browser_set_zoom,
            browser_toggle_float,
            browser_set_width,
            browser_set_visible,
            updater::commands::update_status,
            updater::commands::update_settings_get,
            updater::commands::update_settings_save,
            updater::commands::update_mirror_chyan_cdk_set,
            updater::commands::update_mirror_chyan_cdk_clear,
            updater::commands::update_mirror_chyan_cdk_get,
            updater::commands::update_check,
            updater::commands::update_download,
            updater::commands::update_install,
            updater::commands::update_install_prepare_report,
            updater::commands::update_cancel,
            take_startup_file,
            // OneDrive
            one_drive_status,
            one_drive_list_folders,
            one_drive_list_root_folders,
            one_drive_add_sync_folder,
            one_drive_remove_sync_folder,
            one_drive_sync_status,
            one_drive_synced_paths,
            one_drive_logout,
            // Git
            git_check_installed,
            git_is_repo,
            git_init,
            git_status,
            git_stage_files,
            git_stage_all,
            git_unstage_files,
            git_commit,
            git_log,
            git_revert_file,
            // Git – Branch
            git_branch_list,
            git_branch_create,
            git_branch_switch,
            git_branch_delete,
            git_branch_merge,
            // Git – Remote
            git_remote_list,
            git_remote_add,
            git_remote_remove,
            git_push,
            git_pull,
            git_fetch,
            // Git – Diff
            git_diff_unstaged,
            git_diff_staged,
            git_diff_commit,
            // Git – Stash
            git_stash_push,
            git_stash_pop,
            git_stash_list,
            git_stash_drop,
            // Git – Advanced
            git_commit_amend,
            git_has_conflicts,
            git_conflicted_files,
            git_abort_merge,
            git_read_gitignore,
            git_write_gitignore,
            // Git – Graph
            git_graph,
            // Git – Remote create
            git_create_remote_repo
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = _event
            {
                if !has_visible_windows {
                    if let Err(error) = desktop::show_main_window(_app_handle) {
                        eprintln!("failed to show main window on dock click: {error}");
                    }
                }
            }
        });
}
