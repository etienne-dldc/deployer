# Slice 0 — Scaffolding

Boot a standalone HTTP service with the three endpoints. The deploy queue
accepts tars but the pipeline is a no-op stub that immediately marks the deploy
as success.

> **Note (adapted to this repo):** most of this slice is **already done** in
> `src/` — server + routes (`src/server.ts`, `src/routes.ts`), `/api/graph`
> (`src/handlers/apiGraph.ts` + `src/graph/*`), `/api/events`
> (`src/handlers/apiEvents.ts` + `src/logic/subscription.ts`), tar-deploy auth
> (`src/handlers/apiTarDeploy.ts`), DB + migrations (`src/database/`), config
> (`src/logic/config/`), lifecycle (`src/utils/mountable.ts`, `src/mount.ts`,
> `src/main.ts`), and the Temporal.Instant transport (`src/graph/builtins.ts`).
> What remains: the **deploy queue + `System` stub** (queue accepts a deploy and
> marks it success) and the **real tar save** in `apiTarDeploy` (currently
> returns `{"id":"TODO"}` and queues nothing). This remaining gap is absorbed
> into Slice 1 (step model) and Slice 2 (repo sync), which introduce the
> `System` and its queue. Splitting that out here is not needed — start at
> Slice 1.

## What's in

- `core/deno.json` (package config, imports, tasks)
- `core/src/main.ts` — `mount()` + `Deno.serve` + SIGTERM handler
- `core/src/server.ts` — Hono app with 3 routes:
  - `POST /api/graph` — ts-api engine (minimal: `deploy.queue`, `deploy.byId`,
    `deploy.list`, `version`)
  - `GET /api/events` — SSE stream of `SubscriptionEvent` as JSON
  - `POST /api/tar-deploy` — bearer auth, save tar,
    `System.deploy("tar", { tarPath })`, return `{"id":...}` as 202
- `core/src/mount.ts` — Config, GitClient, DockerApiClient, DockerClient,
  Subscription, Db, System
- `core/src/api/graph.ts` — ts-api schema (minimal deploy types + version)
- `core/src/api/types.ts` — AllTypes map
- `core/src/api/builtins.ts` — Temporal.Instant builtin + superjson setup
- `core/src/api/resolvers.ts` — minimal resolvers
- `core/src/system/system.ts` — queue + lifecycle (pipeline = stub: mark
  success)

## What's NOT in

The deploy pipeline. `System` queues deploys and processes them sequentially,
but `runDeploy` is a stub that does nothing and marks the deploy as success.

## Working state at end

- `deno task start` boots core
- `POST /api/tar-deploy` with a tar returns `{"id":"..."}` as 202
- `POST /api/graph` answers queue / byId / list / version queries
- `GET /api/events` streams JSON SSE events
- `deno check` passes; no JSX, no `routes.ts` anywhere
