use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    path::PathBuf,
    sync::mpsc,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

/// A filesystem watcher that monitors notes directories for `.md` file changes
/// and emits `notes-changed` events so the frontend can refresh.
pub struct NotesWatcher {
    /// Sender to signal the watcher thread to stop.
    stop_tx: Option<mpsc::Sender<()>>,
    /// Handle to the watcher background thread.
    _thread: Option<std::thread::JoinHandle<()>>,
}

impl NotesWatcher {
    /// Start watching the given directories (recursively) for `.md` file changes.
    /// Emits `notes-changed` on any create / modify / remove event, debounced at 300ms.
    pub fn start(
        app_handle: AppHandle,
        dirs: &[PathBuf],
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (event_tx, event_rx) = mpsc::channel();
        let dirs: Vec<PathBuf> = dirs.iter().filter(|d| d.exists()).cloned().collect();

        let mut watcher = RecommendedWatcher::new(
            move |res| {
                let _ = event_tx.send(res);
            },
            Config::default(),
        )?;

        for dir in &dirs {
            watcher.watch(dir, RecursiveMode::Recursive)?;
        }

        let thread = std::thread::spawn(move || {
            let mut last_emit = Instant::now();
            let debounce = Duration::from_millis(300);

            loop {
                // Check for stop signal.
                if stop_rx.try_recv().is_ok() {
                    break;
                }

                match event_rx.recv_timeout(Duration::from_millis(200)) {
                    Ok(Ok(event)) => {
                        // Only care about supported file types (md, docx, pdf, xlsx, etc.).
                        let relevant = event.paths.iter().any(|p| {
                            p.extension()
                                .and_then(|e| e.to_str())
                                .map(|e| {
                                    let lower = e.to_ascii_lowercase();
                                    ["md", "docx", "doc", "pdf", "xlsx"].contains(&lower.as_str())
                                })
                                .unwrap_or(false)
                        });
                        if !relevant {
                            continue;
                        }

                        match event.kind {
                            EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
                                let now = Instant::now();
                                if now.duration_since(last_emit) >= debounce {
                                    let _ = app_handle.emit("notes-changed", ());
                                    last_emit = now;
                                }
                            }
                            _ => {}
                        }
                    }
                    Ok(Err(_)) => { /* notify error, ignore */ }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        // Timeout - loop back to check stop signal.
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
            // `watcher` dropped here, stopping filesystem monitoring.
            drop(watcher);
        });

        Ok(NotesWatcher {
            stop_tx: Some(stop_tx),
            _thread: Some(thread),
        })
    }

    /// Stop the current watcher and start watching a new set of directories.
    pub fn reconfigure(
        &mut self,
        app_handle: AppHandle,
        dirs: &[PathBuf],
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Stop existing watcher.
        self.stop();

        // Start fresh.
        *self = Self::start(app_handle, dirs)?;
        Ok(())
    }

    fn stop(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
        if let Some(thread) = self._thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for NotesWatcher {
    fn drop(&mut self) {
        self.stop();
    }
}
