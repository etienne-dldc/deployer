# @dldc/deployer

Headless code-as-deployment engine for Docker Swarm.

The deployable unit is not a desired-state document. It is the code in **one
deploy repository per environment**, executed against the live system through a
small controller API. Every deploy is a git commit; `git log` is the history and
the debugging UI.

This repository contains:

| Path | What |
| --- | --- |
| `controller` | The Hono controller server; it owns the Docker/Swarm side. Private, shipped as a Docker image. |
| `sdk` | The SDK used by deploy code. Its build is the only npm artifact. |
| `scripts/stage-sdk.ts` | Creates `build/npm`, the SDK-only publish folder, with a generated `package.json`. |
| `docker/runner-base` | Base image for deploy-code containers. |
| `plans/` | Architecture and MVP design notes. |

## Status

Scaffolding for the MVP. The controller starts, serves `/status`, and exposes
`POST /api/apply` behind `DEPLOYER_TOKEN`; the apply pipeline itself
(tar → git commit → image build → isolated run) lands next.

## Development

```sh
pnpm install
pnpm check        # format, lint, type-check
pnpm test
pnpm build        # controller + SDK + build/npm publish staging
```

Run the controller locally:

```sh
DEPLOYER_TOKEN=dev pnpm dev
```

| Env | Default | Meaning |
| --- | --- | --- |
| `DEPLOYER_TOKEN` | required | Bearer token for `POST /api/apply` |
| `PORT` | `8787` | HTTP port |
| `HOST` | `0.0.0.0` | HTTP bind address |

The controller refuses to start without `DEPLOYER_TOKEN`.

## Docker

Build the controller image:

```sh
pnpm docker:build
```

Run it:

```sh
docker run --rm \
  -p 8787:8787 \
  -e DEPLOYER_TOKEN=change-me \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$PWD/.deployer:/app/.deployer" \
  ghcr.io/etienne-dldc/deployer:dev
```

Images are published to
`ghcr.io/etienne-dldc/deployer` by `.github/workflows/docker-publish.yml` on
pushes to `main` and tags.

Build the deploy-code base image:

```sh
pnpm base:build   # deployer-runner-base:dev
```

## SDK

The repository is one package; the npm artifact is generated in `build/npm` and
is the only thing published.

```sh
pnpm pack:sdk
cd build/npm && npm pack --dry-run
```

`scripts/stage-sdk.ts` copies `dist/sdk`, scans the emitted `.mjs` and `.d.mts`
files for package imports, and generates a `package.json` containing only the
dependencies the SDK actually uses. The controller is built into
`dist/controller` for the Docker image and is never part of the tarball.

Deploy code installs the SDK like any other dependency:

```sh
pnpm add @dldc/deployer-sdk
```

The API is a ts-api `Graph` defined in `sdk/graph.ts`. The SDK exports the
typed query builder `q`, `executeQuery`, and `equal`:

```ts
import { executeQuery, q } from "@dldc/deployer-sdk";

const version = await executeQuery(q.Graph.meta.version());
```

`executeQuery` reads `DEPLOYER_SOCKET` and `DEPLOYER_RUN_TOKEN` from the run
environment; the controller uses the same `Graph` as its resolver contract.

## Design

- [`plans/code-deployment-architecture.md`](./plans/code-deployment-architecture.md)
- [`plans/code-deployment-mvp.md`](./plans/code-deployment-mvp.md)
