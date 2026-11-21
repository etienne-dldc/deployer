# syntax=docker/dockerfile:1

# Controller image. It runs the deployer code, not the deploy code it launches.
# The deploy code runs in an ephemeral container built from the runner base.

FROM node:26-slim AS build

RUN npm install -g pnpm@12.14.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json vite.config.ts ./
COPY controller ./controller
COPY sdk ./sdk
COPY artifact ./artifact
RUN pnpm build:controller

FROM node:26-slim AS runtime

LABEL org.opencontainers.image.title="@dldc/deployer" \
      org.opencontainers.image.description="Code-as-deployment engine for Docker Swarm" \
      org.opencontainers.image.url="https://github.com/etienne-dldc/deployer" \
      org.opencontainers.image.source="https://github.com/etienne-dldc/deployer" \
      org.opencontainers.image.licenses="MIT"

# git is needed by the deploy pipeline (tar extract -> commit). The controller
# talks to Docker over the mounted socket, so the Docker CLI is not required.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build /app/dist/controller ./dist

EXPOSE 8787
VOLUME ["/app/.deployer"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "const port = process.env.PORT ?? 8787; fetch('http://127.0.0.1:' + port + '/status').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.mjs"]
