SHELL := bash
.DEFAULT_GOAL := help
EMBEDDING_PYTHON ?= $(shell command -v python3.13 || command -v python3)

.PHONY: help install install-python-providers install-embedding-providers check lint lint-ts lint-rust probe-providers qdrant-up verify build test report-harbor-retrieval clean

help: ## Show available commands
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "%-12s %s\n", $$1, $$2}'

install: ## Install pinned dependencies
	npm ci

install-python-providers: ## Install pinned Graphiti/AST/LSP provider runtime
	uv venv .venv-system --python /usr/bin/python3
	uv pip install --python .venv-system/bin/python -r requirements-provider.txt

install-embedding-providers: ## Install the two isolated pinned embedding runtimes
	uv venv --clear .venv-embedding-fast --python $(EMBEDDING_PYTHON)
	uv pip install --python .venv-embedding-fast/bin/python -r requirements-embedding-fast.txt
	uv venv --clear .venv-embedding-st --python $(EMBEDDING_PYTHON)
	uv pip install --python .venv-embedding-st/bin/python --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple --index-strategy unsafe-best-match -r requirements-embedding-st.txt

check: ## Type-check the foundation
	npm run check

lint: lint-ts lint-rust ## Run TypeScript and Rust linters

verify: lint check test build ## Run the complete local quality gate

lint-ts: ## Run Airbnb TypeScript linting
	npm run lint

lint-rust: ## Run rustfmt and Clippy when a Rust crate is present
	@if test -f rust/Cargo.toml; then \
		cargo fmt --manifest-path rust/Cargo.toml --all -- --check; \
		cargo clippy --manifest-path rust/Cargo.toml --all-targets --all-features -- -D warnings; \
	else \
		echo 'No Rust crate is present; rustfmt and Clippy are configured for future benchmark-gated Rust components.'; \
	fi

probe-providers: ## Run the read-only external capability probe
	npm run probe:providers

report-harbor-paired: ## Render the verified native-vs-ACE Harbor paired report
	npm run report:harbor-paired

report-harbor-retrieval: ## Render the production retrieval native-vs-ACE report
	npm run report:harbor-retrieval

qdrant-up: ## Start the local Qdrant container without exposing it beyond localhost
	@if docker ps --format '{{.Names}}' | grep -qx 'ace-qdrant'; then \
		echo 'ace-qdrant is already running'; \
	elif docker ps -a --format '{{.Names}}' | grep -qx 'ace-qdrant'; then \
		docker start ace-qdrant; \
	else \
		docker pull qdrant/qdrant:v1.19.2; \
		docker run -d --name ace-qdrant -p 127.0.0.1:6333:6333 -p 127.0.0.1:6334:6334 -v "$${HOME}/.local/share/ace-qdrant:/qdrant/storage" qdrant/qdrant:v1.19.2; \
	fi

build: ## Compile the foundation
	npm run build

test: ## Run foundation tests
	npm test

clean: ## Remove generated local artifacts
	rm -rf dist .tsbuildinfo
