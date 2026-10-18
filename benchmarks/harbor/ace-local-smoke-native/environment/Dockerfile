FROM ubuntu:24.04

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       bash ca-certificates curl nodejs npm ripgrep \
    && npm install --global @openai/codex@latest \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY fixture.txt /workspace/fixture.txt
