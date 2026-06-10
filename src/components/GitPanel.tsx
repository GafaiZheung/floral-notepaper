import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  abortMerge,
  branchCreate,
  branchDelete,
  branchList,
  branchMerge,
  branchSwitch,
  checkGitInstalled,
  commit,
  commitAmend,
  conflictedFiles,
  createRemoteRepo,
  diffStaged,
  diffUnstaged,
  fetch,
  gitGraph,
  getLog,
  getStatus,
  hasConflicts,
  initRepo,
  isGitRepo,
  pull,
  push,
  remoteAdd,
  remoteList,
  remoteRemove,
  revertFile,
  stageAll,
  stageFiles,
  stashDrop,
  stashList,
  stashPop,
  stashPush,
  unstageFiles,
} from "../features/git/api";
import type {
  GitBranch,
  GitCommit,
  GitCreateRepoRequest,
  GitFileStatus,
  GitGraphNode,
  GitHostingAccount,
  GitRemote,
  GitStashEntry,
  GitStatus,
} from "../features/git/types";

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
  const [activeTab, setActiveTab] = useState<"changes" | "history" | "stash">("changes");
  // Branch
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [showBranchPopup, setShowBranchPopup] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  // Diff
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [diffTitle, setDiffTitle] = useState("");
  // Remote
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [showRemotePopup, setShowRemotePopup] = useState(false);
  const [newRemoteName, setNewRemoteName] = useState("");
  const [newRemoteUrl, setNewRemoteUrl] = useState("");
  // Stash
  const [stashEntries, setStashEntries] = useState<GitStashEntry[]>([]);
  const [showStashPush, setShowStashPush] = useState(false);
  const [stashMessage, setStashMessage] = useState("");
  // Conflicts
  const [conflicts, setConflicts] = useState<string[]>([]);
  // Gitignore
  const [gitignoreContent, setGitignoreContent] = useState("");
  const [showGitignoreEditor, setShowGitignoreEditor] = useState(false);
  // Graph
  const [graphNodes, setGraphNodes] = useState<GitGraphNode[]>([]);
  // Merge picker
  const [showMergePicker, setShowMergePicker] = useState(false);
  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    branch?: string;
    hash?: string;
    refs?: string[];
  } | null>(null);
  // GitHub / GitLab
  const [hostingAccounts, setHostingAccounts] = useState<GitHostingAccount[]>([]);
  const [showHostingSetup, setShowHostingSetup] = useState(false);
  const [showCreateRepo, setShowCreateRepo] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoProvider, setNewRepoProvider] = useState<"github" | "gitlab">("github");
  const [newRepoPrivate, setNewRepoPrivate] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!repoPath || refreshingRef.current) return;
    refreshingRef.current = true;
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
      const [gitStatus, gitLog, gitBranches, gitRemotes, gitGraphData, gitStashes, hasConf] =
        await Promise.all([
          getStatus(repoPath),
          getLog(repoPath, 30),
          branchList(repoPath).catch(() => [] as GitBranch[]),
          remoteList(repoPath).catch(() => [] as GitRemote[]),
          gitGraph(repoPath, 80).catch(() => [] as GitGraphNode[]),
          stashList(repoPath).catch(() => [] as GitStashEntry[]),
          hasConflicts(repoPath).catch(() => false),
        ]);
      setStatus(gitStatus);
      setCommits(gitLog);
      setBranches(gitBranches);
      setRemotes(gitRemotes);
      setGraphNodes(gitGraphData);
      setStashEntries(gitStashes);
      if (hasConf) {
        const cf = await conflictedFiles(repoPath).catch(() => [] as string[]);
        setConflicts(cf);
      } else {
        setConflicts([]);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    } finally {
      refreshingRef.current = false;
    }
  }, [repoPath]);

  // Initial load and periodic refresh.
  // Uses a ref-based interval to avoid resetting the timer when `refresh`
  // callback identity changes (which would otherwise cause missed intervals
  // or duplicate timers on React re-renders).
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    refreshRef.current();
    intervalRef.current = setInterval(() => refreshRef.current(), 5000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []); // stable — only mounts once

  // Also refresh when notes change (via Tauri event)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    import("@tauri-apps/api/event")
      .then(({ listen: tauriListen }) => {
        if (cancelled) return;
        return tauriListen("notes-changed", () => {
          refreshRef.current();
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
  }, []); // stable — only mounts once

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

  // --- Branch handlers ---

  const handleBranchSwitch = async (name: string) => {
    setLoading(true);
    setShowBranchPopup(false);
    try {
      await branchSwitch(repoPath, name);
      await refreshRef.current();
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleBranchCreate = async () => {
    if (!newBranchName.trim()) return;
    setLoading(true);
    try {
      await branchCreate(repoPath, newBranchName.trim());
      setNewBranchName("");
      await refreshRef.current();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleBranchDelete = async (name: string) => {
    setLoading(true);
    try {
      await branchDelete(repoPath, name, false);
      await refreshRef.current();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleBranchMerge = async (name: string) => {
    setLoading(true);
    try {
      await branchMerge(repoPath, name);
      await refreshRef.current();
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // --- Remote handlers ---

  const handlePush = async () => {
    setLoading(true);
    try {
      await push(repoPath);
      await refreshRef.current();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePull = async () => {
    setLoading(true);
    try {
      await pull(repoPath);
      await refreshRef.current();
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleFetch = async () => {
    setLoading(true);
    try {
      await fetch(repoPath);
      await refreshRef.current();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleRemoteAdd = async () => {
    if (!newRemoteName.trim() || !newRemoteUrl.trim()) return;
    setLoading(true);
    try {
      await remoteAdd(repoPath, newRemoteName.trim(), newRemoteUrl.trim());
      setNewRemoteName("");
      setNewRemoteUrl("");
      await refreshRef.current();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleRemoteRemove = async (name: string) => {
    setLoading(true);
    try {
      await remoteRemove(repoPath, name);
      await refreshRef.current();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // --- Diff handlers ---

  const handleViewDiff = async (file: string, staged: boolean) => {
    setLoading(true);
    try {
      const diff = staged ? await diffStaged(repoPath, file) : await diffUnstaged(repoPath, file);
      setDiffContent(diff || t("git.noDiff", { defaultValue: "无差异" }));
      setDiffTitle(file);
    } catch (e) {
      setDiffContent(`Error: ${e instanceof Error ? e.message : String(e)}`);
      setDiffTitle(file);
    } finally {
      setLoading(false);
    }
  };

  // --- Stash handlers ---

  const handleStashPush = async () => {
    setLoading(true);
    setShowStashPush(false);
    try {
      await stashPush(repoPath, stashMessage || undefined);
      setStashMessage("");
      await refreshRef.current();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleStashPop = async (index?: number) => {
    setLoading(true);
    try {
      await stashPop(repoPath, index);
      await refreshRef.current();
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleStashDrop = async (index?: number) => {
    setLoading(true);
    try {
      await stashDrop(repoPath, index);
      await refreshRef.current();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // --- Advanced handlers ---

  const handleAmend = async () => {
    setLoading(true);
    try {
      await commitAmend(repoPath);
      await refreshRef.current();
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAbortMerge = async () => {
    setLoading(true);
    try {
      await abortMerge(repoPath);
      await refreshRef.current();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // --- Merge handler ---

  const handleMerge = async (targetBranch: string) => {
    setLoading(true);
    setShowMergePicker(false);
    try {
      await branchMerge(repoPath, targetBranch);
      await refreshRef.current();
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // --- Context menu handlers ---

  const handleCtxCreateBranch = (hash: string) => {
    const name = prompt(
      t("git.ctxNewBranchPrompt", { defaultValue: "从当前提交创建新分支：" }) as string,
    );
    if (name) {
      branchCreate(repoPath, name)
        .then(() => {
          branchSwitch(repoPath, name).then(() => refreshRef.current());
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }
    setCtxMenu(null);
  };

  const handleCtxSwitchBranch = (name: string) => {
    handleBranchSwitch(name);
    setCtxMenu(null);
  };

  const handleCtxDeleteBranch = (name: string) => {
    handleBranchDelete(name);
    setCtxMenu(null);
  };

  const handleCtxMergeBranch = (name: string) => {
    handleMerge(name);
    setCtxMenu(null);
  };

  // --- Remote repo creation handler ---

  const handleCreateRemoteRepo = async () => {
    if (!newRepoName.trim()) return;
    const account = hostingAccounts.find((a) => a.provider === newRepoProvider);
    if (!account) {
      setError(
        t("git.noAccountForProvider", {
          provider: newRepoProvider,
          defaultValue: `未配置 ${newRepoProvider} 账号`,
        }) as string,
      );
      return;
    }
    setLoading(true);
    setShowCreateRepo(false);
    try {
      const req: GitCreateRepoRequest = {
        provider: newRepoProvider,
        token: account.token,
        repoName: newRepoName.trim(),
        private: newRepoPrivate,
        baseUrl: account.baseUrl,
      };
      const cloneUrl = await createRemoteRepo(req);
      await remoteAdd(repoPath, "origin", cloneUrl);
      setNewRepoName("");
      await refreshRef.current();
      setError(`${t("git.repoCreated", { defaultValue: "仓库已创建" })}: ${cloneUrl}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
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
      {/* Header: branch selector + remote actions + tabs */}
      {status && (
        <div className="shrink-0 border-b border-paper-deep/20">
          {/* Row 1: branch + push/pull */}
          <div className="px-3 py-1.5 flex items-center gap-1.5">
            {/* Branch selector button */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowBranchPopup(!showBranchPopup);
                  setShowRemotePopup(false);
                }}
                className="inline-flex items-center gap-1 text-xs font-mono text-ink-faint bg-paper-warm/60 hover:bg-paper-warm px-1.5 py-0.5 rounded cursor-pointer transition-colors"
              >
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
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {showBranchPopup && (
                <BranchPopup
                  branches={branches}
                  currentBranch={status.branch}
                  newBranchName={newBranchName}
                  onNewBranchNameChange={setNewBranchName}
                  onCreateBranch={handleBranchCreate}
                  onSwitchBranch={handleBranchSwitch}
                  onDeleteBranch={handleBranchDelete}
                  onMergeBranch={handleBranchMerge}
                  onClose={() => setShowBranchPopup(false)}
                  t={t}
                />
              )}
            </div>
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
              onClick={handleFetch}
              disabled={loading || remotes.length === 0}
              className="text-[10px] px-1 py-0.5 rounded text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title={t("git.fetch", { defaultValue: "获取" }) as string}
            >
              ↓
            </button>
            <button
              onClick={handlePull}
              disabled={loading || remotes.length === 0}
              className="text-[10px] px-1 py-0.5 rounded text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title={t("git.pull", { defaultValue: "拉取" }) as string}
            >
              ⇣
            </button>
            {/* Merge button — opens merge picker */}
            <div className="relative">
              <button
                onClick={() => setShowMergePicker(!showMergePicker)}
                disabled={loading || branches.length <= 1}
                className="text-[10px] px-1 py-0.5 rounded text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/20 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                title={t("git.mergeBtn", { defaultValue: "合并分支" }) as string}
              >
                ◉
              </button>
              {showMergePicker && (
                <MergePicker
                  branches={branches}
                  currentBranch={status.branch}
                  onMerge={handleMerge}
                  onClose={() => setShowMergePicker(false)}
                  t={t}
                />
              )}
            </div>
            <button
              onClick={handlePush}
              disabled={loading || remotes.length === 0}
              className="text-[10px] px-1 py-0.5 rounded text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title={t("git.push", { defaultValue: "推送" }) as string}
            >
              ⇡
            </button>
            <div className="relative">
              <button
                onClick={() => {
                  setShowRemotePopup(!showRemotePopup);
                  setShowBranchPopup(false);
                }}
                className="text-[10px] px-1 py-0.5 rounded text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-colors cursor-pointer"
                title={t("git.remotes", { defaultValue: "远程仓库" }) as string}
              >
                ⚙
              </button>
              {showRemotePopup && (
                <RemotePopup
                  remotes={remotes}
                  newName={newRemoteName}
                  newUrl={newRemoteUrl}
                  onNameChange={setNewRemoteName}
                  onUrlChange={setNewRemoteUrl}
                  onAdd={handleRemoteAdd}
                  onRemove={handleRemoteRemove}
                  onOpenHosting={() => {
                    setShowRemotePopup(false);
                    setShowHostingSetup(true);
                  }}
                  onOpenCreateRepo={() => {
                    setShowRemotePopup(false);
                    setShowCreateRepo(true);
                  }}
                  onClose={() => setShowRemotePopup(false)}
                  t={t}
                />
              )}
            </div>
          </div>
          {/* Row 2: Tabs + refresh */}
          <div className="px-3 pb-1.5 flex items-center gap-1">
            {(["changes", "history", "stash"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  setShowLog(tab === "history");
                }}
                className={`text-[10px] px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
                  activeTab === tab
                    ? "text-bamboo bg-bamboo-mist/30 font-medium"
                    : "text-ink-ghost hover:text-ink-faint"
                }`}
              >
                {tab === "changes"
                  ? t("git.changesTab", { defaultValue: "变更" })
                  : tab === "history"
                    ? t("git.historyTab", { defaultValue: "历史" })
                    : t("git.stashTab", { defaultValue: "暂存" })}
                {tab === "stash" && stashEntries.length > 0 && (
                  <span className="ml-1 text-[9px]">{stashEntries.length}</span>
                )}
              </button>
            ))}
            {conflicts.length > 0 && (
              <span className="text-[10px] text-red-500 font-medium ml-1">
                ⚠ {conflicts.length}
              </span>
            )}
            <div className="flex-1" />
            <button
              onClick={() => refreshRef.current()}
              disabled={loading}
              className="text-[10px] px-1.5 py-0.5 rounded text-ink-ghost hover:text-ink-faint transition-colors cursor-pointer"
              title={t("common.refresh", { defaultValue: "刷新" }) as string}
            >
              ↻
            </button>
          </div>
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

      {/* Conflicts banner */}
      {conflicts.length > 0 && (
        <div className="shrink-0 px-3 py-1.5 bg-amber-100/60 dark:bg-amber-900/20 text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <span className="flex-1">
            {t("git.conflictsDetected", {
              count: conflicts.length,
              defaultValue: `检测到 ${conflicts.length} 个冲突文件`,
            })}
          </span>
          <button
            onClick={handleAbortMerge}
            className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200/50 dark:bg-amber-800/30 hover:bg-amber-300/50 cursor-pointer transition-colors"
          >
            {t("git.abortMerge", { defaultValue: "中止合并" })}
          </button>
        </div>
      )}

      {/* Diff modal */}
      {diffContent !== null && (
        <DiffModal
          content={diffContent}
          title={diffTitle}
          onClose={() => {
            setDiffContent(null);
            setDiffTitle("");
          }}
        />
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto scrollbar-hidden">
        {activeTab === "history" ? (
          /* Git graph view */
          <div className="p-0.5">
            {graphNodes.length === 0 && commits.length === 0 ? (
              <p className="text-xs text-ink-ghost text-center py-6">
                {t("git.noCommits", { defaultValue: "暂无提交记录" })}
              </p>
            ) : graphNodes.length > 0 ? (
              <div className="font-mono">
                {graphNodes.map((node) => (
                  <div
                    key={node.hash}
                    className="flex items-start py-[1px] hover:bg-paper-warm/60 transition-colors cursor-pointer group"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCtxMenu({ x: e.clientX, y: e.clientY, hash: node.hash, refs: node.refs });
                    }}
                  >
                    {/* Graph glyph column */}
                    <div className="shrink-0 flex text-[9px] leading-[14px] text-ink-ghost/50 mr-1">
                      {node.glyphs.map((g, i) => (
                        <span
                          key={i}
                          className={`w-2.5 text-center ${
                            g === "*"
                              ? "text-bamboo font-bold"
                              : g === "/" || g === "\\"
                                ? "text-amber-500"
                                : g === "|"
                                  ? "text-ink-ghost/40"
                                  : ""
                          }`}
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                    {/* Commit info */}
                    <div className="flex-1 min-w-0 pl-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-bamboo font-semibold">
                          {node.shortHash}
                        </span>
                        <span className="text-[11px] text-ink-soft truncate">{node.message}</span>
                      </div>
                      <div className="flex gap-1.5 mt-px">
                        <span className="text-[9px] text-ink-ghost">{node.author}</span>
                        <span className="text-[9px] text-ink-ghost">{node.date}</span>
                      </div>
                      {/* Ref tags */}
                      {node.refs.length > 0 && (
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          {node.refs.map((r) => (
                            <span
                              key={r}
                              className={`text-[8px] px-1 py-px rounded-full ${
                                r.startsWith("HEAD")
                                  ? "bg-bamboo/15 text-bamboo"
                                  : r.startsWith("tag:")
                                    ? "bg-amber-100/50 dark:bg-amber-900/20 text-amber-600"
                                    : r.includes("→")
                                      ? "bg-blue-100/50 dark:bg-blue-900/20 text-blue-500"
                                      : "bg-emerald-100/50 dark:bg-emerald-900/20 text-emerald-600"
                              }`}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const branchName = r
                                  .replace("HEAD→", "")
                                  .replace("tag: ", "")
                                  .split(",")[0]
                                  .trim();
                                if (branchName && !branchName.startsWith("origin/")) {
                                  setCtxMenu({ x: e.clientX, y: e.clientY, branch: branchName });
                                }
                              }}
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Fallback plain log */
              <div className="p-2 space-y-0.5">
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
        ) : activeTab === "stash" ? (
          /* Stash view */
          <div className="p-2">
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setShowStashPush(!showStashPush)}
                className="text-[10px] px-2 py-0.5 rounded bg-bamboo text-white hover:bg-bamboo-dark transition-colors cursor-pointer"
              >
                {t("git.stashPush", { defaultValue: "暂存更改" })}
              </button>
              {stashEntries.length > 0 && (
                <button
                  onClick={() => handleStashPop(0)}
                  className="text-[10px] px-2 py-0.5 rounded text-ink-faint bg-paper-warm hover:bg-paper-deep/20 transition-colors cursor-pointer"
                >
                  {t("git.stashPopLatest", { defaultValue: "恢复最近" })}
                </button>
              )}
            </div>
            {showStashPush && (
              <div className="mb-2 p-2 rounded bg-paper-warm/60 border border-paper-deep/20">
                <input
                  value={stashMessage}
                  onChange={(e) => setStashMessage(e.target.value)}
                  placeholder={
                    t("git.stashMessagePlaceholder", {
                      defaultValue: "暂存消息（可选）…",
                    }) as string
                  }
                  className="w-full text-[11px] bg-transparent border-b border-paper-deep/30 px-1 py-0.5 outline-none focus:border-bamboo/50 placeholder:text-ink-ghost mb-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleStashPush();
                  }}
                />
                <div className="flex gap-1 justify-end">
                  <button
                    onClick={() => setShowStashPush(false)}
                    className="text-[10px] px-1.5 py-0.5 rounded text-ink-ghost hover:text-ink-faint cursor-pointer"
                  >
                    {t("common.cancel", { defaultValue: "取消" })}
                  </button>
                  <button
                    onClick={handleStashPush}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-bamboo text-white hover:bg-bamboo-dark cursor-pointer"
                  >
                    {t("git.stash", { defaultValue: "暂存" })}
                  </button>
                </div>
              </div>
            )}
            {stashEntries.length === 0 ? (
              <p className="text-xs text-ink-ghost text-center py-6">
                {t("git.noStashes", { defaultValue: "暂无暂存" })}
              </p>
            ) : (
              <div className="space-y-1">
                {stashEntries.map((s) => (
                  <div
                    key={s.index}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-paper-warm/60 transition-colors group"
                  >
                    <span className="text-[10px] font-mono text-bamboo/70 shrink-0">
                      stash@&#123;{s.index}&#125;
                    </span>
                    <span className="text-[11px] text-ink-soft truncate flex-1">{s.message}</span>
                    <button
                      onClick={() => handleStashPop(s.index)}
                      className="text-[10px] px-1 rounded text-ink-ghost hover:text-bamboo cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      {t("git.pop", { defaultValue: "恢复" })}
                    </button>
                    <button
                      onClick={() => handleStashDrop(s.index)}
                      className="text-[10px] px-1 rounded text-ink-ghost hover:text-red-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      {t("git.drop", { defaultValue: "删除" })}
                    </button>
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

      {/* Context menu overlay */}
      {ctxMenu && (
        <GitCtxMenu
          ctxMenu={ctxMenu}
          branches={branches}
          currentBranch={status?.branch ?? ""}
          onCreateBranch={handleCtxCreateBranch}
          onSwitchBranch={handleCtxSwitchBranch}
          onDeleteBranch={handleCtxDeleteBranch}
          onMergeBranch={handleCtxMergeBranch}
          onClose={() => setCtxMenu(null)}
          t={t}
        />
      )}

      {/* Hosting setup modal */}
      {showHostingSetup && (
        <HostingSetup
          accounts={hostingAccounts}
          onSave={(accounts) => {
            setHostingAccounts(accounts);
            setShowHostingSetup(false);
          }}
          onClose={() => setShowHostingSetup(false)}
          t={t}
        />
      )}

      {/* Create remote repo modal */}
      {showCreateRepo && (
        <CreateRepoModal
          provider={newRepoProvider}
          repoName={newRepoName}
          isPrivate={newRepoPrivate}
          onProviderChange={setNewRepoProvider}
          onNameChange={setNewRepoName}
          onPrivateChange={setNewRepoPrivate}
          onCreate={handleCreateRemoteRepo}
          onClose={() => setShowCreateRepo(false)}
          t={t}
        />
      )}

      {/* Commit area (always at bottom, only on changes tab) */}
      {status && activeTab === "changes" && (
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
  tertiaryAction?: {
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
  tertiaryAction,
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
                {tertiaryAction && (
                  <button
                    onClick={() => tertiaryAction.onClick(f)}
                    className="text-[10px] px-1 py-0.5 rounded text-ink-ghost hover:text-blue-400 hover:bg-blue-100/40 dark:hover:bg-blue-900/20 transition-colors cursor-pointer"
                  >
                    {tertiaryAction.label}
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

/* ------------------------------------------------------------------ */
/* Branch popup */
/* ------------------------------------------------------------------ */

interface BranchPopupProps {
  branches: GitBranch[];
  currentBranch: string;
  newBranchName: string;
  onNewBranchNameChange: (v: string) => void;
  onCreateBranch: () => void;
  onSwitchBranch: (name: string) => void;
  onDeleteBranch: (name: string) => void;
  onMergeBranch: (name: string) => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}

function BranchPopup({
  branches,
  currentBranch,
  newBranchName,
  onNewBranchNameChange,
  onCreateBranch,
  onSwitchBranch,
  onDeleteBranch,
  onMergeBranch,
  onClose,
  t,
}: BranchPopupProps) {
  return (
    <div className="absolute top-full left-0 mt-1 w-52 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-paper-deep/20 z-50 overflow-hidden">
      {/* Create new branch */}
      <div className="p-2 border-b border-paper-deep/10">
        <div className="flex gap-1">
          <input
            value={newBranchName}
            onChange={(e) => onNewBranchNameChange(e.target.value)}
            placeholder={t("git.newBranchPlaceholder", { defaultValue: "新分支名…" }) as string}
            className="flex-1 text-[11px] bg-paper-warm/40 rounded px-1.5 py-1 outline-none focus:bg-paper-warm"
            onKeyDown={(e) => {
              if (e.key === "Enter") onCreateBranch();
            }}
          />
          <button
            onClick={onCreateBranch}
            disabled={!newBranchName.trim()}
            className="text-[10px] px-2 py-1 rounded bg-bamboo text-white hover:bg-bamboo-dark disabled:opacity-30 cursor-pointer"
          >
            +
          </button>
        </div>
      </div>
      {/* Branch list */}
      <div className="max-h-48 overflow-y-auto">
        {branches.map((b) => (
          <div
            key={b.name}
            className={`flex items-center gap-1.5 px-2 py-1.5 hover:bg-paper-warm/60 transition-colors ${b.isCurrent ? "bg-bamboo-mist/20" : ""}`}
          >
            <span
              className={`text-[11px] flex-1 truncate ${b.isCurrent ? "text-bamboo font-medium" : "text-ink-soft"}`}
              onClick={() => {
                if (!b.isCurrent) onSwitchBranch(b.name);
              }}
              title={
                b.isCurrent
                  ? (t("git.currentBranch", { defaultValue: "当前分支" }) as string)
                  : undefined
              }
            >
              {b.name}
              {b.isCurrent && " ✓"}
            </span>
            {!b.isCurrent && (
              <div className="flex gap-0.5">
                <button
                  onClick={() => onMergeBranch(b.name)}
                  className="text-[9px] px-1 rounded text-ink-ghost hover:text-bamboo cursor-pointer"
                  title={t("git.mergeIntoCurrent", { defaultValue: "合并到当前分支" }) as string}
                >
                  {t("git.merge", { defaultValue: "合并" })}
                </button>
                <button
                  onClick={() => onDeleteBranch(b.name)}
                  className="text-[9px] px-1 rounded text-ink-ghost hover:text-red-400 cursor-pointer"
                  title={t("git.deleteBranch", { defaultValue: "删除分支" }) as string}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Remote popup */
/* ------------------------------------------------------------------ */

interface RemotePopupProps {
  remotes: GitRemote[];
  newName: string;
  newUrl: string;
  onNameChange: (v: string) => void;
  onUrlChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (name: string) => void;
  onOpenHosting?: () => void;
  onOpenCreateRepo?: () => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}

function RemotePopup({
  remotes,
  newName,
  newUrl,
  onNameChange,
  onUrlChange,
  onAdd,
  onRemove,
  onOpenHosting,
  onOpenCreateRepo,
  onClose,
  t,
}: RemotePopupProps) {
  return (
    <div className="absolute top-full right-0 mt-1 w-64 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-paper-deep/20 z-50 overflow-hidden">
      {/* Add remote */}
      <div className="p-2 border-b border-paper-deep/10 space-y-1">
        <input
          value={newName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={
            t("git.remoteNamePlaceholder", { defaultValue: "名称 (如 origin)" }) as string
          }
          className="w-full text-[11px] bg-paper-warm/40 rounded px-1.5 py-1 outline-none focus:bg-paper-warm"
        />
        <input
          value={newUrl}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder={
            t("git.remoteUrlPlaceholder", { defaultValue: "URL (如 https://…)" }) as string
          }
          className="w-full text-[11px] bg-paper-warm/40 rounded px-1.5 py-1 outline-none focus:bg-paper-warm"
        />
        <button
          onClick={onAdd}
          disabled={!newName.trim() || !newUrl.trim()}
          className="w-full text-[10px] px-2 py-1 rounded bg-bamboo text-white hover:bg-bamboo-dark disabled:opacity-30 cursor-pointer"
        >
          {t("git.addRemote", { defaultValue: "添加远程仓库" })}
        </button>
      </div>
      {/* Remote list */}
      {remotes.length > 0 ? (
        <div className="max-h-36 overflow-y-auto">
          {remotes.map((r) => (
            <div
              key={r.name}
              className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-paper-warm/60 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-ink-soft font-medium">{r.name}</div>
                <div className="text-[9px] text-ink-ghost truncate">{r.url}</div>
              </div>
              <button
                onClick={() => onRemove(r.name)}
                className="text-[9px] px-1 rounded text-ink-ghost hover:text-red-400 cursor-pointer shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-ink-ghost text-center py-3">
          {t("git.noRemotes", { defaultValue: "无远程仓库" })}
        </p>
      )}
      {/* Hosting integration */}
      <div className="border-t border-paper-deep/10 p-2 space-y-1">
        {onOpenHosting && (
          <button
            onClick={onOpenHosting}
            className="w-full text-[10px] px-2 py-1 rounded text-ink-faint bg-paper-warm/60 hover:bg-paper-warm transition-colors cursor-pointer"
          >
            {t("git.hostingSetup", { defaultValue: "配置 GitHub / GitLab 账号" })}
          </button>
        )}
        {onOpenCreateRepo && (
          <button
            onClick={onOpenCreateRepo}
            className="w-full text-[10px] px-2 py-1 rounded bg-bamboo text-white hover:bg-bamboo-dark transition-colors cursor-pointer"
          >
            {t("git.createRemoteRepo", { defaultValue: "自动创建远程仓库" })}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Diff modal */
/* ------------------------------------------------------------------ */

interface DiffModalProps {
  content: string;
  title: string;
  onClose: () => void;
}

function DiffModal({ content, title, onClose }: DiffModalProps) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white/95 dark:bg-slate-900/95">
      <div className="shrink-0 px-3 py-1.5 flex items-center gap-2 border-b border-paper-deep/20">
        <span className="text-xs text-ink-faint font-mono truncate flex-1">{title}</span>
        <button
          onClick={onClose}
          className="text-[10px] px-1.5 py-0.5 rounded text-ink-ghost hover:text-ink-faint hover:bg-paper-warm cursor-pointer"
        >
          ✕
        </button>
      </div>
      <pre className="flex-1 overflow-auto p-3 text-[10px] font-mono text-ink-soft whitespace-pre-wrap leading-relaxed">
        {content}
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Merge picker */
/* ------------------------------------------------------------------ */

interface MergePickerProps {
  branches: GitBranch[];
  currentBranch: string;
  onMerge: (target: string) => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}

function MergePicker({ branches, currentBranch, onMerge, onClose, t }: MergePickerProps) {
  const otherBranches = branches.filter((b) => b.name !== currentBranch);
  return (
    <div className="absolute top-full right-0 mt-1 w-44 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-paper-deep/20 z-50 overflow-hidden">
      <div className="px-2 py-1.5 border-b border-paper-deep/10">
        <p className="text-[10px] text-ink-ghost">
          {t("git.mergeInto", { branch: currentBranch, defaultValue: `合并到 ${currentBranch}` })}
        </p>
      </div>
      <div className="max-h-36 overflow-y-auto">
        {otherBranches.length === 0 ? (
          <p className="text-xs text-ink-ghost text-center py-2">
            {t("git.noOtherBranches", { defaultValue: "无其他分支" })}
          </p>
        ) : (
          otherBranches.map((b) => (
            <button
              key={b.name}
              onClick={() => onMerge(b.name)}
              className="w-full text-left px-2 py-1.5 text-[11px] text-ink-soft hover:bg-bamboo-mist/20 hover:text-bamboo transition-colors cursor-pointer"
            >
              {b.name}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Context menu */
/* ------------------------------------------------------------------ */

interface GitCtxMenuProps {
  ctxMenu: { x: number; y: number; branch?: string; hash?: string; refs?: string[] };
  branches: GitBranch[];
  currentBranch: string;
  onCreateBranch: (hash: string) => void;
  onSwitchBranch: (name: string) => void;
  onDeleteBranch: (name: string) => void;
  onMergeBranch: (name: string) => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}

function GitCtxMenu({
  ctxMenu,
  currentBranch,
  onCreateBranch,
  onSwitchBranch,
  onDeleteBranch,
  onMergeBranch,
  onClose,
  t,
}: GitCtxMenuProps) {
  const isBranch = !!ctxMenu.branch;
  const isCommit = !!ctxMenu.hash;
  const targetBranch = ctxMenu.branch;
  const targetHash = ctxMenu.hash;

  return (
    <>
      <div
        className="absolute inset-0 z-50"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="absolute z-50 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-paper-deep/20 py-1 min-w-[140px]"
        style={{ left: Math.min(ctxMenu.x, window.innerWidth - 180), top: ctxMenu.y }}
      >
        {isBranch && targetBranch && (
          <>
            {targetBranch !== currentBranch && (
              <button
                onClick={() => onSwitchBranch(targetBranch)}
                className="w-full text-left px-3 py-1 text-[11px] text-ink-soft hover:bg-bamboo-mist/20 hover:text-bamboo cursor-pointer"
              >
                {t("git.ctxSwitchTo", {
                  branch: targetBranch,
                  defaultValue: `切换到 ${targetBranch}`,
                })}
              </button>
            )}
            {targetBranch !== currentBranch && (
              <button
                onClick={() => onMergeBranch(targetBranch)}
                className="w-full text-left px-3 py-1 text-[11px] text-ink-soft hover:bg-bamboo-mist/20 hover:text-bamboo cursor-pointer"
              >
                {t("git.ctxMerge", {
                  branch: targetBranch,
                  defaultValue: `合并 ${targetBranch} 到 ${currentBranch}`,
                })}
              </button>
            )}
            {targetBranch !== currentBranch && (
              <button
                onClick={() => onDeleteBranch(targetBranch)}
                className="w-full text-left px-3 py-1 text-[11px] text-ink-soft hover:bg-red-100/50 hover:text-red-500 cursor-pointer"
              >
                {t("git.ctxDeleteBranch", { defaultValue: "删除分支" })}
              </button>
            )}
          </>
        )}
        {isCommit && targetHash && (
          <>
            <button
              onClick={() => onCreateBranch(targetHash)}
              className="w-full text-left px-3 py-1 text-[11px] text-ink-soft hover:bg-bamboo-mist/20 hover:text-bamboo cursor-pointer"
            >
              {t("git.ctxCreateBranchHere", { defaultValue: "从此提交创建分支" })}
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(targetHash);
                onClose();
              }}
              className="w-full text-left px-3 py-1 text-[11px] text-ink-soft hover:bg-paper-warm/60 cursor-pointer"
            >
              {t("git.ctxCopyHash", { defaultValue: "复制提交哈希" })}
            </button>
          </>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* GitHub / GitLab hosting setup */
/* ------------------------------------------------------------------ */

interface HostingSetupProps {
  accounts: GitHostingAccount[];
  onSave: (accounts: GitHostingAccount[]) => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}

function HostingSetup({ accounts: initialAccounts, onSave, onClose, t }: HostingSetupProps) {
  const [accounts, setAccounts] = useState<GitHostingAccount[]>(initialAccounts);
  const [provider, setProvider] = useState<"github" | "gitlab">("github");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const addAccount = () => {
    if (!username.trim() || !token.trim()) return;
    setAccounts([
      ...accounts.filter((a) => a.provider !== provider),
      {
        provider,
        username: username.trim(),
        token: token.trim(),
        baseUrl: baseUrl.trim() || undefined,
      },
    ]);
    setUsername("");
    setToken("");
    setBaseUrl("");
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white/95 dark:bg-slate-900/95">
      <div className="shrink-0 px-3 py-1.5 flex items-center gap-2 border-b border-paper-deep/20">
        <span className="text-xs text-ink-faint flex-1">
          {t("git.hostingSetupTitle", { defaultValue: "托管账号配置" })}
        </span>
        <button
          onClick={onClose}
          className="text-[10px] px-1.5 py-0.5 rounded text-ink-ghost hover:text-ink-faint hover:bg-paper-warm cursor-pointer"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {accounts.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-ink-ghost font-medium">
              {t("git.savedAccounts", { defaultValue: "已保存的账号" })}
            </p>
            {accounts.map((a) => (
              <div
                key={a.provider}
                className="flex items-center gap-2 px-2 py-1.5 rounded bg-paper-warm/40"
              >
                <span className="text-[10px] font-medium text-bamboo uppercase">{a.provider}</span>
                <span className="text-[11px] text-ink-soft flex-1">{a.username}</span>
                <button
                  onClick={() => setAccounts(accounts.filter((x) => x.provider !== a.provider))}
                  className="text-[9px] px-1 rounded text-ink-ghost hover:text-red-400 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2 p-2 rounded bg-paper-warm/40 border border-paper-deep/10">
          <p className="text-[10px] text-ink-ghost">
            {t("git.addAccount", { defaultValue: "添加账号" })}
          </p>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as "github" | "gitlab")}
            className="w-full text-[11px] bg-paper-warm/40 rounded px-1.5 py-1 outline-none cursor-pointer"
          >
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
          </select>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("git.username", { defaultValue: "用户名" }) as string}
            className="w-full text-[11px] bg-paper-warm/40 rounded px-1.5 py-1 outline-none"
          />
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            type="password"
            placeholder={
              t("git.tokenPlaceholder", { defaultValue: "Personal Access Token" }) as string
            }
            className="w-full text-[11px] bg-paper-warm/40 rounded px-1.5 py-1 outline-none"
          />
          {provider === "gitlab" && (
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={
                t("git.gitlabUrl", { defaultValue: "https://gitlab.com (留空使用默认)" }) as string
              }
              className="w-full text-[11px] bg-paper-warm/40 rounded px-1.5 py-1 outline-none"
            />
          )}
          <button
            onClick={addAccount}
            disabled={!username.trim() || !token.trim()}
            className="w-full text-[10px] px-2 py-1 rounded bg-bamboo text-white hover:bg-bamboo-dark disabled:opacity-30 cursor-pointer"
          >
            {t("git.saveAccount", { defaultValue: "保存账号" })}
          </button>
        </div>
        <p className="text-[9px] text-ink-ghost leading-relaxed">
          {t("git.tokenHelp", {
            defaultValue:
              "GitHub: Settings → Developer settings → Personal access tokens → Tokens (classic)，需要 repo 权限",
          })}
        </p>
      </div>
      <div className="shrink-0 border-t border-paper-deep/20 p-2">
        <button
          onClick={() => onSave(accounts)}
          className="w-full py-1.5 rounded-lg bg-bamboo text-white text-xs font-medium hover:bg-bamboo-dark cursor-pointer"
        >
          {t("common.save", { defaultValue: "保存" })}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create remote repo modal */
/* ------------------------------------------------------------------ */

interface CreateRepoModalProps {
  provider: "github" | "gitlab";
  repoName: string;
  isPrivate: boolean;
  onProviderChange: (p: "github" | "gitlab") => void;
  onNameChange: (n: string) => void;
  onPrivateChange: (p: boolean) => void;
  onCreate: () => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}

function CreateRepoModal({
  provider,
  repoName,
  isPrivate,
  onProviderChange,
  onNameChange,
  onPrivateChange,
  onCreate,
  onClose,
  t,
}: CreateRepoModalProps) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white/95 dark:bg-slate-900/95">
      <div className="shrink-0 px-3 py-1.5 flex items-center gap-2 border-b border-paper-deep/20">
        <span className="text-xs text-ink-faint flex-1">
          {t("git.createRemoteRepoTitle", { defaultValue: "创建远程仓库" })}
        </span>
        <button
          onClick={onClose}
          className="text-[10px] px-1.5 py-0.5 rounded text-ink-ghost hover:text-ink-faint hover:bg-paper-warm cursor-pointer"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 p-3 space-y-3">
        <select
          value={provider}
          onChange={(e) => onProviderChange(e.target.value as "github" | "gitlab")}
          className="w-full text-[11px] bg-paper-warm/40 rounded px-2 py-1.5 outline-none cursor-pointer"
        >
          <option value="github">GitHub</option>
          <option value="gitlab">GitLab</option>
        </select>
        <input
          value={repoName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t("git.repoNamePlaceholder", { defaultValue: "仓库名称" }) as string}
          className="w-full text-[11px] bg-paper-warm/40 rounded px-2 py-1.5 outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter") onCreate();
          }}
        />
        <label className="flex items-center gap-2 text-[11px] text-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => onPrivateChange(e.target.checked)}
            className="rounded cursor-pointer"
          />
          {t("git.privateRepo", { defaultValue: "私有仓库" })}
        </label>
      </div>
      <div className="shrink-0 border-t border-paper-deep/20 p-2 space-y-1.5">
        <button
          onClick={onCreate}
          disabled={!repoName.trim()}
          className="w-full py-1.5 rounded-lg bg-bamboo text-white text-xs font-medium hover:bg-bamboo-dark disabled:opacity-40 cursor-pointer"
        >
          {t("git.createAndAddRemote", { defaultValue: "创建并添加为远程仓库" })}
        </button>
        <button
          onClick={onClose}
          className="w-full py-1 rounded text-[10px] text-ink-ghost hover:text-ink-faint cursor-pointer"
        >
          {t("common.cancel", { defaultValue: "取消" })}
        </button>
      </div>
    </div>
  );
}
