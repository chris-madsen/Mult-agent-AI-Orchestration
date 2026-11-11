# Offline Markdown link verification

ACE checks local links in changed Markdown files with pinned Lychee during pull-request CI.

## Scope

The `docs-links` job in `.github/workflows/ace-contracts.yml`:

- runs on pull requests;
- derives Markdown inputs from the PR base/head diff using NUL-delimited Git filenames (including Unicode paths);
- checks only added/copied/modified/renamed/type-changed `*.md` paths;
- fails closed on newline/carriage-return filenames and changed Markdown symlinks instead of silently skipping them;
- excludes only `.github/fixtures/markdown-links/`, because that directory deliberately contains a broken negative fixture;
- runs Lychee with `--offline`, so HTTP/HTTPS targets are not requested;
- enables local anchor-fragment checking;
- does not install the Node dependency tree or provider/model dependencies.

The action is pinned by full commit SHA and the Lychee binary version is pinned explicitly. Git's default quoted `--name-only` output is avoided because it silently omitted changed Unicode Markdown filenames.

## Controlled fixtures

- `.github/fixtures/markdown-links/broken.md` must fail because its local target does not exist.
- `.github/fixtures/markdown-links/valid.md` must pass. It exercises a URL-encoded filename with a Markdown anchor.
- `.github/fixtures/markdown-links/target file.md` is the valid target.

Fixture self-tests run only when the link-gate workflow or fixture directory changes. Ordinary PRs run only the changed-Markdown verification.

## Local reproduction

With Lychee v0.24.2 available:

```bash
lychee \
  --offline \
  --include-fragments=anchor-only \
  --no-progress \
  --root-dir "$(pwd)" \
  docs/path/to/changed-file.md
```

Negative fixture:

```bash
lychee \
  --offline \
  --include-fragments=anchor-only \
  --no-progress \
  --root-dir "$(pwd)" \
  .github/fixtures/markdown-links/broken.md
```

The negative fixture is expected to return non-zero. Do not "fix" it by weakening the checker or excluding arbitrary documentation paths.

## Evidence discipline

A successful production gate proves only local file/anchor integrity for the changed Markdown inputs. It does not prove remote URLs are reachable. Remote-link health remains a separate nonblocking/scheduled concern under the SDLC quality-gate plan.
