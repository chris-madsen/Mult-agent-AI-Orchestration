# SDLC-QG1 tool selection — secret and GitHub workflow security gates

**Date:** 2026-11-10  
**Status:** implementation research for SDLC-QG1  
**Governing requirement:** `docs/research/sdlc/QUALITY-GATES-IMPLEMENTATION-PLAN.md`, section **PR-QG1 — security and workflow checks**.

## Objective

Add narrowly scoped, reproducible checks for:

1. newly introduced secrets in pull-request changes;
2. GitHub Actions syntax/expression mistakes;
3. dangerous GitHub Actions security constructs.

The implementation must not upload repository contents or credentials to a third-party scanning service, must not validate discovered credentials against providers, and must keep exact tool versions reproducible.

## Secret scanner comparison

### Gitleaks

Inspected current upstream state:

- repository: `gitleaks/gitleaks`;
- license: MIT;
- latest release inspected: `v8.30.1`;
- supports Git history, directory and stdin scanning;
- supports redaction, baselines and commit-range control through Git log options.

However, the upstream README explicitly says Gitleaks is **feature complete**, that new features are no longer being merged, and that maintainer focus has shifted to Betterleaks. It remains a mature option, but it is no longer the actively developed path.

### Betterleaks

Inspected stable release:

- repository: `betterleaks/betterleaks`;
- license: MIT;
- selected stable release: `v1.10.0`;
- Linux x64 archive SHA-256: `9d9ad503cd5d80d18a939352266c3fcca52f10da9b83cd5cfe646989b13940fe`;
- release date: 2026-11-04;
- maintained by the team that created Gitleaks, including the original author;
- supports Git history, filesystem, stdin and Git-diff scans;
- provider validation is opt-in; ordinary scans do not make credential-provider requests;
- supports full output redaction with `--redact`;
- supports custom Git log ranges and pre-commit/staged diffs.

The upstream `main` branch is already v2 development, so ACE will deliberately pin the stable **v1.10.0 release artifact**, not install from `main` or `@latest`.

### Decision

Select **Betterleaks v1.10.0** for SDLC-QG1.

Reasoning:

- actively maintained successor path;
- stable release exists with published artifact digest;
- supports the exact PR-diff/stdin model ACE needs;
- scans do not require provider validation or a GitHub token;
- full redaction is available;
- avoids adding a second home-grown secret parser.

Gitleaks remains a valid fallback if Betterleaks proves incompatible in CI, but both scanners must not be enabled simultaneously for the same merge gate without evidence that the duplicated signal is worth the maintenance/noise.

## Workflow tooling

### zizmor

Selected:

- repository: `zizmorcore/zizmor`;
- license: MIT;
- version: `v1.32.0`;
- Linux x86_64 archive SHA-256: `bb110cc765eca9cd7efb2e284a956be5974c60027b0970f16397d86208a9957b`.

Why:

- purpose-built static security analysis for GitHub Actions;
- offline mode is explicit;
- detects excessive permissions, dangerous triggers, template injection, insecure workflow commands and related CI security risks;
- local workflow inputs do not require a GitHub API token.

ACE will use `--offline` and the regular/default persona for the blocking PR gate. Online-only audits are not a prerequisite for QG1.

### actionlint

Selected:

- repository: `rhysd/actionlint`;
- license: MIT;
- version: `v1.7.12`;
- Linux amd64 archive SHA-256: `8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`.

Why:

- focused workflow syntax/schema/expression validation;
- catches errors complementary to zizmor;
- detects malformed workflow keys, invalid expressions, action input mistakes and untrusted expressions;
- standalone released binary avoids a new package-manager dependency.

## Installation policy

For all three tools:

- download only the explicitly versioned GitHub release artifact;
- verify the exact SHA-256 before extraction/use;
- install into `$RUNNER_TEMP`, not the repository;
- do not commit downloaded binaries;
- do not use `latest`, unpinned `go install`, Homebrew, npm, pip or mutable container tags in CI.

## Pull-request gate design

### Secret scan

Input is the PR base→head patch, excluding only the controlled security fixture directory.

The patch is piped to Betterleaks using Git-diff parsing:

```text
git diff <base> <head> ... | betterleaks stdin --git-diff --redact
```

Properties:

- only newly introduced PR content blocks the merge;
- legacy repository history does not become an accidental PR blocker;
- no provider validation/analysis/revocation flags;
- no GitHub token passed to Betterleaks;
- findings are fully redacted before logs.

### Workflow checks

Run only when `.github/workflows/*.yml` or `.github/workflows/*.yaml` changes.

- `actionlint` checks workflow syntax/expressions/action inputs;
- `zizmor --offline` checks security properties;
- both operate on local checked-out files.

## Controlled fixtures

### Secret negative fixture

A deterministic fake string matching Betterleaks' built-in `github-fine-grained-pat` shape is used. It is not a real credential. The fixture must be detected with non-zero exit status while logs remain redacted.

### Workflow negative fixture

An intentionally unsafe workflow must be rejected by at least the relevant workflow-security checker, with a stable security diagnostic.

### Clean workflow fixture

A minimal workflow with explicit empty permissions and no untrusted interpolation must pass both actionlint and offline zizmor.

Fixture paths are excluded from production inputs. Self-tests run only when the security gate implementation or fixtures themselves change.

## Scheduled history audit

A weekly Betterleaks full-history scan may run **report-only** initially:

- pinned tool;
- full redaction;
- no provider validation;
- exit code forced to zero after findings are emitted.

This surfaces legacy debt without silently turning unknown historical findings into a new merge blocker. New PR-introduced findings remain blocking from day one.

## Expected SDLC evidence

Before QG1 is called ACTIVE:

- controlled secret fixture is observed failing;
- controlled unsafe workflow fixture is observed failing;
- clean workflow fixture is observed passing;
- a real PR-diff scan passes with no fixture leakage into production scope;
- tool versions/checksums are visible in repository configuration;
- final source PR HEAD and actual tested checkout/merge SHA are recorded separately;
- BUILD / ARCH / SEC / PLAN checks are recorded in the PR.
