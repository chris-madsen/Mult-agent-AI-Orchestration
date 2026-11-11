# ACE security gates

ACE pull requests use pinned local security tools from `.github/workflows/ace-security.yml`.

## Active PR gates

### Betterleaks — new secret detection

- version: Betterleaks `v1.10.0`;
- installation: verified Linux x64 release archive from `scripts/install-security-tools.sh`;
- input: PR base→head Git commit range via `betterleaks git --log-opts`;
- only the exact `.github/fixtures/security/fake-secret.txt` file is excluded from production input; both PR and scheduled jobs verify its reviewed SHA-256, and adjacent files remain scannable;
- output uses full `--redact`;
- credential validation, analysis and revocation are not enabled;
- a detected new secret is blocking.

The fixture self-test creates a temporary Git repository and verifies both a clean range and a secret-introducing range using the same `betterleaks git --log-opts` interface as production. It also verifies that the synthetic secret is absent from scanner output. Stable Betterleaks v1.10.0 is intentionally invoked through its Git-range interface; ACE does not rely on the newer `stdin --git-diff` flag.

### actionlint — workflow correctness

For changed `.github/workflows/*.yml|yaml` files, actionlint `v1.7.12` checks workflow syntax, expressions and action inputs. Git paths are collected with NUL delimiters so Unicode workflow filenames cannot bypass this selection; ambiguous newline-containing or symlinked workflow paths fail closed.

### zizmor — workflow security

For changed workflows, zizmor `v1.32.0` runs in explicit `--offline` mode with the regular persona. It checks local workflow security properties without a GitHub API token.

The controlled unsafe fixture must produce both `dangerous-triggers` and `template-injection`; the clean fixture must pass actionlint and zizmor.

## Tool pinning

The installer downloads only explicit release artifact URLs and verifies fixed SHA-256 digests before extraction. Binaries are installed under `$RUNNER_TEMP`; nothing downloaded is committed to the repository.

Do not replace these pins with `latest`, unpinned package-manager installation or mutable container tags.

## Scheduled history scan

A weekly/manual Betterleaks history audit is initially **report-only for findings** by using `--exit-code=0`. Tool/install/runtime errors can still fail the job. Only the reviewed synthetic fixture file is excluded from the full-history Git scope so the intentionally fake secret cannot create permanent scheduled noise.

This deliberately separates:

- **new PR-introduced secret:** blocking;
- **unknown legacy history:** visible but not silently promoted to merge-blocking debt.

Provider validation remains disabled in the scheduled audit.

## Controlled fixtures

- `.github/fixtures/security/fake-secret.txt` — harmless deterministic secret-shaped input; must be detected and redacted;
- `.github/fixtures/security/unsafe-workflow.yml` — intentionally insecure workflow; must fail actionlint/zizmor self-tests;
- `.github/fixtures/security/safe-workflow.yml` — clean local workflow; must pass both tools.

Fixture self-tests run when the security workflow, installer or fixture directory changes. Only the exact synthetic-token fixture is excluded from secret scans; the other fixture files are not blanket-excluded. A dedicated history-scope self-test proves the reviewed fixture is excluded while an unreviewed adjacent synthetic secret is detected and redacted.

## Evidence boundaries

A green PR security workflow proves only the configured local/static checks for that source revision. It does not prove that historical secrets are absent, that online-only zizmor audits passed, or that external credentials were validated.
