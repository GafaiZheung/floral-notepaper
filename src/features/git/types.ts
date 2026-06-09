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
