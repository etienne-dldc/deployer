# Base image for deploy code. Repos use this as `FROM deployer-runner-base:dev`
# and install their own dependencies, including `@dldc/deployer-sdk`.
FROM node:26-slim

RUN npm install -g pnpm@12.14.0 \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Development shortcut while `@dldc/deployer-sdk` is not published yet: the SDK
# staged from this repository (`pnpm pack:sdk`) is available for deploy repos as
# `file:/opt/deployer-sdk`. Once the SDK is on npm, drop this and install it
# from the registry like any other dependency.
COPY build/npm /opt/deployer-sdk

WORKDIR /app
