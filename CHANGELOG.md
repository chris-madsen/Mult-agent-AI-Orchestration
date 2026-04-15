# CHANGELOG

All notable changes and delivery notes for Consilium MVP are documented here.

## [0.1.9-ralphex-tempdir-permission-fix] - 2026-04-15

### Done
- Fixed `here-document` temp file permission failures in Cursor-triggered Ralphex runs:
  - Gateway transport now forces local writable temp env:
    - `TMPDIR=.consilium/tmp`
    - `TMP=.consilium/tmp`
    - `TEMP=.consilium/tmp`
  - `ExecutionPort` path uses the same temp-dir override for non-gateway runs.
  - `.consilium/tmp` is auto-created with restricted permissions.

## [0.1.8-cursor-state-db-provider-sync] - 2026-04-15

### Done
- Added direct Cursor local state sync for OpenAI provider wiring:
  - New script: `scripts/sync-cursor-provider-state.py`.
  - Updates Cursor global storage DB (`~/.config/Cursor/User/globalStorage/state.vscdb`) to set:
    - `openAIBaseUrl`
    - `cursorAuth/openAIKey`
    - `availableAPIKeyModels`
    - `aiSettings.userAddedModels`
    - `aiSettings.modelOverrideEnabled`
- Added `make cursor-provider-sync` target and included it into:
  - `make start`
  - `make start-gpu`
  - `make start-safe`
- This removes manual model addition in Cursor UI for Consilium aliases.
- Improved OpenAI compatibility for model discovery:
  - `GET /v1/models` and `GET /v1/models/{id}` now allow unauthenticated discovery (or `x-api-key`) to match Cursor behavior.
  - `/v1/chat/completions` now accepts `x-api-key` in addition to `Authorization: Bearer`.
- Extended Cursor DB sync with explicit model cards and defaults:
  - Injects Consilium model cards into `availableDefaultModels2` (`consilium-auto`, `ralphex-mcp`).
  - Forces Cursor model defaults (`aiSettings.modelConfig.*` and `featureModelConfigs.*.defaultModel`) to `consilium-auto`.

## [0.1.7-public-model-alias-and-dynamic-routing] - 2026-04-15

### Done
- Switched Cursor-facing model contract to public alias:
  - New default public alias: `consilium-auto` (`CONSILIUM_PUBLIC_MODEL`).
  - Gateway model discovery (`/v1/models`) now returns public alias + legacy `ralphex-mcp` for compatibility.
- Clarified dynamic routing boundary:
  - Cursor `model` field is now treated as a hint only.
  - Chat completion responses always return the public alias model id.
  - Internal Consilium role routing remains dynamic and independent from Cursor model selection.
- Updated local bootstrap and provider hint output:
  - `scripts/bootstrap-local-config.sh` now ensures `CONSILIUM_PUBLIC_MODEL`.
  - `make cursor-provider-hint` now writes `Model: consilium-auto`.
- Added regression tests:
  - model list excludes internal implementation model ids.
  - chat completion response model always maps to public alias.

## [0.1.6-one-command-start-and-config-bootstrap] - 2026-04-15

### Done
- Added single-command startup flow:
  - `make start` now runs deterministic sequence:
    - `check-lite` (local checks, auth checks skipped)
    - `ensure-gateway`
    - `cursor-provider-hint`
    - `start-gpu-only`
  - `make start-gpu` and `make start-safe` now use the same preflight/bootstrap path.
- Added local config bootstrap automation:
  - New script: `scripts/bootstrap-local-config.sh`.
  - Auto-creates `.env` from `.env.example` when missing.
  - Auto-generates strong `CONSILIUM_API_KEY` when value is empty/default/placeholder.
  - Auto-fills missing defaults for core gateway vars (strict key mode, timeouts, auto git init, mode).
  - Tries to auto-fill `GOOGLE_CLOUD_PROJECT` from `gcloud config get-value project`.
- Added Cursor provider handoff file:
  - New Make target: `make cursor-provider-hint`.
  - Writes exact provider values to `.consilium/cursor-provider.txt` (gitignored, chmod 600).
- Added OpenAI model discovery endpoints in gateway:
  - `GET /v1/models`
  - `GET /v1/models/{id}`
  - fixes Cursor "No models available" for custom OpenAI routing.
- Updated docs/templates:
  - `README.md` setup now documents one-command flow via `make start`.
  - `.env.example` now explicitly states which values are auto-filled by bootstrap.

## [0.1.5-chat-latency-fix-auto-mode] - 2026-04-15

### Done
- Fixed root cause of long latency for trivial chat prompts:
  - Gateway now supports `CONSILIUM_RALPHEX_MODE=auto|tasks|execute|review`.
  - New default mode is `auto` (instead of forced `review`).
  - In `auto`, explicit review intents route to `--review`; other prompts route to execute mode.
  - Added fast gateway probe path for short connectivity prompts (`ping`/`проверка связи`) so health checks return immediately without full ralphex loop.
