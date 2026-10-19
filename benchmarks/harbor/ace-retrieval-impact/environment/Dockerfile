FROM node:22-bookworm
RUN npm install -g @openai/codex@latest \
 && apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m pip install --break-system-packages fastembed==0.7.4 tree-sitter==0.26.0 tree-sitter-typescript==0.23.2
WORKDIR /workspace
COPY fixture/ /workspace/
