FROM node:22-bookworm
RUN npm install -g @openai/codex@0.148.0-alpha.9 \
 && apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -c 'import sys; sys.exit("ACE benchmark runtime requires Python 3.11+") if sys.version_info < (3, 11) else None' \
 && python3 -m pip install --break-system-packages \
      fastembed==0.9.1 pillow==13.0.0 onnxruntime==1.23.2 numpy==2.2.6 huggingface-hub==1.33.0 \
      tree-sitter==0.26.0 tree-sitter-typescript==0.23.2
WORKDIR /workspace
COPY fixture/ /workspace/
