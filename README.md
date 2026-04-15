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
| Implementer | `agents/implementer.py` | `ExecutionPort` → `RalphexAdapter` (`gpt-5.3-codex`) |
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
│   ├── architect.py     Gemini 3.1 Pro — writes .consilium/plans/
│   ├── critic.py        Gemini Flash   — writes .consilium/reviews/
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
- API-key model entries (`consilium-auto`, `ralphex-mcp`)

After this, normal chat send uses:
`Cursor -> Consilium Gateway -> Ralphex`.

Model semantics:
- Cursor model name is only a public gateway alias (`CONSILIUM_PUBLIC_MODEL`, default `consilium-auto`).
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
- Auto command mode: `CONSILIUM_RALPHEX_MODE=auto|tasks|execute|review` (default `auto`)
  - `auto`: review-like prompts -> `--review`, other prompts -> default execute mode
  - `tasks`: force `--tasks-only --max-iterations=1`
  - `review`: force `--review`
  - `execute`: force default ralphex full execute mode
- Fast connectivity probes:
  - short ping/health prompts (for example `привет, проверка связи`) are answered via a lightweight gateway probe path (`ralphex --version`) to avoid expensive full pipeline latency.
- Gateway response normalization:
  - when ralphex output looks like execution/progress logs, gateway returns a compact status summary and hides raw technical logs by default.
  - if output contains an explicit `Final answer:`/`Result:`/`Ответ:` line, that final answer is returned as the user-facing response.
- Integration health probe shortcut:
  - prompts like `интеграция живая?` or `integration alive?` can return a one-line liveness answer when execution completion/failure signals are present.
  - if logs are present but completion/failure signal is still inconclusive, gateway responds with `Статус интеграции неизвестен.`
- Hard timeout: `CONSILIUM_RALPHEX_TIMEOUT_SEC` (default `1200`)
- Idle timeout (no subprocess output): `CONSILIUM_RALPHEX_IDLE_TIMEOUT_SEC` (default `300`, `0` disables)
- Heartbeat telemetry cadence: `CONSILIUM_RALPHEX_HEARTBEAT_SEC` (default `15`)
- `running_no_output` phase threshold: `CONSILIUM_RALPHEX_IDLE_WARN_SEC` (default `45`)
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
