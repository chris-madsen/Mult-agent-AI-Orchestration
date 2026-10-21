FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends git python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/chris-madsen/chess.git /workspace && cd /workspace && git checkout 23a7bb6b27023e8520941841d69745dd623d0933 && npm install
WORKDIR /workspace
