# Base image for deploy code. Repos use this as `FROM deployer-runner-base:dev`
# and install their own dependencies, including `@dldc/deployer-sdk`.
FROM node:26-slim

RUN npm install -g pnpm@12.14.0 \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
