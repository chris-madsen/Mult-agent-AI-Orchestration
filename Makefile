SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c

.PHONY: help check check-tools check-config check-auth check-runtime check-runtime-deep \
	start start-gpu start-gpu-only start-safe start-gateway ensure-gateway stop-gateway

PROJECT_ROOT := $(abspath .)
MCP_FILE := .cursor/mcp.json
RUNTIME_STAMP := .consilium/.runtime-check.sig
GATEWAY_HOST ?= 127.0.0.1
GATEWAY_PORT ?= 8000
GATEWAY_PID_FILE := .consilium/gateway.pid
GATEWAY_LOG_FILE := .consilium/logs/gateway.log
CONSILIUM_AUTO_GIT_INIT ?= 1
CODEX_BIN ?= $(shell command -v codex 2>/dev/null)
ifeq ($(strip $(CODEX_BIN)),)
CODEX_BIN := $(firstword $(wildcard /home/$(USER)/.vscode-oss/extensions/openai.chatgpt-*/bin/linux-x86_64/codex))
endif
CODEX_DIR := $(patsubst %/,%,$(dir $(CODEX_BIN)))
ifneq ($(strip $(CODEX_DIR)),)
export PATH := $(CODEX_DIR):$(PATH)
endif

help:
	@echo "Targets:"
	@echo "  make check  - run all preflight checks"
	@echo "  make check-runtime-deep - force full nix devShell runtime check"
	@echo "  make start  - run checks, ensure gateway on :8000, then launch Cursor (GPU mode)"
	@echo "  make start-gpu  - launch Cursor in GPU mode"
	@echo "  make start-safe - launch Cursor with software rendering"
	@echo "  make start-gateway - launch OpenAI-compatible Consilium API gateway (foreground)"
	@echo "  make ensure-gateway - ensure gateway is running in background"
	@echo "  make stop-gateway - stop background gateway"

check: check-tools check-config check-auth check-runtime
	@echo "[ok] all preflight checks passed"

check-tools:
	@echo "[check] required CLI tools"
	@for bin in nix python3 jq gcloud; do \
		command -v $$bin >/dev/null 2>&1 || { echo "[fail] missing '$$bin' in PATH"; exit 1; }; \
	done
	@{ \
		command -v cursor >/dev/null 2>&1 || \
		compgen -G "$$HOME/.local/bin/Cursor-*-x86_64.AppImage" >/dev/null; \
	} || { \
		echo "[fail] Cursor binary not found (PATH or ~/.local/bin/Cursor-*-x86_64.AppImage)"; exit 1; }
	@test -x "$(CODEX_BIN)" || { \
		echo "[fail] missing 'codex' (set CODEX_BIN=/absolute/path/to/codex or add codex to PATH)"; exit 1; }
	@echo "[ok] codex binary: $(CODEX_BIN)"
	@echo "[ok] CLI tools present"

check-config:
	@echo "[check] local config files"
	@test -f .env || { echo "[fail] missing .env"; exit 1; }
	@grep -Eq '^\s*(export\s+)?GOOGLE_CLOUD_PROJECT\s*=\s*[^[:space:]#]+' .env || { \
		echo "[fail] GOOGLE_CLOUD_PROJECT is not set in .env"; exit 1; }
	@grep -Eq '^\s*(export\s+)?GOOGLE_CLOUD_LOCATION\s*=\s*[^[:space:]#]+' .env || { \
		echo "[fail] GOOGLE_CLOUD_LOCATION is not set in .env"; exit 1; }
	@grep -Eq '^\s*(export\s+)?CONSILIUM_API_KEY\s*=\s*[^[:space:]#]+' .env || { \
		echo "[fail] CONSILIUM_API_KEY is not set in .env"; exit 1; }
	@if grep -Eiq '^\s*(export\s+)?CONSILIUM_STRICT_API_KEY\s*=\s*(1|true|yes)\s*$$' .env; then \
		key="$$(awk -F= '/^\s*(export[[:space:]]+)?CONSILIUM_API_KEY\s*=/{gsub(/^[[:space:]]+|[[:space:]]+$$/, "", $$2); print $$2; exit}' .env)"; \
		[[ "$$key" != "consilium-mvp-key" ]] || { \
			echo "[fail] CONSILIUM_STRICT_API_KEY is enabled but CONSILIUM_API_KEY uses default value"; exit 1; }; \
	fi
	@test -f "$(MCP_FILE)" || { echo "[fail] missing $(MCP_FILE)"; exit 1; }
	@jq -e '.mcpServers.consilium' "$(MCP_FILE)" >/dev/null || { \
		echo "[fail] $(MCP_FILE): mcpServers.consilium missing"; exit 1; }
	@jq -e '.mcpServers.consilium as $$c | (($$c.command // "") | test("start-mcp\\.sh$$|mcp_server\\.py$$")) or ((($$c.args // []) | any(type == "string" and test("start-mcp\\.sh$$|mcp_server\\.py$$"))))' "$(MCP_FILE)" >/dev/null || { \
		echo "[fail] $(MCP_FILE): consilium command/args must reference start-mcp.sh or mcp_server.py"; exit 1; }
	@test -f .cursor/rules/consilium-mvp-default.mdc || { \
		echo "[fail] missing .cursor/rules/consilium-mvp-default.mdc"; exit 1; }
	@test -f .consilium/policies/model_config.yaml || { \
		echo "[fail] missing .consilium/policies/model_config.yaml"; exit 1; }
	@rg -q '^\s*adapter:\s*ralphex\s*$$' .consilium/policies/model_config.yaml || { \
		echo "[fail] execution.adapter must be 'ralphex'"; exit 1; }
	@rg -q '^\s*model:\s*gpt-5\.3-codex\s*$$' .consilium/policies/model_config.yaml || { \
		echo "[fail] roles.implementer.model must be 'gpt-5.3-codex'"; exit 1; }
	@echo "[ok] model policy is valid"
	@rg -q 'TransformMessages\(' consilium_core.py || { \
		echo "[fail] context compression is not enabled in consilium_core.py"; exit 1; }
	@rg -q '"APPROVED_NO_EXEC":\s*"approved_no_exec"' consilium_core.py || { \
		echo '[fail] consult path signal mapping is not enabled'; exit 1; }
	@rg -q 'def consilium_chat\(' mcp_server.py || { \
		echo '[fail] consilium_chat MCP tool is missing'; exit 1; }
	@echo "[ok] config is valid"

