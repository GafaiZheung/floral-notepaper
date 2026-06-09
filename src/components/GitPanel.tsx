import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  checkGitInstalled,
  commit,
  getLog,
  getStatus,
  initRepo,
  isGitRepo,
  revertFile,
  stageFiles,
  stageAll,
  unstageFiles,
} from "../features/git/api";
import type { GitCommit, GitFileStatus, GitStatus } from "../features/git/types";

interface GitPanelProps {
  repoPath: string;
  /** Called when the panel needs to refresh notes (e.g. after commit) */
  onRefresh: () => void;
}

type GitState = "checking" | "not-installed" | "not-repo" | "ready" | "error";

export function GitPanel({ repoPath, onRefresh }: GitPanelProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<GitState>("checking");
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!repoPath) return;
    try {
      const installed = await checkGitInstalled();
      if (!installed) {
        setState("not-installed");
        return;
      }

      const isRepo = await isGitRepo(repoPath);
      if (!isRepo) {
        setState("not-repo");
        return;
      }

      setState("ready");
      const [gitStatus, gitLog] = await Promise.all([getStatus(repoPath), getLog(repoPath, 30)]);
      setStatus(gitStatus);
      setCommits(gitLog);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }, [repoPath]);

  // Initial load and periodic refresh
  useEffect(() => {
    refresh();
    // Poll every 5s while the panel is active
    intervalRef.current = setInterval(refresh, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh]);

  // Also refresh when notes change (via Tauri event)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    import("@tauri-apps/api/event")
      .then(({ listen: tauriListen }) => {
        if (cancelled) return;
        return tauriListen("notes-changed", () => {
          refresh();
        });
      })
      .then((fn) => {
        if (!cancelled && fn) unlisten = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refresh]);

  const handleInitRepo = async () => {
    setInitializing(true);
    try {
      await initRepo(repoPath);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInitializing(false);
    }
  };

  const handleStageFiles = async (files: string[]) => {
    setLoading(true);
    try {
      await stageFiles(repoPath, files);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleUnstageFiles = async (files: string[]) => {
    setLoading(true);
    try {
      await unstageFiles(repoPath, files);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleStageAll = async () => {
    setLoading(true);
    try {
      await stageAll(repoPath);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleUnstageAll = async () => {
    if (!status) return;
    const all = status.files.filter((f) => f.status === "staged").map((f) => f.path);
    if (all.length === 0) return;
    await handleUnstageFiles(all);
  };

  const handleRevert = async (file: string) => {
    setLoading(true);
    try {
      await revertFile(repoPath, file);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    setLoading(true);
    try {
      await commit(repoPath, commitMsg.trim());
      setCommitMsg("");
      await refresh();
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCommitKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleCommit();
    }
  };

  // Filter files by status
  const staged = status?.files.filter((f) => f.status === "staged") ?? [];
  const unstaged =
    status?.files.filter(
      (f) => f.status === "modified" || f.status === "deleted" || f.status === "renamed",
    ) ?? [];
  const untracked = status?.files.filter((f) => f.status === "untracked") ?? [];
  const totalChanges = staged.length + unstaged.length + untracked.length;

  const shortHash = (hash: string) => hash.slice(0, 7);

  // Not installed
  if (state === "not-installed") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-3">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-amber-500"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <p className="text-sm text-ink-faint mb-1">
          {t("git.notInstalled", { defaultValue: "未检测到 Git" })}
        </p>
        <p className="text-xs text-ink-ghost">
          {t("git.notInstalledHint", {
            defaultValue: "请先安装 Git 后再使用版本管理功能",
          })}
        </p>
        <a
          href="https://git-scm.com/downloads"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 text-xs text-bamboo hover:underline"
        >
          {t("git.downloadGit", { defaultValue: "下载 Git →" })}
        </a>
      </div>
    );
  }

  // Not a repo
  if (state === "not-repo") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-bamboo-mist/40 flex items-center justify-center mb-3">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-bamboo"
          >
            <circle cx="12" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <circle cx="18" cy="6" r="3" />
            <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" />
            <path d="M12 3v4" />
          </svg>
        </div>
        <p className="text-sm text-ink-faint mb-1">
          {t("git.notAGitRepo", { defaultValue: "当前目录尚未初始化 Git 仓库" })}
        </p>
        <p className="text-xs text-ink-ghost mb-3">
          {t("git.initDescription", {
            defaultValue: "初始化后可通过 Git 管理笔记的版本历史",
          })}
        </p>
        <button
          onClick={handleInitRepo}
          disabled={initializing}
          className="px-4 py-1.5 rounded-lg bg-bamboo text-white text-xs font-medium hover:bg-bamboo-dark transition-colors disabled:opacity-50 cursor-pointer"
        >
          {initializing
            ? t("git.initializing", { defaultValue: "初始化中…" })
            : t("git.initRepo", { defaultValue: "初始化 Git 仓库" })}
        </button>
      </div>
    );
  }

  // Checking
  if (state === "checking") {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <p className="text-xs text-ink-ghost">{t("git.checking", { defaultValue: "检查中…" })}</p>
      </div>
    );
  }

  // Error state (but repo exists)
  if (state === "error" && !status) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <p className="text-sm text-red-400 mb-1">
          {t("git.error", { defaultValue: "获取 Git 状态失败" })}
        </p>
        {error && <p className="text-xs text-ink-ghost">{error}</p>}
        <button
          onClick={refresh}
          className="mt-3 text-xs text-bamboo hover:underline cursor-pointer"
        >
          {t("common.retry", { defaultValue: "重试" })}
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header: branch + ahead/behind */}
      {status && (
        <div className="shrink-0 px-3 py-2 border-b border-paper-deep/20 flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-xs font-mono text-ink-faint">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            {status.branch}
          </span>
          {status.ahead > 0 && (
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">
              ↑{status.ahead}
            </span>
          )}
          {status.behind > 0 && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono">
              ↓{status.behind}
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={() => setShowLog(!showLog)}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
              showLog ? "text-bamboo bg-bamboo-mist/30" : "text-ink-ghost hover:text-ink-faint"
            }`}
          >
            {showLog
              ? t("git.showChanges", { defaultValue: "变更" })
              : t("git.showLog", { defaultValue: "历史" })}
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-[10px] px-1.5 py-0.5 rounded text-ink-ghost hover:text-ink-faint transition-colors cursor-pointer"
            title={t("common.refresh", { defaultValue: "刷新" })}
          >
            ↻
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="shrink-0 px-3 py-1.5 bg-red-100/60 dark:bg-red-900/20 text-[11px] text-red-600 dark:text-red-400 flex items-center gap-2">
          <span className="truncate flex-1">{error}</span>
          <button onClick={() => setError(null)} className="cursor-pointer hover:opacity-70">
            ✕
          </button>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto scrollbar-hidden">
        {showLog ? (
          /* Commit log view */
          <div className="p-2">
            {commits.length === 0 ? (
              <p className="text-xs text-ink-ghost text-center py-6">
                {t("git.noCommits", { defaultValue: "暂无提交记录" })}
              </p>
            ) : (
              <div className="space-y-0.5">
                {commits.map((c) => (
                  <div
                    key={c.hash}
                    className="px-2 py-1.5 rounded hover:bg-paper-warm/60 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-bamboo shrink-0">
                        {shortHash(c.hash)}
                      </span>
                      <span className="text-xs text-ink-soft truncate flex-1">{c.message}</span>
                    </div>
                    <div className="flex gap-2 mt-0.5 ml-0">
                      <span className="text-[10px] text-ink-ghost">{c.author}</span>
                      <span className="text-[10px] text-ink-ghost">{c.date}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : status && totalChanges === 0 ? (
          /* Clean state */
          <div className="flex flex-col items-center justify-center py-10 text-center px-4">
            <div className="w-10 h-10 rounded-full bg-emerald-100/60 dark:bg-emerald-900/20 flex items-center justify-center mb-2">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-emerald-500"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <p className="text-xs text-ink-faint">
              {t("git.noChanges", { defaultValue: "没有待提交的变更" })}
            </p>
            <p className="text-[10px] text-ink-ghost mt-0.5">
              {t("git.workingTreeClean", {
                defaultValue: "工作目录干净",
              })}
            </p>
          </div>
        ) : status ? (
          /* File list by status */
          <div className="p-2 space-y-3">
            {/* Staged */}
            {staged.length > 0 && (
              <FileGroup
                title={t("git.stagedChanges", {
                  count: staged.length,
                })}
                titleClass="text-emerald-600 dark:text-emerald-400"
                files={staged}
                primaryAction={{
                  label: t("git.unstage", { defaultValue: "取消暂存" }),
                  onClick: (f) => handleUnstageFiles([f.path]),
                }}
                groupAction={
                  staged.length > 1
                    ? {
                        label: t("git.unstageAll", { defaultValue: "全部取消暂存" }),
                        onClick: handleUnstageAll,
                      }
                    : undefined
                }
              />
            )}

            {/* Unstaged */}
            {unstaged.length > 0 && (
              <FileGroup
                title={t("git.unstagedChanges", {
                  count: unstaged.length,
                })}
                titleClass="text-amber-600 dark:text-amber-400"
                files={unstaged}
                primaryAction={{
                  label: t("git.stage", { defaultValue: "暂存" }),
                  onClick: (f) => handleStageFiles([f.path]),
                }}
                secondaryAction={{
                  label: t("git.revert", { defaultValue: "还原" }),
                  onClick: (f) => handleRevert(f.path),
                }}
              />
            )}

            {/* Untracked */}
            {untracked.length > 0 && (
              <FileGroup
                title={t("git.untrackedFiles", {
                  count: untracked.length,
                })}
                titleClass="text-ink-faint"
                files={untracked}
                primaryAction={{
                  label: t("git.stage", { defaultValue: "暂存" }),
                  onClick: (f) => handleStageFiles([f.path]),
                }}
                groupAction={
                  untracked.length > 1
                    ? {
                        label: t("git.stageAll", { defaultValue: "全部暂存" }),
                        onClick: () => handleStageFiles(untracked.map((f) => f.path)),
                      }
                    : undefined
                }
              />
            )}
          </div>
        ) : null}
      </div>

      {/* Commit area (always at bottom) */}
      {status && !showLog && (
        <div className="shrink-0 border-t border-paper-deep/20 p-2 space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleStageAll}
              disabled={unstaged.length === 0 && untracked.length === 0}
              className="text-[10px] px-1.5 py-0.5 rounded text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {t("git.stageAllShort", { defaultValue: "全部暂存" })}
            </button>
          </div>
          <textarea
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={handleCommitKeyDown}
            placeholder={
              t("git.commitMessagePlaceholder", {
                defaultValue: "输入提交信息…",
              }) as string
            }
            rows={2}
            className="w-full text-xs bg-paper-warm/60 border border-paper-deep/30 rounded-lg px-2 py-1.5 resize-none outline-none focus:border-bamboo/50 placeholder:text-ink-ghost"
          />
          <button
            onClick={handleCommit}
            disabled={commitMsg.trim() === "" || loading || staged.length === 0}
            className="w-full py-1.5 rounded-lg bg-bamboo text-white text-xs font-medium hover:bg-bamboo-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading
              ? t("git.committing", { defaultValue: "提交中…" })
              : t("git.commit", { defaultValue: "提交" })}
            <span className="ml-1 text-[10px] opacity-70">Ctrl+Enter</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* File group sub-component */
/* ------------------------------------------------------------------ */

interface FileGroupProps {
  title: string;
  titleClass?: string;
  files: GitFileStatus[];
  primaryAction: {
    label: string;
    onClick: (file: GitFileStatus) => void;
  };
  secondaryAction?: {
    label: string;
    onClick: (file: GitFileStatus) => void;
  };
  groupAction?: {
    label: string;
    onClick: () => void;
  };
}

function FileGroup({
  title,
  titleClass,
  files,
  primaryAction,
  secondaryAction,
  groupAction,
}: FileGroupProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-ink-ghost hover:text-ink-faint cursor-pointer"
        >
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
              transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
              transition: "transform 0.15s",
            }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <span className={`text-[11px] font-medium ${titleClass ?? "text-ink-faint"}`}>{title}</span>
        {!collapsed && groupAction && (
          <button
            onClick={groupAction.onClick}
            className="ml-auto text-[10px] text-ink-ghost hover:text-bamboo transition-colors cursor-pointer"
          >
            {groupAction.label}
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="space-y-0.5">
          {files.map((f) => (
            <div
              key={f.path}
              className="group flex items-center gap-1.5 pl-3 pr-1 py-0.5 rounded hover:bg-paper-warm/50 transition-colors"
            >
              <FileStatusIcon status={f.status} />
              <span className="text-[11px] text-ink-soft truncate flex-1" title={f.path}>
                {f.path}
                {f.status === "renamed" && f.oldPath && (
                  <span className="text-ink-ghost ml-1">← {f.oldPath}</span>
                )}
              </span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => primaryAction.onClick(f)}
                  className="text-[10px] px-1 py-0.5 rounded text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/30 transition-colors cursor-pointer"
                >
                  {primaryAction.label}
                </button>
                {secondaryAction && (
                  <button
                    onClick={() => secondaryAction.onClick(f)}
                    className="text-[10px] px-1 py-0.5 rounded text-ink-ghost hover:text-red-400 hover:bg-red-100/40 dark:hover:bg-red-900/20 transition-colors cursor-pointer"
                  >
                    {secondaryAction.label}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* File status icon */
/* ------------------------------------------------------------------ */

function FileStatusIcon({ status }: { status: GitFileStatus["status"] }) {
  switch (status) {
    case "staged":
      return <span className="w-3 h-3 rounded-full bg-emerald-400/60 shrink-0" title="Staged" />;
    case "modified":
      return <span className="w-3 h-3 rounded-full bg-amber-400/60 shrink-0" title="Modified" />;
    case "untracked":
      return (
        <span
          className="w-3 h-3 rounded-full border border-ink-ghost/40 shrink-0"
          title="Untracked"
        />
      );
    case "deleted":
      return <span className="w-3 h-3 rounded-full bg-red-400/60 shrink-0" title="Deleted" />;
    case "renamed":
      return <span className="w-3 h-3 rounded-full bg-blue-400/60 shrink-0" title="Renamed" />;
    default:
      return <span className="w-3 h-3 shrink-0" />;
  }
}
