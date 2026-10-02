# syntax=docker/dockerfile:1

# ??-- deployer -- headless deploy engine (Docker Swarm)
#
# Runs the app from source with Deno. The deploy pipeline shells out to the
# `git` CLI (to commit tar extracts), so git is installed explicitly — it is
# not part of the official denoland/deno image.
#
# Runtime mounts (provided by the operator, see plans/core-standalone):
#   /src/source  — the synced source repo (includes the deploy/ compose stacks)
#   /src/secrets — secrets dir (.env, docker config)
#   /src/data    — sqlite db, uploaded tars, backups
#
# The Docker Engine socket is also expected to be mounted
# (/var/run/docker.sock) — the pipeline drives Docker over the API.

FROM denoland/deno:2.9.7

LABEL org.opencontainers.image.title="@dldc/deployer" \
      org.opencontainers.image.description="Standalone headless deploy engine for Docker Swarm" \
      org.opencontainers.image.url="https://github.com/etienne-dldc/deployer" \
      org.opencontainers.image.source="https://github.com/etienne-dldc/deployer" \
      org.opencontainers.image.licenses="MIT"

# git is required by the deploy pipeline (gitClient commits tar extracts)
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache dependencies first so app changes don't re-resolve them
COPY deno.json deno.lock ./
COPY src ./src
RUN deno cache src/main.ts

EXPOSE 3000

# used by the HEALTHCHECK below (GET /status)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD deno eval --allow-net "const r = await fetch('http://127.0.0.1:3000/status'); Deno.exit(r.ok ? 0 : 1)"

# sqlite db, uploaded tars and the synced source repo are external state
VOLUME ["/src/source", "/src/secrets", "/src/data"]

CMD ["deno", "run", "--allow-all", "./src/main.ts"]
