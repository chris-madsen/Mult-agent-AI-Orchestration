# Consilium MVP

Three-role autonomous dev pipeline: **Architect → Critic → Implementer (Ralphex)**.  
Connected to Cursor via MCP. Zero manual handoffs.

---

## Stack

| Layer | Tool | Model |
|---|---|---|
| Frontend | Cursor (MCP Client) | — |
| API Gateway (optional) | FastAPI OpenAI `/v1/chat/completions` | `consilium-auto` (public alias) |
| Orchestrator | AutoGen GroupChat + FSM | — |
| Architect | `agents/architect.py` | Configured in `.consilium/policies/model_config.yaml` |
| Critic | `agents/critic.py` | Configured in `.consilium/policies/model_config.yaml` |
| Implementer | `agents/implementer.py` | Configured in `.consilium/policies/model_config.yaml` |
| Context compression | `TransformMessages` | — |

---

## Project structure

```
consilium/
├── fsm.py               FSM engine (dispatch table, no if-elif)
├── consilium_core.py    AutoGen GroupChat orchestration
├── mcp_server.py        FastMCP entry point for Cursor
├── consilium_gateway.py OpenAI-compatible gateway (Cursor API-key route)
├── model_config.py      Runtime role-model policy loader
├── execution_port.py    Execution engine interface + Ralphex adapter
├── agents/
│   ├── architect.py     Policy-driven role model (see .consilium/policies/model_config.yaml)
│   ├── critic.py        Policy-driven role model (see .consilium/policies/model_config.yaml)
│   └── implementer.py   ExecutionPort-backed implementer
├── requirements.txt
└── .consilium/          Runtime state (mostly gitignored)
    ├── policies/        model_config.yaml (role→model + adapter)
    ├── plans/           TASK-*.md plans from Architect
    ├── reviews/         TASK-*.md reviews from Critic
    ├── state/           TASK-*.json FSM checkpoints
    ├── runs/            Ralphex/Codex stdout/stderr/metrics per iteration
    └── decisions/       ADR-*.md  (manual, committed to git)
```

---

## FSM

```
INTAKE ──task_received──▶ PROPOSAL (Architect)
                               │
                          plan_ready
                               │
                               ▼
                           REVIEW (Critic)
                          ╱         ╲
                    approved       rejected
                       │               │
                       ▼               ▼
                  IMPLEMENT       PROPOSAL (retry)
                 (Ralphex)
                ╱         ╲
         impl_complete   impl_failed
               │               │
               ▼               ▼
             DONE          INVESTIGATE (Critic)
                          ╱     │      ╲
                  needs_rework  │  unresolvable
                       │    minor_fix      │
                       ▼       │           ▼
                   PROPOSAL    │        ROLLBACK
                               ▼
                           IMPLEMENT (retry)
```

---

## Setup (One-command start)

Required local tools for full gateway runtime: `python3`, `jq`, `gcloud`, `curl`.

```bash
# Single entrypoint:
# - bootstraps .env (and generates CONSILIUM_API_KEY if placeholder/default)
# - runs local checks
# - ensures gateway is running on 127.0.0.1:8000
# - writes Cursor provider values to .consilium/cursor-provider.txt
# - syncs Cursor local state DB (base URL, API key, API-key model list)
# - launches Cursor
make start
```

MCP config is already committed in `.cursor/mcp.json` and points to `scripts/start-mcp.sh`.

Before trusting chat runtime after changes, run:

```bash
make smoke-chat-runtime
make verify-runtime
```

This checks the same local gateway path (`/v1/responses`) and fails on unstable markers like `ralphex stalled` or missing `Final answer`.
`make verify-runtime` additionally prints runtime fingerprint (branch, commit, binary paths/versions, key timeout flags) before smoke.
If gateway is deployed as systemd unit, use `make ensure-gateway-managed` (or `USE_SYSTEMD_GATEWAY=1`) to skip local gateway restarts.

---

## Usage from Cursor

### Primary chat path (Gateway-first)

Configure Cursor custom OpenAI provider once (manual UI step):

- Base URL: `http://127.0.0.1:8000/v1`
- API key: value of `CONSILIUM_API_KEY`
- Model: `consilium-auto`

`make start` writes these exact values to:
`.consilium/cursor-provider.txt`