- Added chat-fast timeout controls for ralphex task mode:
  - `CONSILIUM_RALPHEX_CHAT_SESSION_TIMEOUT_SEC` (default `180`)
  - `CONSILIUM_RALPHEX_CHAT_IDLE_TIMEOUT_SEC` (default `120`)
- Fixed plan generation for gateway requests:
  - Gateway now writes a structured task plan (`Overview/Context/Task/Success criteria`) with actionable checkboxes instead of plain conversation dump.
  - This aligns with `ralphex` task prompt contract and avoids expensive review loops on non-review chat prompts.
- Updated docs/examples:
  - `.env.example` now defaults to `CONSILIUM_RALPHEX_MODE=auto`.
  - `README.md` updated with mode semantics.

## [0.1.4-gateway-stall-visibility-and-process-cleanup] - 2026-04-15

### Done
- Added explicit "thinking vs stuck" runtime telemetry for gateway transport:
  - Gateway now tracks each active request with `request_id/session_id/pid/pgid/phase/elapsed/idle/stdout/stderr`.
  - Added periodic heartbeat logs during long-running Ralphex/Codex execution.
  - Added active execution snapshot to `GET /healthz`.
- Added stall detection and controlled termination:
  - New `CONSILIUM_RALPHEX_IDLE_TIMEOUT_SEC` (default `300`) terminates a run when no subprocess output is seen for too long.
  - Existing hard timeout remains (`CONSILIUM_RALPHEX_TIMEOUT_SEC`, default `1200`).
  - Added `CONSILIUM_RALPHEX_IDLE_WARN_SEC` (default `45`) to switch phase to `running_no_output` before hard stall.
  - Added `CONSILIUM_RALPHEX_HEARTBEAT_SEC` (default `15`) for consistent operational heartbeat.
- Added process-group lifecycle control:
  - Transport now runs each invocation in a dedicated process group and can terminate the entire tree (`ralphex` + wrappers + `codex`) on timeout/stall.
  - Active process metadata persisted in `.consilium/gateway/active/*.json`.
- Hardened shutdown cleanup:
  - `make stop-gateway` now kills active transport process groups recorded in `.consilium/gateway/active`.
  - Added legacy orphan cleanup fallback for old runs that predate active-run tracking.
- Updated docs/config templates:
  - Updated `.env.example` with new timeout/heartbeat variables.
  - Updated `README.md` gateway operational notes (`/healthz`, timeout knobs, cleanup behavior).

## [0.1.3-cursor-gpu-default-and-openai-gateway] - 2026-04-15

### Done
- Restored GPU as the default launch mode:
  - `make start` now routes to `start-gpu` again.
  - `make start-safe` remains available for fallback software rendering.
- Fixed startup orchestration for API-key mode:
  - `make start` now does full sequence: `check -> ensure-gateway (:8000) -> Cursor GPU launch`.
  - Added `ensure-gateway` target (background launch + readiness probe on port).
  - Added `stop-gateway` target (graceful stop via pid file).
- Added OpenAI-compatible Consilium API gateway for API-key routing:
  - New file `consilium_gateway.py` with endpoint:
    - `POST /v1/chat/completions`
    - `GET /healthz`
  - Implemented Bearer auth (`CONSILIUM_API_KEY`, default `consilium-mvp-key`).
  - Implemented per-session history cache (`user` or `X-Session-Id`).
  - Implemented OpenAI JSON and SSE (`stream=true`) response formats.
- Added AutoGen pipe layer (MVP transport role):
  - Added `RalphexProxyAgent` (single-purpose proxy agent).
  - Added `AutoGenPipe` with single-agent GroupChat routing to Ralphex transport.
- Added Ralphex subprocess transport for gateway:
  - Configurable via `CONSILIUM_RALPHEX_CMD`.
  - Gateway writes conversation context to `CONSILIUM_PLAN_FILE` and runs ralphex in native plan-file mode.
  - Added `CONSILIUM_RALPHEX_MODE` (`review|execute`, default `review`) for auto command selection.
  - Default auto mode is now `review` to avoid branch-creation failures on dirty worktrees.
  - Task payload is also exposed as `CONSILIUM_TASK_JSON` for custom command overrides.
  - Added automatic binary discovery for non-dev-shell setups:
    - `PATH`
    - `~/.nix-profile/bin/ralphex`
    - `/etc/profiles/per-user/$USER/bin/ralphex`
    - `/run/current-system/sw/bin/ralphex`
    - `/nix/store/*-ralphex-*/bin/ralphex`
  - Added fail-fast startup guard: gateway now exits immediately if `ralphex` cannot be resolved, instead of returning first-request HTTP 500.
  - Added fail-fast startup guard for legacy override: gateway rejects unsupported `--task` flag in `CONSILIUM_RALPHEX_CMD`.
