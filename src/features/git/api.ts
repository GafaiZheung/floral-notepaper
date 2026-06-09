import { invoke } from "@tauri-apps/api/core";
import type { GitCommit, GitStatus } from "./types";

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
