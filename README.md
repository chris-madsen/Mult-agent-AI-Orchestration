# Consilium MVP

Three-role autonomous dev pipeline: **Architect → Critic → Implementer (Ralphex)**.  
Connected to Cursor via MCP. Zero manual handoffs.

---

## Stack

| Layer | Tool | Model |
|---|---|---|
| Frontend | Cursor (MCP Client) | — |
| API Gateway (optional) | FastAPI OpenAI `/v1/chat/completions` | `ralphex-mcp` |
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

## Setup (Canonical MVP Flow)

```bash
# 1) Create local env
cp .env.example .env
# Edit .env and set:
# - GOOGLE_CLOUD_PROJECT
# - GOOGLE_CLOUD_LOCATION
# - CONSILIUM_API_KEY (non-default in strict mode)
# - CONSILIUM_RALPHEX_CMD (optional override)
# - CONSILIUM_RALPHEX_MODE=review (default) or execute
# - CONSILIUM_AUTO_GIT_INIT=1 (auto `git init` for ralphex compatibility)

# 2) Prepare runtime and verify
make check

# 3) Start gateway + Cursor
make start
```

```json
{
  "mcpServers": {
    "consilium": {
      "command": "python",
      "args": ["/absolute/path/to/consilium/mcp_server.py"]
    }
  }
}
```

---

## Usage from Cursor

### Primary chat path (Gateway-first)

Configure Cursor custom OpenAI provider:

- Base URL: `http://127.0.0.1:8000/v1`
- API key: value of `CONSILIUM_API_KEY`
- Model: `ralphex-mcp`

After this, normal chat send uses:
`Cursor -> Consilium Gateway -> Ralphex`.

### Structured orchestration path (MCP tools)

MCP stays enabled in parallel for structured task operations:

- `consilium_chat` for Consilium-first workspace chat tool routing
- `execute_task` for task/state/artifact-heavy workflows

Path:
`Cursor MCP -> mcp_server.py -> consilium_core.py -> ExecutionPort -> RalphexAdapter`

### Gateway operational notes

- Endpoint: `POST /v1/chat/completions` (OpenAI-compatible)
- Auth: `Authorization: Bearer <CONSILIUM_API_KEY>`
- Session: `user` field or `X-Session-Id` header
- Ralphex command: `CONSILIUM_RALPHEX_CMD` (optional explicit override)
- Auto command mode: `CONSILIUM_RALPHEX_MODE=review|execute` (default `review`)
  - review mode default command: `ralphex --review "$CONSILIUM_PLAN_FILE"` (works on dirty trees)
  - execute mode default command: `ralphex "$CONSILIUM_PLAN_FILE"` (requires clean branch workflow)
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