- Added ralphex repository precondition handling:
  - `make ensure-gateway` now auto-runs `git init` when `.git` is missing (controlled by `CONSILIUM_AUTO_GIT_INIT`, default enabled).
  - `make ensure-gateway` now also auto-creates an empty initial commit when repo has no commits.
- Added startup target for gateway:
  - `make start-gateway` launches `uvicorn consilium_gateway:app` on `127.0.0.1:8000`.
- Updated docs:
  - `README.md` now includes API-key routing setup for Cursor custom OpenAI provider.
- Updated dependencies:
  - Added `fastapi` and `uvicorn` to `requirements.txt`.

### Remaining / Next
- Add strict OpenAI compatibility details if Cursor requires them:
  - `model list` endpoint (`GET /v1/models`)
  - optional `tool_calls`/function-calling passthrough
  - token usage accounting.
- Add gateway integration smoke tests (auth, session continuity, streaming format, ralphex failure mapping).
- Add optional persistent session store (sqlite/redis) if process restarts must preserve history.

## [0.1.2-consilium-first-runtime-fix] - 2026-04-14

### Done
- Implemented missing Stage-1 runtime files that were referenced but absent:
  - `model_config.py`
  - `execution_port.py`
  - `.consilium/policies/model_config.yaml`
- Refactored role/model wiring to runtime policy:
  - `agents/architect.py` now reads role model from `model_config.py`.
  - `agents/critic.py` now reads role model from `model_config.py`.
  - `agents/implementer.py` now executes through `ExecutionPort` adapter selection.
- Completed consult-path orchestration for non-coding chat:
  - Added `APPROVED_NO_EXEC -> approved_no_exec` signal mapping in `consilium_core.py`.
  - Added mode inference (`CONSULT` vs `EXECUTE`) and explicit `CONSILIUM_MODE` propagation.
  - `run_task` now returns structured payload including assistant response and artifacts.
- Added Consilium-first MCP chat entrypoint:
  - Added `consilium_chat` tool in `mcp_server.py` for seamless workspace chat routing.
- Enforced workspace behavior via project rule:
  - Added `.cursor/rules/consilium-mvp-default.mdc` (`alwaysApply: true`) requiring MCP-first path.
- Updated runtime checks:
  - `Makefile` now validates model policy, consult signal mapping, and `consilium_chat` availability.
- Updated docs:
  - `README.md` now reflects ExecutionPort + policy-based model binding + Consilium-first routing.

## [0.1.1-consilium-first-routing-plan] - 2026-04-14

### Done
- Defined and approved a concrete **Consilium-First Global Routing Plan** for seamless chat usage.
- Updated workspace rule policy to enforce MCP-first routing for all workspace chat requests:
  - `.cursor/rules/consilium-mvp-default.mdc` now requires `consilium.execute_task` as the first path.
  - Rule explicitly allows fallback only when MCP is unavailable or times out.
  - Rule content remains fully in English.
- Aligned Stage 1 runtime foundations with `consilium-design.md`:
  - Added role model configuration loader (`model_config.py`).
  - Added execution abstraction (`execution_port.py`) with `RalphexAdapter` default path.
  - Externalized role and execution settings to `.consilium/policies/model_config.yaml`.
  - Wired Architect/Critic/Implementer model selection through role config.
  - Updated preflight checks in `Makefile` to validate `model_config.yaml` and `execution.adapter: ralphex`.
- Verified integration startup path:
  - `make check` passed (including deep runtime validation).
  - `make start` passed and launched Cursor through project startup script.

### Plan: What still needs to be done for seamless integration
- Runtime contract normalization for broad chat intents:
  - Ensure `consilium.execute_task` cleanly handles architecture, planning, diagnostics, and non-code technical prompts through the same pipeline.
  - Add lightweight intent handling so responses remain consistent even when no code execution is required.
- Validation of routing behavior in normal chat UX:
  - Confirm that typical chat prompts are routed through Consilium without manual tool commands.
  - Confirm emergency fallback behavior is explicit and not silent.
  - Confirm generated artifacts and task states are coherent for mixed prompt types.
- Hard guarantee path (Cursor-level enforcement):
  - Patch Cursor chat routing in a fork to enforce MCP-first dispatch before default model inference.
  - Add a runtime config gate (for example `consiliumFirst=true`) controlling strict MCP-first behavior.
  - Build and run patched Cursor binary for this workspace.
  - Document reproducible build/run steps and maintenance notes for upgrades.

### Notes
- Per user request, implementation is paused at planning-and-tracking level for the remaining seamless-integration tasks.

