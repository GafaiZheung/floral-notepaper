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

/** A single node in the git graph visualization. */
export interface GitGraphNode {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  /** Column index for this commit (0-based, leftmost lane). */
  lane: number;
  /** The visual graph glyph string per column (e.g. ["*", "|", " ", "/"]). */
  glyphs: string[];
  /** Ref names pointing at this commit (branch heads, tags, HEAD). */
  refs: string[];
  /** Whether this commit is on the currently checked-out branch. */
  isHead: boolean;
}

/** A configured GitHub/GitLab account for remote repo creation. */
export interface GitHostingAccount {
  provider: "github" | "gitlab";
  username: string;
  token: string;
  baseUrl?: string;
}

/** Request to create a remote repository. */
export interface GitCreateRepoRequest {
  provider: "github" | "gitlab";
  token: string;
  repoName: string;
  description?: string;
  private?: boolean;
  baseUrl?: string;
}