`make start` also syncs Cursor local state DB automatically:
- `openAIBaseUrl`
- `cursorAuth/openAIKey`
- API-key model entries (`consilium-auto`, `gpt-5.3-codex`, `ralphex-mcp`)

After this, normal chat send uses:
`Cursor -> Consilium Gateway -> Ralphex`.

Model semantics:
- Cursor model name is only a public gateway alias (`CONSILIUM_PUBLIC_MODEL`, default `consilium-auto`).
- Additional UI-safe aliases can be exposed via `CONSILIUM_PUBLIC_MODEL_ALIASES` (default includes `gpt-5.3-codex`).
- If Cursor sends a known alias, gateway echoes the same alias in response `model` field (prevents UI fallback/repaint glitches).
- Internal Consilium model routing remains dynamic; Cursor does not control or pin internal role models.

### Structured orchestration path (MCP tools)

MCP stays enabled in parallel for structured task operations:

- `consilium_chat` for Consilium-first workspace chat tool routing
- `execute_task` for task/state/artifact-heavy workflows

Path:
`Cursor MCP -> mcp_server.py -> consilium_core.py -> ExecutionPort -> RalphexAdapter`

### Gateway operational notes

- Endpoint: `POST /v1/chat/completions` (OpenAI-compatible)
- Models API: `GET /v1/models`, `GET /v1/models/{id}` (for Cursor model discovery)
- Health/ops: `GET /healthz` (includes active transport runs, phase, elapsed/idle seconds)
- Auth: `Authorization: Bearer <CONSILIUM_API_KEY>` or `X-API-Key: <CONSILIUM_API_KEY>` for chat; model discovery may be called without auth (optional auth still accepted)
- Session: `user` field or `X-Session-Id` header
- Ralphex command: `CONSILIUM_RALPHEX_CMD` (optional explicit override)
- Request profile routing:
  - Codex `Plan` mode: gateway runs Ralphex in `--tasks-only` profile with architect model and `CONSILIUM_RALPHEX_PLAN_MAX_ITERATIONS` (default `2`).
  - non-Plan coding mode: gateway runs standard Ralphex execute pipeline with `CONSILIUM_RALPHEX_STANDARD_MAX_ITERATIONS` (default `24`).
  - non-Plan non-coding mode: gateway runs chat tasks profile with `CONSILIUM_RALPHEX_CHAT_MAX_ITERATIONS` (default `1`).
  - repo-read chat mode (e.g. "show working directory/files"): gateway uses `CONSILIUM_RALPHEX_REPO_READ_MAX_ITERATIONS` (default `2`).
  - primary and fallback routes stay on Ralphex by default (`CONSILIUM_GATEWAY_STRICT_RALPHEX_ONLY=1`).
  - role-level fallback is handled inside Ralphex wrappers (Codex rate-limit -> Vertex Gemini) without bypassing orchestration.
  - Vertex chat-shortcut is applied only for pure Q/A chat mode; repo-read/coding plans keep full tool/file execution path.
  - Gateway chat-specific prompts are used only for non-coding chat/repo-read requests; coding requests keep base execution prompts.
  - chat plan auto-includes incremental repository context using git-based delta (changed files + diff excerpt), so model context can stay incremental.
- Gateway response normalization:
  - if output contains an explicit `Final answer:`/`Result:`/`Ответ:` line, that final answer is returned as the user-facing response.
  - when ralphex output looks like execution/progress logs and no final answer was produced, gateway returns status + compact raw trace by default.
  - trace visibility can be toggled via `CONSILIUM_GATEWAY_EXPOSE_PROGRESS_TRACE` (`1` by default).
  - optional success-trace mode appends compact trace even with `Final answer:`: `CONSILIUM_GATEWAY_EXPOSE_PROGRESS_TRACE_SUCCESS` (default `1`).
  - trace truncation limits: `CONSILIUM_GATEWAY_PROGRESS_TRACE_MAX_LINES`, `CONSILIUM_GATEWAY_PROGRESS_TRACE_MAX_CHARS`.