## [0.1.0-mvp-bootstrap] - 2026-04-12

### Done
- Bootstrapped a reproducible dev environment with Nix Flakes:
  - Added `flake.nix` as the single source of truth for the toolchain.
  - Generated and pinned `flake.lock`.
  - Added `devShell` with:
    - Python 3.11 (`python311`)
    - `google-cloud-sdk`
    - Pinned AWS Q Developer CLI package (`aws-q-cli`) from an official versioned artifact
    - Pinned `ralphex` binary package
- Implemented idempotent shell bootstrap behavior:
  - Auto-creates `.venv` on first `nix develop`.
  - Installs `requirements.txt` only when the file hash changes.
  - Auto-activates `.venv`.
  - Prints a compact tool version status line on shell entry.
- Added environment and config files:
  - `.envrc` (`use flake`)
  - `.env.example` (template for `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION`)
  - `.cursor/mcp.json` with absolute paths and MCP startup via `nix develop`
  - `$HOME/.config/ralphex/config.yaml` with Nix sandbox configuration
- Created runtime directories:
  - `.consilium/plans`
  - `.consilium/reviews`
  - `.consilium/state`
  - `.consilium/runs`
  - `.consilium/decisions`
- Integrated dynamic GCP project wiring in code (no hardcoded placeholder):
  - Added `agents/env_config.py` for `.env` and environment variable loading.
  - Updated `agents/architect.py` and `agents/critic.py` to read `GOOGLE_CLOUD_PROJECT`.
  - Kept explicit TODO guidance for missing project configuration.
- Fixed Python dependency compatibility:
  - Constrained `pyautogen` to `<0.3.0` to preserve `import autogen` compatibility with current code.
- Verification completed:
  - `nix develop` succeeds.
  - `python3 --version` returns 3.11.x.
  - `ralphex --help`, `gcloud --version`, `q --version` exit with code 0.
  - `.venv/bin/python3 -c "import autogen, mcp; from google.cloud import aiplatform"` exits with code 0.
  - `.cursor/mcp.json` is valid JSON.
  - `~/.config/ralphex/config.yaml` exists.

### In Progress / Next
- End-to-end live run from Cursor MCP:
  - Validate `execute_task` full path: Cursor -> MCP -> GroupChat -> Ralphex.
- Vertex model/runtime hardening:
  - Confirm final production model IDs and region policy for Architect/Critic.
  - Add fail-fast startup validation when `GOOGLE_CLOUD_PROJECT` is missing.
- Implementer hardening:
  - Add richer run metrics (duration, retries, diagnostics).
  - Add return code classification (`infra/auth/tooling/logic`).
- FSM and orchestration hardening:
  - Add retry ceilings and loop detection guards.
  - Persist deterministic stop reasons in `.consilium/state`.
- Testing:
  - Add smoke tests for config loading and signal parsing.
  - Add an integration test for FSM transitions with mocked agents.
- Security and secrets hygiene:
  - Ensure local secret files (for example `.env`) are covered by VCS policy.
  - Verify least-privilege settings for cloud profiles used by agents.

### Notes: Difficulties Encountered
- Nix license gating:
  - AWS Q package is unfree and required explicit `allowUnfreePredicate`.
- Binary packaging friction:
  - GNU AWS Q build needed extra runtime libraries and longer builds.
  - Switched to a pinned official MUSL artifact for better reproducibility.
- Dependency drift:
  - Newer `pyautogen` releases changed API surface and broke `import autogen`.
  - Required explicit version constraints.
- Native runtime linking:
  - `grpc` from `google-cloud-aiplatform` required `libstdc++.so.6`; fixed via RPATH patch in shell bootstrap.

### Expected Future Difficulties
- Upstream model naming/version changes and deprecations in Gemini lineups.
- Auth context mismatch between interactive CLI sessions and non-interactive subprocesses.
- Context growth and quality degradation on long-running tasks.
- Potential multi-agent loops on ambiguous signals.
- Environment drift between workstation and CI/runtime hosts without continuous verification.

### Architectural Ideas for Mitigation
- Add a dedicated `Supervisor` guardrail layer:
  - Iteration/time/cost budget control
  - Loop detection
  - Automatic rollback/escalation policy
- Introduce a model/provider adapter layer:
  - Central mapping of logical role -> concrete model/provider
  - Fast fallback policy when primary model/tooling fails
- Strengthen canonical task artifacts:
  - Structured decision log per iteration
  - Invariant checks before every FSM transition
- Add baseline observability:
  - Structured logs with shared run/task IDs
  - Basic failure taxonomy and operational reporting
- Add deterministic verification stage:
  - Mandatory pre/post checks before `DONE`
  - Explicit evidence bundle as part of final output
