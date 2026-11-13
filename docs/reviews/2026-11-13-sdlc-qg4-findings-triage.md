---
title: "SDLC QG4 report-only findings triage"
date: 2026-11-13
reviewer: "Hermes Agent"
repository: "chris-madsen/Mult-agent-AI-Orchestration"
branch: "main"
source_commit: "6df583fad7d45a4cda6586632240b6f364c08a8a"
status: "static-triage-complete-owner-disposition-pending"
topics:
  - sdlc
  - knip
  - osv
---

# SDLC QG4 report-only findings triage

## Question and scope

What do the current-main Knip and OSV report-only pilots actually report, what can be safely classified from repository evidence, and what still requires owner disposition?

This is static report triage at `main@6df583fad7d45a4cda6586632240b6f364c08a8a`. No source, configuration, dependency pin, suppression, or public-contract baseline was changed. The report does not declare production readiness or claim that every reported package is reachable in a deployed runtime.

## Summary

- Knip findings reproduced locally with `npm run analyze:dependencies`: 1 unused file, 17 unused exports, 43 unused exported types, and 1 duplicate export.
- OSV workflow run `43409461876` completed on the same main SHA. Its retained artifact is `OSV Scanner SARIF file`, artifact ID `14029066502`, reported digest `sha256:16f434e22ae31c26e3c8744e8879d10a500e583f38e475084bc4d08f63193e54`.
- The SARIF contains 70 result instances and 46 unique rule IDs: 3 with `security-severity >= 9.0`, 20 in `[7.0, 9.0)`, and 23 in `[4.0, 7.0)`. Locations cover `package-lock.json`, `requirements-embedding-st.txt`, and `requirements-provider.txt`.
- Findings remain report-only. The scan output supports dependency triage, not automatic deletion, suppression, or an assertion that all flagged transitive packages are direct runtime dependencies.

## Knip findings

`knip.jsonc:4-25` analyzes `src/**/*.ts`, scripts, and tests, with an explicit entry list for executables and selected operator tools. The report still marks `src/index.ts` unused even though it reexports the modules as a broad barrel (`src/index.ts:1-53`). The package manifest is private (`package.json:2-5`) and declares no package `main` or `exports` entry. This makes the barrel a cleanup candidate, but does not prove that no external/local path consumer exists; deleting it requires an explicit public-surface decision.

The duplicate-export finding is traceable: `freezeEvaluationSuite` is assigned to `freezeEvaluationSuiteWithFingerprint` (`src/domain/evaluation.ts:141-156`), and the evaluation fingerprint adapter imports and calls the shorter alias (`src/adapters/evaluation-fingerprint.ts:3-17`). Knip reports both names because both are exported through the barrel. The evidence proves aliasing, not whether the longer name is a compatibility API.

The 17 export and 43 type findings span domain, application, adapter, script, gateway, and transport modules. Knip establishes that these are not consumed through the configured in-repository graph; it does not establish whether they are intentionally exposed contracts, dynamic entrypoints, or safe removals. No blanket suppression or mass deletion is justified by these counts. Individual findings remain owner-review candidates.

## OSV findings

The workflow is intentionally non-blocking (`.github/workflows/ace-dependency-usage.yml:31-45`, `fail-on-vuln: false`). The SARIF's CVSS-like `security-severity` values are grouped above; SARIF `level: warning` alone is not a severity classification.

Direct pins in `requirements-embedding-st.txt:1-6` include `sentence-transformers==5.1.1`, `torch==2.6.0+cpu`, and `transformers==4.57.6`. The artifact reports, among others, `CVE-2026-68770` for `sentence-transformers@5.1.1` at 9.8 and `CVE-2026-5241` for `transformers@4.57.6` at 9.6. These are scanner findings against versions directly present in the manifest; this report does not assess exploitability or patched versions.

The package-lock findings include `undici@7.29.1` (8 unique rule IDs) and `minimatch@9.0.9` (1 unique rule ID). Local `npm ls --all undici minimatch` resolves them under `@qdrant/js-client-rest@1.20.0` and `@typescript-eslint/parser@7.18.0`, respectively.

The SARIF also attributes `requests@2.9.2`, `httpx2@2.9.1`, `httpcore2@2.9.1`, and `certifi@2026.7.22` to `requirements-provider.txt`. The tracked file directly pins `graphiti-core[falkordb]==0.31.1` and `httpx==0.28.1`, but does not directly pin those reported names/versions (`requirements-provider.txt:1-6`). They may be transitive or scanner-resolved packages; the artifact has no dependency path or line annotation. Confirm their provenance before treating the reported version as a direct pin or selecting an upgrade.

The `npm ci` output separately reported nine npm audit advisories (8 moderate, 1 high). That count is a distinct audit channel and must not be added to, or treated as equivalent to, the OSV SARIF's 70 result instances.

## Disposition and remaining owner decisions

- **Knip:** preserve report-only behavior. Decide whether `src/index.ts` and unreferenced exports/types are supported public contracts before deletion; any accepted cleanup should be narrow, tested, and separately delivered.
- **OSV:** confirm the dependency paths for the `requirements-provider.txt` findings, then choose exact remediation pins and run the relevant Python, Node, and provider checks. No upgrade or exception is inferred from this triage.
- **Promotion:** keep QG4 non-blocking until an owner approves its blocking policy and findings disposition. This report is not a zero-vulnerability statement and does not close any production security gate.

## Evidence commands

- `npm run analyze:dependencies` — completed on `main@6df583f`; counts and names reproduced.
- `npm ls --all undici minimatch` — completed on `main@6df583f`; dependency paths recorded above.
- `gh run view 43409461876 --json ...` — run conclusion `success`, source SHA `6df583fad7d45a4cda6586632240b6f364c08a8a`.
- OSV artifact `14029066502` downloaded and parsed as SARIF; the workflow job completed successfully. A successful report job means scan completed, not that findings were absent.
