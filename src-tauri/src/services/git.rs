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
        let stderr = String::from_utf8_lossy(&output.stderr)
            .trim_end()
            .to_string();
        return Err(AppError {
            code: "git".into(),
            message: stderr,
            details: Default::default(),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string())
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

    let output = run_git(
        path,
        &["-c", "core.quotePath=false", "status", "--porcelain"],
    )?;
    let mut files: Vec<GitFileStatus> = Vec::new();

    for line in output.lines() {
        // MUST NOT trim leading space — it carries the index-status column.
        // " M file.md" = unstaged; "M  file.md" = staged.
        let line = line.trim_end();
        if line.is_empty() {
            continue;
        }

        // Porcelain format: XY filename, where X = index status, Y = worktree status
        // Renamed files: "R  old -> new"
        let (status_code, file_info) = if line.len() >= 2 {
            (&line[..2], line[2..].trim_start())
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
                        new.trim_end().to_string(),
                        Some(old.trim_end().to_string()),
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
    if files.is_empty() {
        return Err(AppError {
            code: "gitEmptyPaths".into(),
            message: "No files to stage".into(),
            details: Default::default(),
        });
    }
    let mut args: Vec<&str> = vec!["add", "--"];
    let file_strs: Vec<&str> = files.iter().map(String::as_str).collect();
    args.extend(&file_strs);
    run_git(path, &args)
}

/// Stage all changes (git add -A). Safer than passing individual paths.
pub fn git_stage_all(path: &Path) -> Result<String, AppError> {
    run_git(path, &["add", "-A"])
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

/// Get commit log. Returns empty vec when there are no commits yet.
pub fn git_log(path: &Path, count: Option<u32>) -> Result<Vec<GitCommit>, AppError> {
    let n = count.unwrap_or(50).min(500);
    let n_str = n.to_string();

    // In a fresh repo with no commits, `git log` exits non-zero.
    // Treat that as an empty history instead of an error.
    let output = Command::new("git")
        .args([
            "log",
            &format!("-{n_str}"),
            "--format=%H%x00%s%x00%an%x00%ad",
            "--date=format:%Y-%m-%d %H:%M",
        ])
        .current_dir(path)
        .output()
        .map_err(|e| AppError {
            code: "gitNotInstalled".into(),
            message: format!("Git is not installed or not in PATH: {e}"),
            details: Default::default(),
        })?;

    if !output.status.success() {
        // "fatal: your current branch ... does not have any commits yet" → empty
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("does not have any commits") || stderr.contains("No commits yet") {
            return Ok(Vec::new());
        }
        return Err(AppError {
            code: "git".into(),
            message: stderr.trim_end().to_string(),
            details: Default::default(),
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string();
    let mut commits = Vec::new();
    for line in stdout.lines() {
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
    // `git rev-parse --abbrev-ref HEAD` fails in an empty repo (no commits yet).
    // Fall back to checking .git/HEAD for the default branch name.
    let output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(path)
        .output()
        .map_err(|e| AppError {
            code: "gitNotInstalled".into(),
            message: format!("Git is not installed or not in PATH: {e}"),
            details: Default::default(),
        })?;

    if output.status.success() {
        let name = String::from_utf8_lossy(&output.stdout)
            .trim_end()
            .to_string();
        if !name.is_empty() && name != "HEAD" {
            return Ok(name);
        }
    }

    // Fallback: read HEAD file to get the unborn branch name
    let head_file = path.join(".git").join("HEAD");
    if let Ok(contents) = std::fs::read_to_string(&head_file) {
        let trimmed = contents.trim();
        if let Some(branch) = trimmed.strip_prefix("ref: refs/heads/") {
            return Ok(branch.to_string());
        }
    }

    Ok("main".into())
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    struct Repo {
        dir: tempfile::TempDir,
    }

    impl Repo {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            git_init(dir.path()).unwrap();
            // Initial commit so we can test modifications on tracked files
            let keep = dir.path().join(".gitkeep");
            fs::write(&keep, "").unwrap();
            run_git(dir.path(), &["add", "-A"]).unwrap();
            run_git(dir.path(), &["commit", "-m", "initial"]).unwrap();
            Self { dir }
        }

        fn path(&self) -> &Path {
            self.dir.path()
        }

        fn write(&self, name: &str, content: &str) {
            let p = self.dir.path().join(name);
            if let Some(parent) = p.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(&p, content).unwrap();
        }

        fn append(&self, name: &str, content: &str) {
            let p = self.dir.path().join(name);
            let mut f = fs::OpenOptions::new().append(true).open(&p).unwrap();
            f.write_all(content.as_bytes()).unwrap();
        }
    }

    #[test]
    fn porcelain_untracked_file() {
        let r = Repo::new();
        r.write("new.md", "hello");
        let s = git_status(r.path()).unwrap();
        let f = s.files.iter().find(|f| f.path == "new.md").unwrap();
        assert_eq!(f.status, "untracked");
    }

    #[test]
    fn porcelain_unstaged_modification() {
        let r = Repo::new();
        r.write("readme.md", "v1");
        run_git(r.path(), &["add", "readme.md"]).unwrap();
        run_git(r.path(), &["commit", "-m", "add readme"]).unwrap();
        r.write("readme.md", "v2");
        let s = git_status(r.path()).unwrap();
        let f = s.files.iter().find(|f| f.path == "readme.md").unwrap();
        assert_eq!(f.status, "modified");
    }

    #[test]
    fn porcelain_staged_file() {
        let r = Repo::new();
        r.write("readme.md", "v1");
        run_git(r.path(), &["add", "readme.md"]).unwrap();
        run_git(r.path(), &["commit", "-m", "add readme"]).unwrap();
        r.write("readme.md", "v2");
        run_git(r.path(), &["add", "readme.md"]).unwrap();
        let s = git_status(r.path()).unwrap();
        let f = s.files.iter().find(|f| f.path == "readme.md").unwrap();
        assert_eq!(f.status, "staged");
    }

    #[test]
    fn porcelain_unstaged_deletion() {
        let r = Repo::new();
        r.write("gone.md", "bye");
        run_git(r.path(), &["add", "gone.md"]).unwrap();
        run_git(r.path(), &["commit", "-m", "add gone"]).unwrap();
        fs::remove_file(r.path().join("gone.md")).unwrap();
        let s = git_status(r.path()).unwrap();
        let f = s.files.iter().find(|f| f.path == "gone.md").unwrap();
        assert_eq!(f.status, "deleted");
    }

    #[test]
    fn porcelain_chinese_filename_untracked() {
        let r = Repo::new();
        r.write("前端桌面端菜单与架构概览.md", "# 架构");
        let s = git_status(r.path()).unwrap();
        assert!(s.files.iter().any(|f| f.path.contains("前端")));
        let f = s.files.iter().find(|f| f.path.contains("前端")).unwrap();
        assert_eq!(f.status, "untracked");
    }

    #[test]
    fn porcelain_chinese_filename_staged() {
        let r = Repo::new();
        r.write("中文笔记.md", "# 测试");
        run_git(r.path(), &["add", "中文笔记.md"]).unwrap();
        let s = git_status(r.path()).unwrap();
        let f = s
            .files
            .iter()
            .find(|f| f.path.contains("中文笔记"))
            .unwrap();
        assert_eq!(f.status, "staged");
    }

    #[test]
    fn porcelain_chinese_filename_unstaged_modify() {
        let r = Repo::new();
        r.write("中文笔记.md", "v1");
        run_git(r.path(), &["add", "中文笔记.md"]).unwrap();
        run_git(r.path(), &["commit", "-m", "add"]).unwrap();
        r.append("中文笔记.md", "\nv2");
        let s = git_status(r.path()).unwrap();
        let f = s
            .files
            .iter()
            .find(|f| f.path.contains("中文笔记"))
            .unwrap();
        assert_eq!(f.status, "modified");
    }

    #[test]
    fn porcelain_mixed_statuses() {
        let r = Repo::new();
        // staged: committed then modified then staged again
        r.write("staged.md", "s");
        git_stage_all(r.path()).unwrap();
        git_commit(r.path(), "c1").unwrap();
        r.write("staged.md", "s2");
        git_stage_files(r.path(), &["staged.md".into()]).unwrap();
        // unstaged: committed then modified without staging
        r.write("unstaged.md", "u");
        git_stage_files(r.path(), &["unstaged.md".into()]).unwrap();
        git_commit(r.path(), "c2").unwrap();
        // Now c2 committed staged.md (s2) + unstaged.md (u).
        // Modify both: stage only staged.md, leave unstaged.md unstaged.
        r.write("staged.md", "s3");
        r.write("unstaged.md", "u2");
        git_stage_files(r.path(), &["staged.md".into()]).unwrap();
        // untracked
        r.write("untracked.md", "ut");
        let s = git_status(r.path()).unwrap();
        assert_eq!(
            s.files
                .iter()
                .find(|f| f.path == "staged.md")
                .unwrap()
                .status,
            "staged"
        );
        assert_eq!(
            s.files
                .iter()
                .find(|f| f.path == "unstaged.md")
                .unwrap()
                .status,
            "modified"
        );
        assert_eq!(
            s.files
                .iter()
                .find(|f| f.path == "untracked.md")
                .unwrap()
                .status,
            "untracked"
        );
    }

    #[test]
    fn stage_single_file() {
        let r = Repo::new();
        r.write("a.md", "one");
        r.write("b.md", "two");
        git_stage_files(r.path(), &["a.md".into()]).unwrap();
        let s = git_status(r.path()).unwrap();
        assert!(s
            .files
            .iter()
            .any(|f| f.path == "a.md" && f.status == "staged"));
        assert!(s
            .files
            .iter()
            .any(|f| f.path == "b.md" && f.status == "untracked"));
    }

    #[test]
    fn stage_all_works() {
        let r = Repo::new();
        r.write("a.md", "one");
        r.write("b.md", "two");
        git_stage_all(r.path()).unwrap();
        let s = git_status(r.path()).unwrap();
        assert_eq!(s.files.iter().filter(|f| f.status == "staged").count(), 2);
    }

    #[test]
    fn unstage_file_works() {
        let r = Repo::new();
        r.write("a.md", "one");
        run_git(r.path(), &["add", "a.md"]).unwrap();
        git_unstage_files(r.path(), &["a.md".into()]).unwrap();
        let s = git_status(r.path()).unwrap();
        let f = s.files.iter().find(|f| f.path == "a.md").unwrap();
        assert_eq!(f.status, "untracked");
    }

    #[test]
    fn commit_creates_history() {
        let r = Repo::new();
        r.write("a.md", "one");
        git_stage_all(r.path()).unwrap();
        git_commit(r.path(), "first commit").unwrap();
        let log = git_log(r.path(), None).unwrap();
        assert!(log.iter().any(|c| c.message.contains("first commit")));
    }

    #[test]
    fn commit_fails_empty_message() {
        let r = Repo::new();
        let err = git_commit(r.path(), "   ").unwrap_err();
        assert!(err.message.contains("empty"));
    }

    #[test]
    fn log_empty_repo_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        git_init(dir.path()).unwrap();
        let log = git_log(dir.path(), None).unwrap();
        assert!(log.is_empty());
    }

    #[test]
    fn revert_file_restores_content() {
        let r = Repo::new();
        r.write("readme.md", "v1");
        run_git(r.path(), &["add", "readme.md"]).unwrap();
        run_git(r.path(), &["commit", "-m", "add"]).unwrap();
        r.write("readme.md", "v2");
        git_revert_file(r.path(), "readme.md").unwrap();
        let content = fs::read_to_string(r.path().join("readme.md")).unwrap();
        assert_eq!(content, "v1");
    }

    #[test]
    fn is_git_repo_positive() {
        let r = Repo::new();
        assert!(is_git_repo(r.path()));
    }

    #[test]
    fn is_git_repo_negative() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_git_repo(dir.path()));
    }

    #[test]
    fn git_init_creates_dot_git_and_gitignore() {
        let dir = tempfile::tempdir().unwrap();
        git_init(dir.path()).unwrap();
        assert!(dir.path().join(".git").is_dir());
        assert!(dir.path().join(".gitignore").is_file());
    }

    #[test]
    fn git_init_preserves_existing_gitignore() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(".gitignore"), "custom\n").unwrap();
        git_init(dir.path()).unwrap();
        let content = fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        assert_eq!(content, "custom\n");
    }

    #[test]
    fn porcelain_clean_tree_empty() {
        let r = Repo::new();
        let s = git_status(r.path()).unwrap();
        assert!(s.files.is_empty());
    }

    #[test]
    fn branch_name_empty_repo_not_head() {
        let dir = tempfile::tempdir().unwrap();
        git_init(dir.path()).unwrap();
        let s = git_status(dir.path()).unwrap();
        assert!(!s.branch.is_empty());
        assert_ne!(s.branch, "HEAD");
    }

    #[test]
    fn check_git_installed_no_panic() {
        let _ = check_git_installed();
    }

    #[test]
    fn stage_files_empty_list_error() {
        let r = Repo::new();
        let err = git_stage_files(r.path(), &[]).unwrap_err();
        assert!(err.message.contains("No files"));
    }

    #[test]
    fn porcelain_staged_then_modified() {
        let r = Repo::new();
        r.write("dup.md", "v1");
        run_git(r.path(), &["add", "dup.md"]).unwrap();
        run_git(r.path(), &["commit", "-m", "add"]).unwrap();
        r.write("dup.md", "v2");
        run_git(r.path(), &["add", "dup.md"]).unwrap();
        r.write("dup.md", "v3");
        let s = git_status(r.path()).unwrap();
        let matches: Vec<_> = s.files.iter().filter(|f| f.path == "dup.md").collect();
        assert_eq!(matches.len(), 1, "MM yields one entry");
        assert_eq!(matches[0].status, "modified");
    }

    #[test]
    fn porcelain_depth_first_line_is_unstaged() {
        // Catches the .trim() bug: leading space on first porcelain line
        let r = Repo::new();
        r.write("aaa.md", "v1");
        run_git(r.path(), &["add", "aaa.md"]).unwrap();
        run_git(r.path(), &["commit", "-m", "add aaa"]).unwrap();
        r.write("aaa.md", "v2");
        let s = git_status(r.path()).unwrap();
        let f = s.files.iter().find(|f| f.path == "aaa.md").unwrap();
        assert_eq!(f.status, "modified");
    }
}
