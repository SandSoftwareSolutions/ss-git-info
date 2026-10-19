import { execFile } from "node:child_process";

// Variables that make git look at another repository than the folder we ask about (they are set inside git hooks, for example).
const REDIRECTING = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_CEILING_DIRECTORIES"];

function environment() {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
  for (const name of REDIRECTING) delete env[name];
  return env;
}

// Resolves with the trimmed output, or null when git fails. With `anyOutput`, output that was too long to keep also counts
// (the caller only wants to know whether there was any).
function git(cwd, args, timeoutMs, { anyOutput = false } = {}) {
  return new Promise((resolve) => {
    try {
      execFile("git", ["--no-optional-locks", "-C", cwd, ...args], { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024, env: environment() }, (error, stdout) => {
        if (error) resolve(anyOutput && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "(a lot)" : null);
        else resolve(stdout.trim());
      });
    } catch {
      resolve(null); // a cwd that is not even a string, or contains a NUL
    }
  });
}

/**
 * What git knows about a folder, for putting in a version or build stamp: `{ isRepo, commit, shortCommit, branch, tag, describe,
 * dirty, commitDate, remote }`. Every field is `null` when it is not available (not a git repo, git not installed, no commits
 * yet, no tag), and nothing throws: a build must not fail because it is run from a downloaded zip.
 * `dirty` is true when tracked files have changes or there are new files that are not ignored.
 */
export async function gitInfo(cwd = ".", { timeoutMs = 5000 } = {}) {
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"], timeoutMs);
  const empty = { isRepo: false, commit: null, shortCommit: null, branch: null, tag: null, describe: null, dirty: null, commitDate: null, remote: null };
  if (inside !== "true") return empty;
  const [commit, short, branch, tag, describe, status, date, remote] = await Promise.all([
    git(cwd, ["rev-parse", "HEAD"], timeoutMs),
    git(cwd, ["rev-parse", "--short=7", "HEAD"], timeoutMs),
    git(cwd, ["symbolic-ref", "-q", "HEAD"], timeoutMs), // the full name: --short would say "heads/x" when a tag x exists too
    git(cwd, ["describe", "--tags", "--exact-match", "HEAD"], timeoutMs),
    git(cwd, ["describe", "--tags", "--always", "--long"], timeoutMs),
    git(cwd, ["status", "--porcelain"], timeoutMs, { anyOutput: true }),
    git(cwd, ["show", "-s", "--format=%cI", "HEAD"], timeoutMs),
    git(cwd, ["remote", "get-url", "origin"], timeoutMs)
  ]);
  return {
    isRepo: true,
    commit: commit || null,
    shortCommit: short || null,
    branch: branch ? branch.replace(/^refs\/heads\//, "") : null, // null on a detached HEAD
    tag: tag || null, // only when HEAD is exactly on a tag
    describe: describe || null,
    dirty: status === null ? null : status.length > 0,
    commitDate: date || null,
    remote: remote ? hideCredentials(remote) : null
  };
}

/** `https://user:token@github.com/x/y.git` becomes `https://github.com/x/y.git`, so a token never ends up in a build stamp. */
export function hideCredentials(url) {
  return String(url).replace(/^(\w+:\/\/)[^/?#\s]*@/, "$1");
}

/**
 * A readable version for builds: on a tag `1.4.0`, after it `1.4.0+3.gabc1234`, with changes `...-dirty`, without any tag
 * `0.0.0+gabc1234`; `fallback` (default "0.0.0+unknown") when this is not a git repository. A leading "v" on the tag is removed.
 */
export async function versionStamp(cwd = ".", { fallback = "0.0.0+unknown", ...options } = {}) {
  const info = await gitInfo(cwd, options);
  if (!info.isRepo || !info.commit) return fallback;
  const match = /^(.*)-(\d+)-g([0-9a-f]+)$/.exec(info.describe ?? "");
  let version;
  if (match) version = match[2] === "0" ? match[1] : `${match[1]}+${match[2]}.g${match[3]}`;
  else version = `0.0.0+g${info.shortCommit}`;
  version = version.replace(/^v(?=\d)/, "");
  return info.dirty ? `${version}-dirty` : version;
}