- Hard timeout: `CONSILIUM_RALPHEX_TIMEOUT_SEC` (default `1200`)
- Idle timeout (no subprocess output): `CONSILIUM_RALPHEX_IDLE_TIMEOUT_SEC` (default `300`, `0` disables)
- Plan/chat tasks session timeout: `CONSILIUM_RALPHEX_CHAT_SESSION_TIMEOUT_SEC` (default `60`)
- Plan/chat tasks idle timeout: `CONSILIUM_RALPHEX_CHAT_IDLE_TIMEOUT_SEC` (default `30`)
- Chat tasks max iterations: `CONSILIUM_RALPHEX_CHAT_MAX_ITERATIONS` (default `1`)
- Repo-read chat max iterations: `CONSILIUM_RALPHEX_REPO_READ_MAX_ITERATIONS` (default `2`)
- Execute-profile idle timeout override: `CONSILIUM_RALPHEX_EXECUTE_IDLE_TIMEOUT_SEC` (default `900`)
- Heartbeat telemetry cadence: `CONSILIUM_RALPHEX_HEARTBEAT_SEC` (default `15`)
- `running_no_output` phase threshold: `CONSILIUM_RALPHEX_IDLE_WARN_SEC` (default `45`)
- Preflight cleanup threshold for stale `running_no_output`: `CONSILIUM_RALPHEX_NO_OUTPUT_STALE_MAX_SEC` (default `45`)
- Git mutation guard in gateway chat runtime: `CONSILIUM_GATEWAY_BLOCK_GIT_COMMITS` (default `1`)
- Emergency direct-codex fallback: `CONSILIUM_GATEWAY_ENABLE_DIRECT_CODEX_FALLBACK` (default `0`, disabled)
- Limit fallback to Gemini when Codex path hits quota/rate limits:
  - `CONSILIUM_GATEWAY_ENABLE_LIMIT_FALLBACK_TO_GEMINI` (default `1`, enabled)
  - `CONSILIUM_GATEWAY_LIMIT_FALLBACK_MODEL` (default `gemini-2.5-pro`)
  - `CONSILIUM_GATEWAY_LIMIT_FALLBACK_ROUTE` (`ralphex` by default)
  - `CONSILIUM_GATEWAY_STRICT_RALPHEX_ONLY` (default `1`): blocks direct model bypass in gateway fallback path.
  - `CONSILIUM_GATEWAY_LIMIT_FALLBACK_ALLOW_DIRECT_RECOVERY` (default `0`): optional emergency escape hatch when strict mode is disabled.
  - `CONSILIUM_GATEWAY_LIMIT_FALLBACK_CHAT_SESSION_TIMEOUT_SEC` (default `90`) and `CONSILIUM_GATEWAY_LIMIT_FALLBACK_CHAT_IDLE_TIMEOUT_SEC` (default `60`) tune the ralphex fallback envelope for slower Gemini first-token latency.
- Strict API key mode: set `CONSILIUM_STRICT_API_KEY=1` to fail startup when default key is used
- If `CONSILIUM_RALPHEX_CMD` is not set, gateway auto-detects `ralphex` from:
  - `PATH`
  - `~/.nix-profile/bin/ralphex`
  - `/etc/profiles/per-user/$USER/bin/ralphex`
  - `/run/current-system/sw/bin/ralphex`
  - `/nix/store/*-ralphex-*/bin/ralphex`
- Gateway now fails fast on startup if no `ralphex` command is resolvable (instead of failing on first chat request).
- Gateway fails fast if `CONSILIUM_RALPHEX_CMD` still uses unsupported `--task` flag on modern ralphex.
- `ralphex` requires repository root with at least one commit; `make ensure-gateway` can auto-run `git init` and create an empty bootstrap commit when needed.
- `make stop-gateway` now force-cleans active/stale gateway-owned `ralphex/codex` subprocesses.

---

## Evolving toward the full Consilium

| Version | What to add | Where |
|---|---|---|
| v0.2 | `Security` agent | new `agents/security.py` + 2 lines in `FSM_TABLE` |
| v0.3 | `Production Realist` agent | same pattern |
| v0.4 | Mem0 memory layer | wrap `consilium_core.run_task` |
| v0.5 | OPA policy guards | call `opa eval` inside `Transition.guard` |
| v1.0 | Full ADR ledger + BFT quorum | `decisions/` becomes append-only chain |

Cursor and Ralphex never need to know about any of these additions.
