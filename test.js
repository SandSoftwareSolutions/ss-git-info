import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { gitInfo, hideCredentials, versionStamp } from "./src/index.js";

const base = mkdtempSync(join(tmpdir(), "git-info-"));
after(() => rmSync(base, { recursive: true, force: true }));
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-C", cwd, ...args], { encoding: "utf8" });
let n = 0;
function repo() {
  const dir = join(base, `r${n++}`);
  mkdirSync(dir);
  git(dir, "init", "-q", "-b", "main");
  return dir;
}
const commit = (dir, file = "a.txt", text = "x") => {
  writeFileSync(join(dir, file), text);
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", `change ${file}`);
};

test("a folder that is not a repository gives nulls and never throws", async () => {
  const dir = join(base, "plain");
  mkdirSync(dir);
  const info = await gitInfo(dir);
  assert.equal(info.isRepo, false);
  assert.ok(Object.values(info).every((v) => v === null || v === false));
  assert.equal(await versionStamp(dir), "0.0.0+unknown");
  assert.equal(await versionStamp(dir, { fallback: "dev" }), "dev");
  assert.equal((await gitInfo(join(base, "does-not-exist"))).isRepo, false);
});

test("a repository without commits yet", async () => {
  const dir = repo();
  const info = await gitInfo(dir);
  assert.equal(info.isRepo, true);
  assert.equal(info.commit, null);
  assert.equal(await versionStamp(dir), "0.0.0+unknown");
});

test("branch, commit and a clean state", async () => {
  const dir = repo();
  commit(dir);
  const info = await gitInfo(dir);
  assert.equal(info.branch, "main");
  assert.match(info.commit, /^[0-9a-f]{40}$/);
  assert.equal(info.shortCommit, info.commit.slice(0, 7));
  assert.equal(info.dirty, false);
  assert.equal(info.tag, null);
  assert.match(info.commitDate, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(await versionStamp(dir), `0.0.0+g${info.shortCommit}`);
});

test("dirty: changed tracked files and new files count, ignored files do not", async () => {
  const dir = repo();
  commit(dir);
  writeFileSync(join(dir, ".gitignore"), "ignored.txt\n");
  git(dir, "add", ".gitignore");
  git(dir, "commit", "-q", "-m", "ignore");
  writeFileSync(join(dir, "ignored.txt"), "x");
  assert.equal((await gitInfo(dir)).dirty, false);
  writeFileSync(join(dir, "new.txt"), "x");
  assert.equal((await gitInfo(dir)).dirty, true);
  rmSync(join(dir, "new.txt"));
  writeFileSync(join(dir, "a.txt"), "changed");
  assert.equal((await gitInfo(dir)).dirty, true);
});

test("version stamps follow the tags", async () => {
  const dir = repo();
  commit(dir);
  git(dir, "tag", "v1.4.0");
  const onTag = await gitInfo(dir);
  assert.equal(onTag.tag, "v1.4.0");
  assert.equal(await versionStamp(dir), "1.4.0");
  commit(dir, "b.txt");
  commit(dir, "c.txt");
  const after = await gitInfo(dir);
  assert.equal(after.tag, null);
  assert.equal(await versionStamp(dir), `1.4.0+2.g${after.shortCommit}`);
  writeFileSync(join(dir, "c.txt"), "dirty");
  assert.equal(await versionStamp(dir), `1.4.0+2.g${after.shortCommit}-dirty`);
});

test("a detached HEAD has no branch", async () => {
  const dir = repo();
  commit(dir);
  commit(dir, "b.txt");
  git(dir, "checkout", "-q", "--detach", "HEAD~1");
  assert.equal((await gitInfo(dir)).branch, null);
});

test("the remote is shown without credentials", async () => {
  const dir = repo();
  commit(dir);
  git(dir, "remote", "add", "origin", "https://user:ghp_secret@github.com/x/y.git");
  const info = await gitInfo(dir);
  assert.equal(info.remote, "https://github.com/x/y.git");
  assert.ok(!JSON.stringify(info).includes("ghp_secret"));
  assert.equal(hideCredentials("https://token@host/x.git"), "https://host/x.git");
  assert.equal(hideCredentials("git@github.com:x/y.git"), "git@github.com:x/y.git");
  assert.equal(hideCredentials("ssh://git@host/x.git"), "ssh://host/x.git");
});

test("works from a subfolder", async () => {
  const dir = repo();
  commit(dir);
  mkdirSync(join(dir, "sub"));
  assert.equal((await gitInfo(join(dir, "sub"))).isRepo, true);
});

test("a branch with the same name as a tag is still just the branch name", async () => {
  const dir = repo();
  commit(dir);
  git(dir, "tag", "release");
  git(dir, "checkout", "-q", "-b", "other");
  git(dir, "branch", "-m", "release");
  const info = await gitInfo(dir);
  assert.equal(info.branch, "release");
  assert.equal(info.tag, "release");
});

test("hostile branch names come back as plain text and nothing is run", { skip: process.platform === "win32" }, async () => {
  const dir = repo();
  commit(dir);
  const name = "$(touch${IFS}pwned);`touch${IFS}pwned2`;x\"y'z";
  git(dir, "checkout", "-q", "-b", name);
  assert.equal((await gitInfo(dir)).branch, name);
  assert.equal(existsSync(join(dir, "pwned")) || existsSync(join(dir, "pwned2")) || existsSync("pwned"), false);
});

test("a password that contains @ is hidden completely", () => {
  assert.equal(hideCredentials("https://user:p@ss@host/x.git"), "https://host/x.git");
  assert.equal(hideCredentials("https://user:p%40ss@host/x.git"), "https://host/x.git");
  assert.equal(hideCredentials("https://user:secret@host?x=1@y"), "https://host?x=1@y");
  assert.equal(hideCredentials("https://host/@scope/pkg.git"), "https://host/@scope/pkg.git");
});

test("a very long list of changes still counts as dirty", { timeout: 60000 }, async () => {
  const dir = repo();
  commit(dir);
  for (let i = 0; i < 9500; i++) writeFileSync(join(dir, `${"u".repeat(120)}${i}`), "");
  assert.equal((await gitInfo(dir)).dirty, true);
});

test("variables set inside git hooks do not point it at another repository", async () => {
  const mine = repo();
  commit(mine, "mine.txt");
  const other = repo();
  commit(other, "other.txt", "other");
  const wanted = git(mine, "rev-parse", "HEAD").trim();
  const saved = process.env.GIT_DIR;
  process.env.GIT_DIR = join(other, ".git");
  try {
    assert.equal((await gitInfo(mine)).commit, wanted);
  } finally {
    if (saved === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = saved;
  }
});

test("a cwd that is not usable gives nulls, not an exception", async () => {
  assert.equal((await gitInfo(123)).isRepo, false);
  assert.equal((await gitInfo("a\0b")).isRepo, false);
});

test("GIT_CEILING_DIRECTORIES is respected: a folder below it is not taken for the repository above it", () => {
  const outer = repo();
  commit(outer);
  const sub = join(outer, "sub");
  mkdirSync(sub);
  const saved = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = outer;
  return gitInfo(sub).then((info) => {
    assert.equal(info.isRepo, false);
  }).finally(() => {
    if (saved === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = saved;
  });
});
