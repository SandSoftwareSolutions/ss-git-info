export interface GitInfo {
  isRepo: boolean;
  commit: string | null;
  shortCommit: string | null;
  /** null on a detached HEAD. */
  branch: string | null;
  /** Only when HEAD is exactly on a tag. */
  tag: string | null;
  /** Like `git describe --tags --always --long`. */
  describe: string | null;
  dirty: boolean | null;
  /** ISO 8601 date of the commit. */
  commitDate: string | null;
  /** The URL of "origin", without credentials. */
  remote: string | null;
}

export function gitInfo(cwd?: string, options?: { timeoutMs?: number }): Promise<GitInfo>;
export function versionStamp(cwd?: string, options?: { fallback?: string; timeoutMs?: number }): Promise<string>;
export function hideCredentials(url: string): string;
