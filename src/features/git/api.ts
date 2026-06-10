import { invoke } from "@tauri-apps/api/core";
import type { GitBranch, GitCommit, GitRemote, GitStashEntry, GitStatus } from "./types";

const T_CMD = {
  checkInstalled: "git_check_installed",
  isRepo: "git_is_repo",
  init: "git_init",
  status: "git_status",
  stageFiles: "git_stage_files",
  stageAll: "git_stage_all",
  unstageFiles: "git_unstage_files",
  commit: "git_commit",
  log: "git_log",
  revertFile: "git_revert_file",
  // Branch
  branchList: "git_branch_list",
  branchCreate: "git_branch_create",
  branchSwitch: "git_branch_switch",
  branchDelete: "git_branch_delete",
  branchMerge: "git_branch_merge",
  // Remote
  remoteList: "git_remote_list",
  remoteAdd: "git_remote_add",
  remoteRemove: "git_remote_remove",
  push: "git_push",
  pull: "git_pull",
  fetch: "git_fetch",
  // Diff
  diffUnstaged: "git_diff_unstaged",
  diffStaged: "git_diff_staged",
  diffCommit: "git_diff_commit",
  // Stash
  stashPush: "git_stash_push",
  stashPop: "git_stash_pop",
  stashList: "git_stash_list",
  stashDrop: "git_stash_drop",
  // Advanced
  commitAmend: "git_commit_amend",
  hasConflicts: "git_has_conflicts",
  conflictedFiles: "git_conflicted_files",
  abortMerge: "git_abort_merge",
  readGitignore: "git_read_gitignore",
  writeGitignore: "git_write_gitignore",
} as const;

function parseError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === "string") return new Error(e);
  // Tauri v2 wraps command errors as plain objects with a `message` field.
  if (e && typeof e === "object" && "message" in (e as Record<string, unknown>)) {
    return new Error(String((e as Record<string, unknown>).message));
  }
  return new Error("Unknown git error");
}

export async function checkGitInstalled(): Promise<boolean> {
  try {
    return await invoke<boolean>(T_CMD.checkInstalled);
  } catch {
    return false;
  }
}

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    return await invoke<boolean>(T_CMD.isRepo, { path });
  } catch {
    return false;
  }
}

export async function initRepo(path: string): Promise<void> {
  try {
    await invoke<string>(T_CMD.init, { path });
  } catch (e) {
    throw parseError(e);
  }
}

export async function getStatus(path: string): Promise<GitStatus> {
  try {
    return await invoke<GitStatus>(T_CMD.status, { path });
  } catch (e) {
    throw parseError(e);
  }
}

export async function stageFiles(path: string, files: string[]): Promise<void> {
  try {
    await invoke<string>(T_CMD.stageFiles, { path, files });
  } catch (e) {
    throw parseError(e);
  }
}

export async function stageAll(path: string): Promise<void> {
  try {
    await invoke<string>(T_CMD.stageAll, { path });
  } catch (e) {
    throw parseError(e);
  }
}

export async function unstageFiles(path: string, files: string[]): Promise<void> {
  try {
    await invoke<string>(T_CMD.unstageFiles, { path, files });
  } catch (e) {
    throw parseError(e);
  }
}

export async function commit(path: string, message: string): Promise<void> {
  try {
    await invoke<string>(T_CMD.commit, { path, message });
  } catch (e) {
    throw parseError(e);
  }
}

export async function getLog(path: string, count?: number): Promise<GitCommit[]> {
  try {
    return await invoke<GitCommit[]>(T_CMD.log, { path, count });
  } catch (e) {
    throw parseError(e);
  }
}

export async function revertFile(path: string, file: string): Promise<void> {
  try {
    await invoke<string>(T_CMD.revertFile, { path, file });
  } catch (e) {
    throw parseError(e);
  }
}

// ---------------------------------------------------------------------------
// Branch management
// ---------------------------------------------------------------------------

export async function branchList(path: string): Promise<GitBranch[]> {
  try {
    return await invoke<GitBranch[]>(T_CMD.branchList, { path });
  } catch (e) {
    throw parseError(e);
  }
}

export async function branchCreate(path: string, name: string): Promise<void> {
  try {
    await invoke<string>(T_CMD.branchCreate, { path, name });
  } catch (e) {
    throw parseError(e);
  }
}

export async function branchSwitch(path: string, name: string): Promise<void> {
  try {
    await invoke<string>(T_CMD.branchSwitch, { path, name });
  } catch (e) {
    throw parseError(e);
  }
}