check-auth:
	@echo "[check] auth sessions"
	@"$(CODEX_BIN)" login status >/dev/null || { \
		echo "[fail] Codex CLI is not logged in. Run: codex login"; exit 1; }
	@gcloud auth application-default print-access-token >/dev/null || { \
		echo "[fail] gcloud ADC is not authenticated. Run: gcloud auth application-default login"; exit 1; }
	@echo "[ok] auth looks good"

check-runtime:
	@echo "[check] python and dev shell runtime"
	@python3 -m py_compile fsm.py consilium_core.py mcp_server.py agents/*.py
	@./scripts/start-mcp.sh --check >/dev/null
	@sig="$$(sha256sum flake.nix flake.lock requirements.txt | sha256sum | awk '{print $$1}')"; \
	if [[ -f "$(RUNTIME_STAMP)" ]] && [[ "$$(cat "$(RUNTIME_STAMP)")" == "$$sig" ]]; then \
		echo "[ok] runtime deep-check cache hit"; \
	else \
		echo "[warn] runtime deep-check is outdated; run 'make check-runtime-deep' manually if needed"; \
	fi
	@echo "[ok] runtime is ready"

check-runtime-deep:
	@sig="$${RUNTIME_SIG:-$$(sha256sum flake.nix flake.lock requirements.txt | sha256sum | awk '{print $$1}')}" ; \
	nix develop .#devShell -c bash -lc ' \
		command -v python >/dev/null && \
		command -v ralphex >/dev/null && \
		command -v q >/dev/null && \
		(command -v codex >/dev/null || test -x "$(CODEX_BIN)") && \
		ralphex --version >/dev/null \
	' ; \
	mkdir -p .consilium ; \
	printf '%s' "$$sig" > "$(RUNTIME_STAMP)" ; \
	echo "[ok] runtime deep-check stamp updated"

start: check ensure-gateway start-gpu-only

start-gpu: check start-gpu-only

start-gpu-only:
	@echo "[run] launching Cursor"
	@CURSOR_RENDER_MODE=gpu ./scripts/start-cursor-safe.sh "$(PROJECT_ROOT)"

start-safe: check
	@echo "[run] launching Cursor (safe software mode)"
	@CURSOR_RENDER_MODE=safe ./scripts/start-cursor-safe.sh "$(PROJECT_ROOT)"

start-gateway: check-runtime
	@echo "[run] launching Consilium OpenAI gateway on 127.0.0.1:8000"
	@bash -lc 'set -a; source .env; set +a; ./.venv/bin/python -c "import fastapi, uvicorn, autogen"' >/dev/null || { \
		echo "[fail] missing gateway dependencies in .venv. Run: ./.venv/bin/pip install -r requirements.txt"; exit 1; }
	@bash -lc 'set -a; source .env; set +a; ./.venv/bin/python -m uvicorn consilium_gateway:app --host "$(GATEWAY_HOST)" --port "$(GATEWAY_PORT)"'

ensure-gateway: check-runtime
	@mkdir -p .consilium/logs
	@if [[ ! -e .git ]]; then \
		if [[ "$(CONSILIUM_AUTO_GIT_INIT)" =~ ^(1|true|yes|on)$$ ]]; then \
			echo "[run] initializing git repository (required by ralphex)"; \
			git init -q; \
		else \
			echo "[fail] ralphex requires .git in project root. Run: git init"; \
			exit 1; \
		fi; \
	fi
	@if ! git rev-parse --verify HEAD >/dev/null 2>&1; then \
		if [[ "$(CONSILIUM_AUTO_GIT_INIT)" =~ ^(1|true|yes|on)$$ ]]; then \
			echo "[run] creating initial empty git commit (required by ralphex)"; \
			git config user.name >/dev/null 2>&1 || git config user.name "Consilium Local"; \
			git config user.email >/dev/null 2>&1 || git config user.email "consilium@local"; \
			git commit --allow-empty -m "chore: bootstrap ralphex gateway" >/dev/null; \
		else \
			echo "[fail] ralphex requires at least one commit. Run: git commit --allow-empty -m \"init\""; \
			exit 1; \
		fi; \
	fi
	@bash -lc 'set -a; source .env; set +a; ./.venv/bin/python -c "import fastapi, uvicorn, autogen"' >/dev/null || { \
		echo "[fail] missing gateway dependencies in .venv. Run: ./.venv/bin/pip install -r requirements.txt"; exit 1; }
	@./.venv/bin/python -c 'import socket,sys; s=socket.socket(); s.settimeout(0.3); rc=s.connect_ex(("$(GATEWAY_HOST)", int("$(GATEWAY_PORT)"))); s.close(); sys.exit(0 if rc==0 else 1)' && { \
		expected_pid=""; \
		if [[ -f "$(GATEWAY_PID_FILE)" ]]; then expected_pid="$$(cat "$(GATEWAY_PID_FILE)")"; fi; \
		listener_pid="$$(./.venv/bin/python "$(PROJECT_ROOT)/scripts/tcp_listener_pid.py" "$(GATEWAY_HOST)" "$(GATEWAY_PORT)" 2>/dev/null || true)"; \
		if [[ -n "$$listener_pid" && -n "$$expected_pid" && "$$listener_pid" != "$$expected_pid" ]]; then \
			echo "[warn] port $(GATEWAY_PORT) is owned by pid=$$listener_pid but $(GATEWAY_PID_FILE) says pid=$$expected_pid; stopping stale listener"; \
			kill "$$listener_pid" 2>/dev/null || true; \
			sleep 0.2; \
			kill -9 "$$listener_pid" 2>/dev/null || true; \
			rm -f "$(GATEWAY_PID_FILE)"; \
		elif [[ -n "$$listener_pid" && -z "$$expected_pid" ]]; then \
			echo "[warn] port $(GATEWAY_PORT) is listening (pid=$$listener_pid) but pid file is missing; adopting listener"; \
			echo "$$listener_pid" > "$(GATEWAY_PID_FILE)"; \
		fi; \
		./.venv/bin/python -c 'import socket,sys; s=socket.socket(); s.settimeout(0.3); rc=s.connect_ex(("$(GATEWAY_HOST)", int("$(GATEWAY_PORT)"))); s.close(); sys.exit(0 if rc==0 else 1)' && { \
			echo "[ok] gateway already listening on $(GATEWAY_HOST):$(GATEWAY_PORT)"; exit 0; }; \
	} || true
	@echo "[run] starting gateway in background on $(GATEWAY_HOST):$(GATEWAY_PORT)"
	@nohup bash -lc 'set -a; source .env; set +a; exec ./.venv/bin/python -m uvicorn consilium_gateway:app --host "$(GATEWAY_HOST)" --port "$(GATEWAY_PORT)"' >"$(GATEWAY_LOG_FILE)" 2>&1 & echo $$! >"$(GATEWAY_PID_FILE)"
	@for i in $$(seq 1 40); do \
		./.venv/bin/python -c 'import socket,sys; s=socket.socket(); s.settimeout(0.3); rc=s.connect_ex(("$(GATEWAY_HOST)", int("$(GATEWAY_PORT)"))); s.close(); sys.exit(0 if rc==0 else 1)' && { \
			echo "[ok] gateway is up on $(GATEWAY_HOST):$(GATEWAY_PORT)"; exit 0; }; \
		sleep 0.2; \
	done; \
	echo "[fail] gateway did not start. See $(GATEWAY_LOG_FILE)"; \
	tail -n 80 "$(GATEWAY_LOG_FILE)" || true; \
	exit 1

stop-gateway:
	@if [[ -f "$(GATEWAY_PID_FILE)" ]]; then \
		pid="$$(cat "$(GATEWAY_PID_FILE)")"; \
		if kill -0 "$$pid" 2>/dev/null; then \
			echo "[run] stopping gateway pid=$$pid"; \
			kill "$$pid" || true; \
		fi; \
		rm -f "$(GATEWAY_PID_FILE)"; \
	else \
		echo "[ok] no gateway pid file"; \
	fi
	@listener_pid="$$(./.venv/bin/python "$(PROJECT_ROOT)/scripts/tcp_listener_pid.py" "$(GATEWAY_HOST)" "$(GATEWAY_PORT)" 2>/dev/null || true)"; \
	if [[ -n "$$listener_pid" ]]; then \
		echo "[run] stopping listener on $(GATEWAY_HOST):$(GATEWAY_PORT) pid=$$listener_pid"; \
		kill "$$listener_pid" 2>/dev/null || true; \
		sleep 0.2; \
		kill -9 "$$listener_pid" 2>/dev/null || true; \
	fi
