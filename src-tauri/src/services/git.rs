use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};

use super::notes::AppError;

// ---------------------------------------------------------------------------
// Output types — shared with the frontend via Tauri commands
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    pub status: String, // "staged" | "modified" | "untracked" | "deleted" | "renamed"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub files: Vec<GitFileStatus>,
    pub ahead: u32,
    pub behind: u32,
}

// ---------------------------------------------------------------------------
// Helper: run a git command and capture stdout + stderr
// ---------------------------------------------------------------------------

fn run_git(repo_path: &Path, args: &[&str]) -> Result<String, AppError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError {
            code: "gitNotInstalled".into(),
            message: format!("Git is not installed or not in PATH: {e}"),
            details: Default::default(),
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError {
            code: "git".into(),
            message: stderr,
            details: Default::default(),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

// ---------------------------------------------------------------------------
// Public functions — each maps to a Tauri command
// ---------------------------------------------------------------------------

/// Check whether git CLI is available on the system.
pub fn check_git_installed() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Check whether `path` is inside a git repository.
pub fn is_git_repo(path: &Path) -> bool {
    Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Initialize a new git repository at `path`.
pub fn git_init(path: &Path) -> Result<String, AppError> {
    // Ensure the directory exists
    if !path.exists() {
        std::fs::create_dir_all(path).map_err(|e| AppError {
            code: "io".into(),
            message: e.to_string(),
            details: Default::default(),
        })?;
    }

    let output = run_git(path, &["init"])?;

    // Create a default .gitignore
    let gitignore_path = path.join(".gitignore");
    if !gitignore_path.exists() {
        let defaults = "*.bak\n*.tmp\n.DS_Store\nThumbs.db\n";
        let _ = std::fs::write(&gitignore_path, defaults);
    }

    Ok(output)
}

/// Parse `git status --porcelain` into structured file statuses.
pub fn git_status(path: &Path) -> Result<GitStatus, AppError> {
    if !is_git_repo(path) {
        return Err(AppError {
            code: "gitNotRepo".into(),
            message: "Not a git repository".into(),
            details: Default::default(),
        });
    }

    let branch = get_current_branch(path).unwrap_or_else(|_| "unknown".into());

    // Get ahead/behind counts
    let (ahead, behind) = get_ahead_behind(path);

    let output = run_git(path, &["status", "--porcelain"])?;
    let mut files: Vec<GitFileStatus> = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Porcelain format: XY filename, where X = index status, Y = worktree status
        // Renamed files: "R  old -> new"
        let (status_code, file_info) = if line.len() >= 3 {
            (&line[..2], line[3..].trim())
        } else {
            continue;
        };

        let x = status_code.chars().next().unwrap_or(' ');
        let y = status_code.chars().nth(1).unwrap_or(' ');

        let (status, path_str, old_path) = match (x, y) {
            ('R', _) | (_, 'R') => {
                // Renamed: extract old and new paths
                if let Some((old, new)) = file_info.split_once(" -> ") {
                    (
                        "renamed",
                        new.trim().to_string(),
                        Some(old.trim().to_string()),
                    )
                } else {
                    ("renamed", file_info.to_string(), None)
                }
            }
            // Staged changes
            ('M', ' ') | ('A', ' ') | ('D', ' ') => {
                let s = match x {
                    'M' => "staged",
                    'A' => "staged",
                    'D' => "deleted",
                    _ => "staged",
                };
                (s, file_info.to_string(), None)
            }
            // Unstaged changes
            (' ', 'M') | (' ', 'D') => {
                let s = match y {
                    'M' => "modified",
                    'D' => "deleted",
                    _ => "modified",
                };
                (s, file_info.to_string(), None)
            }
            // Both staged and unstaged modifications
            ('M', 'M') => {
                // We show as modified since it has unstaged changes too
                ("modified", file_info.to_string(), None)
            }
            // Untracked
            ('?', '?') => ("untracked", file_info.to_string(), None),
            _ => continue,
        };

        files.push(GitFileStatus {
            path: path_str,
            status: status.to_string(),
            old_path,
        });
    }

    Ok(GitStatus {
        branch,
        files,
        ahead,
        behind,
    })
}

/// Stage files (git add).
pub fn git_stage_files(path: &Path, files: &[String]) -> Result<String, AppError> {
    let mut args: Vec<&str> = vec!["add", "--"];
    let file_strs: Vec<&str> = files.iter().map(String::as_str).collect();
    args.extend(&file_strs);
    run_git(path, &args)
}

/// Unstage files (git reset --).
pub fn git_unstage_files(path: &Path, files: &[String]) -> Result<String, AppError> {
    let mut args: Vec<&str> = vec!["reset", "HEAD", "--"];
    let file_strs: Vec<&str> = files.iter().map(String::as_str).collect();
    args.extend(&file_strs);
    run_git(path, &args)
}

/// Commit staged changes.
pub fn git_commit(path: &Path, message: &str) -> Result<String, AppError> {
    if message.trim().is_empty() {
        return Err(AppError {
            code: "gitEmptyMessage".into(),
            message: "Commit message cannot be empty".into(),
            details: Default::default(),
        });
    }
    run_git(path, &["commit", "-m", message.trim()])
}

/// Get commit log.
pub fn git_log(path: &Path, count: Option<u32>) -> Result<Vec<GitCommit>, AppError> {
    let n = count.unwrap_or(50).min(500);
    let n_str = n.to_string();
    let output = run_git(
        path,
        &[
            "log",
            &format!("-{n_str}"),
            "--format=%H%x00%s%x00%an%x00%ad",
            "--date=format:%Y-%m-%d %H:%M",
        ],
    )?;

    let mut commits = Vec::new();
    for line in output.lines() {
        let fields: Vec<&str> = line.split('\0').collect();
        if fields.len() >= 4 {
            commits.push(GitCommit {
                hash: fields[0].to_string(),
                message: fields[1].to_string(),
                author: fields[2].to_string(),
                date: fields[3].to_string(),
            });
        }
    }
    Ok(commits)
}

/// Discard unstaged changes to a file (git checkout -- <file>).
pub fn git_revert_file(path: &Path, file: &str) -> Result<String, AppError> {
    run_git(path, &["checkout", "--", file])
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn get_current_branch(path: &Path) -> Result<String, AppError> {
    let output = run_git(path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    Ok(output.trim().to_string())
}

fn get_ahead_behind(path: &Path) -> (u32, u32) {
    // Try to get tracking branch info
    let output = run_git(
        path,
        &["rev-list", "--left-right", "--count", "@{u}...HEAD"],
    );

    match output {
        Ok(o) => {
            let parts: Vec<&str> = o.split_whitespace().collect();
            if parts.len() >= 2 {
                let behind: u32 = parts[0].parse().unwrap_or(0);
                let ahead: u32 = parts[1].parse().unwrap_or(0);
                (ahead, behind)
            } else {
                (0, 0)
            }
        }
        Err(_) => (0, 0), // No upstream configured
    }
}