export async function branchDelete(path: string, name: string, force: boolean): Promise<void> {
  try {
    await invoke<string>(T_CMD.branchDelete, { path, name, force });
  } catch (e) {
    throw parseError(e);
  }
}

export async function branchMerge(path: string, name: string): Promise<void> {
  try {
    await invoke<string>(T_CMD.branchMerge, { path, name });
  } catch (e) {
    throw parseError(e);
  }
}

// ---------------------------------------------------------------------------
// Remote operations
// ---------------------------------------------------------------------------

export async function remoteList(path: string): Promise<GitRemote[]> {
  try {
    return await invoke<GitRemote[]>(T_CMD.remoteList, { path });
  } catch (e) {
    throw parseError(e);
  }
}

export async function remoteAdd(path: string, name: string, url: string): Promise<void> {
  try {
    await invoke<string>(T_CMD.remoteAdd, { path, name, url });
  } catch (e) {
    throw parseError(e);
  }
}

export async function remoteRemove(path: string, name: string): Promise<void> {
  try {
    await invoke<string>(T_CMD.remoteRemove, { path, name });
  } catch (e) {
    throw parseError(e);
  }
}

export async function push(path: string, remote?: string, branch?: string): Promise<void> {
  try {
    await invoke<string>(T_CMD.push, { path, remote, branch });
  } catch (e) {
    throw parseError(e);
  }
}

export async function pull(path: string, remote?: string, branch?: string): Promise<void> {
  try {
    await invoke<string>(T_CMD.pull, { path, remote, branch });
  } catch (e) {
    throw parseError(e);
  }
}

export async function fetch(path: string, remote?: string): Promise<void> {
  try {
    await invoke<string>(T_CMD.fetch, { path, remote });
  } catch (e) {
    throw parseError(e);
  }
}

// ---------------------------------------------------------------------------
// Diff viewing
// ---------------------------------------------------------------------------

export async function diffUnstaged(path: string, file?: string): Promise<string> {
  try {
    return await invoke<string>(T_CMD.diffUnstaged, { path, file });
  } catch (e) {
    throw parseError(e);
  }
}

export async function diffStaged(path: string, file?: string): Promise<string> {
  try {
    return await invoke<string>(T_CMD.diffStaged, { path, file });
  } catch (e) {
    throw parseError(e);
  }
}

export async function diffCommit(path: string, hash: string): Promise<string> {
  try {
    return await invoke<string>(T_CMD.diffCommit, { path, hash });
  } catch (e) {
    throw parseError(e);
  }
}

// ---------------------------------------------------------------------------
// Stash
// ---------------------------------------------------------------------------

export async function stashPush(path: string, message?: string): Promise<void> {
  try {
    await invoke<string>(T_CMD.stashPush, { path, message });
  } catch (e) {
    throw parseError(e);
  }
}

export async function stashPop(path: string, index?: number): Promise<void> {
  try {
    await invoke<string>(T_CMD.stashPop, { path, index });
  } catch (e) {
    throw parseError(e);
  }
}

export async function stashList(path: string): Promise<GitStashEntry[]> {
  try {
    return await invoke<GitStashEntry[]>(T_CMD.stashList, { path });
  } catch (e) {
    throw parseError(e);
  }
}

export async function stashDrop(path: string, index?: number): Promise<void> {
  try {
    await invoke<string>(T_CMD.stashDrop, { path, index });
  } catch (e) {
    throw parseError(e);
  }
}

// ---------------------------------------------------------------------------
// Advanced operations
// ---------------------------------------------------------------------------

export async function commitAmend(path: string): Promise<void> {
  try {
    await invoke<string>(T_CMD.commitAmend, { path });
  } catch (e) {
    throw parseError(e);
  }
}

export async function hasConflicts(path: string): Promise<boolean> {
  try {
    return await invoke<boolean>(T_CMD.hasConflicts, { path });
  } catch (e) {
    throw parseError(e);
  }
}

export async function conflictedFiles(path: string): Promise<string[]> {
  try {
    return await invoke<string[]>(T_CMD.conflictedFiles, { path });
  } catch (e) {
    throw parseError(e);
  }
}

export async function abortMerge(path: string): Promise<void> {
  try {
    await invoke<string>(T_CMD.abortMerge, { path });
  } catch (e) {
    throw parseError(e);
  }
}

export async function readGitignore(path: string): Promise<string> {
  try {
    return await invoke<string>(T_CMD.readGitignore, { path });
  } catch (e) {
    throw parseError(e);
  }
}

export async function writeGitignore(path: string, content: string): Promise<void> {
  try {
    await invoke<null>(T_CMD.writeGitignore, { path, content });
  } catch (e) {
    throw parseError(e);
  }
}
