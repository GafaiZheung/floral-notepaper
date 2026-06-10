/** A single file entry in git status output. */
export interface GitFileStatus {
  path: string;
  status: "staged" | "modified" | "untracked" | "deleted" | "renamed";
  oldPath?: string;
}

/** A single commit from git log. */
export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

/** Full git status returned by backend. */
export interface GitStatus {
  branch: string;
  files: GitFileStatus[];
  ahead: number;
  behind: number;
}

/** A single branch. */
export interface GitBranch {
  name: string;
  isCurrent: boolean;
  upstream?: string;
}

/** A configured remote. */
export interface GitRemote {
  name: string;
  url: string;
  fetch: boolean;
  push: boolean;
}

/** A stash entry. */
export interface GitStashEntry {
  index: number;
  message: string;
  branch: string;
  date: string;
}
