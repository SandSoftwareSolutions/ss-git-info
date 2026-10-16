import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
