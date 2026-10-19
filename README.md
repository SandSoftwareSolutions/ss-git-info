# @sandsoftwaresolutions/git-info

[![CI](https://github.com/SandSoftwareSolutions/ss-git-info/actions/workflows/ci.yml/badge.svg)](https://github.com/SandSoftwareSolutions/ss-git-info/actions/workflows/ci.yml)

Ask git what it knows (commit, branch, tag, changes) for a version stamp in your build, a `/version` endpoint or a bug report. It never fails your build: where git is not available you get `null`s. No dependencies, but it needs the `git` program when it runs.

## Install

```bash
npm install @sandsoftwaresolutions/git-info
```

## Usage

```js
import { gitInfo, versionStamp } from "@sandsoftwaresolutions/git-info";

await versionStamp();
// "1.4.0"                      exactly on the tag v1.4.0
// "1.4.0+3.gabc1234"           three commits after v1.4.0
// "1.4.0+3.gabc1234-dirty"     with uncommitted changes
// "0.0.0+gabc1234"             no tags yet
// "0.0.0+unknown"              not a git repository (use `fallback` to change it)

const info = await gitInfo();
// { isRepo, commit, shortCommit, branch, tag, describe, dirty, commitDate, remote }
```

Typical use, in a build script:

```js
writeFileSync("dist/version.json", JSON.stringify({ version: await versionStamp(), ...await gitInfo() }));
```

## Details

- **Nothing throws.** Not a repository, git not installed, a repository without commits, a detached HEAD, no tag: each field is `null` and `versionStamp` gives the fallback. A build must not break because someone downloaded a zip.
- `dirty` is `true` when tracked files changed or there are new files that are not ignored; ignored files do not count.
- `tag` is set only when HEAD is exactly on a tag; `describe` is `git describe --tags --always --long`.
- **No secrets in stamps.** The `origin` URL is shown without credentials, so a token inside a clone URL never ends up in a published file.
- Git is started without a shell and with a time limit (`timeoutMs`, default 5 seconds), prompts for passwords are switched off, and the output language is fixed.
- Works from any subfolder of the repository.
- `branch` is the plain branch name, also when a tag has the same name. It is returned exactly as git has it: branch names may contain `$`, quotes and backticks, so quote it when you put it in a shell command or HTML.
- Variables such as `GIT_DIR` and `GIT_INDEX_FILE` (set inside git hooks) are removed for the git calls, so the folder you ask about is the one you get (so a deliberate `GIT_DIR`/`GIT_WORK_TREE` set-up, such as a bare dotfiles repository, reads as not a repository). `GIT_CEILING_DIRECTORIES` is left alone, so it still stops git from climbing into a parent repository. Git is run with `--no-optional-locks`, so asking never writes to the repository.
- A repository that git refuses to open ("dubious ownership", `safe.directory`) looks like not a repository: `isRepo` is `false`.
- A huge list of changes still gives `dirty: true`. Only a timeout gives `dirty: null`.
- `1.4.0-dirty` (a dirty checkout exactly on a tag) is, to semver, a pre-release that sorts *before* 1.4.0. If you compare versions, use the `+` part (`gitInfo().dirty`) instead of the suffix.
