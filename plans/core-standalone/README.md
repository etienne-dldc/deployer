# Core standalone — implementation plan

Standalone HTTP deploy engine with **no UI**. This repo (`@dldc/deployer`) is
the headless core: it exposes a type-safe RPC API
([ts-api](https://github.com/dldc-packages/ts-api)), an SSE event stream, and a
tar-deploy endpoint. Any UI (a future SPA, a CLI) becomes a separate consumer of
this API.

No GitHub webhook. No HTML. No JSX. No HTMX. The engine is headless.

---

## Origin of this plan

This plan was originally written for
[`tower-control`](https://github.com/etienne-dldc/tower-control), where a new
`core/` directory was to be built next to the existing `controller/`. It has
been **adapted** for this repo, which _is_ the standalone core — there is no
sibling UI to migrate around.

The deploy pipeline is **written in this repo from scratch**, using
`tower-control/controller/` as the port source. Each slice lists the exact
source files to bring over and adapt (paths relative to the `tower-control`
checkout).

```
deployer/                        # this repo
├── src/                         # the standalone core
│   ├── database/                # zendb schema, migrations, db actions
│   ├── graph/                   # ts-api: schema, builtins, engine, resolvers
│   ├── handlers/                # /api/graph, /api/events, /api/tar-deploy
│   ├── logic/                   # config, factory, subscription, system/*
│   └── utils/
├── plans/core-standalone/       # this plan
├── .github/                     # docker-publish + jsr-publish
└── deno.json
```

Runtime mounts (not part of this repo): `repoDir` (the synced source tree,
including the `deploy/` compose stacks), `secretsDir`, `dataDir` — provided by
the runtime environment via env vars.

---

## Current state

Slice 0 scaffolding is largely **already implemented**:

- HTTP server + route constants — `src/server.ts`, `src/routes.ts`
- `POST /api/graph` — `src/handlers/apiGraph.ts` +
  `src/graph/{engine,resolvers}.ts`
- `GET /api/events` — `src/handlers/apiEvents.ts` + `src/logic/subscription.ts`
- `POST /api/tar-deploy` — bearer auth wired (`src/handlers/apiTarDeploy.ts`);
  the tar-save + queue logic is still a stub (`{"id":"TODO"}`)
- DB + migrations — `src/database/` (zendb + sqlite); the schema is a `todo`
  stub
- Config — `src/logic/config/` (env: `PORT`, `DATABASE_PATH`, `TRIGGER_TOKEN`)
- Temporal.Instant builtin + superjson transport — `src/graph/builtins.ts`
- Lifecycle — `src/utils/mountable.ts`, `src/mount.ts`, `src/main.ts`

`deno task check` passes. Real work starts at **Slice 1**. The remaining Slice 0
gap — deploy queue + `System` stub + real tar save — is absorbed into the first
pipeline slices (see [Slice 0](./00-scaffolding.md) for the note).

---

## Endpoints

| Endpoint               | Protocol                           | Purpose                                                            |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| `POST /api/graph`      | ts-api RPC (`{ path, args }` JSON) | All queries + mutations                                            |
| `GET /api/events`      | SSE (JSON events)                  | Real-time subscription to deploys, steps, queue, services, backups |
| `POST /api/tar-deploy` | Binary upload (bearer auth)        | Accept tar archive, queue a `"tar"` deploy                         |

Auth: bearer token on `/api/tar-deploy` (timing-safe compare). `/api/graph` and
`/api/events` are unauthenticated in MVP; auth can be added as middleware later.

---

## The ts-api graph

`src/graph/schema.ts` is the **single source of truth** — the contract between
core and any UI. It is a plain TypeScript file with interface/type declarations.
Leaves are functions (RPC endpoints), nested objects are namespaces. The graph
will be defined incrementally as slices are implemented.

- `src/graph/builtins.ts` — Temporal.Instant builtin + superjson transport
- `src/graph/resolvers.ts` — resolvers bound to the schema
- `src/graph/engine.ts` — ts-api `createEngine` wired to HttpHandlers/API

## Transport: Temporal.Instant

DB rows use `Temporal.Instant` for timestamps. ts-api validates values at
runtime but does **not** serialize/deserialize them. `JSON.stringify` does not
know how to encode `Temporal.Instant`.

**Decision:** keep `Temporal.Instant` end-to-end (already implemented in
`src/graph/builtins.ts`):

1. **Custom ts-api builtin** — registers a valibot schema
   (`v.instance(Temporal.Instant)`) so ts-api can validate the type at runtime.
2. **superjson** — registered with a custom encoder for `Temporal.Instant`
   (`.toString()` / `Temporal.Instant.from()`), used on both sides of the wire
   to transparently encode/decode.

This avoids converting to ISO strings in resolvers — the graph types stay honest
about what they return.

Dependencies are already in `deno.json`: `superjson` (npm), `@dldc/ts-api`
(jsr).

---

## SSE event format

`GET /api/events` emits JSON-over-SSE. Same `SubscriptionEvent` types as the
controller, just JSON instead of HTML partials:

```
event: deploy
data: {"kind":"deploy","deployId":"abc123"}

event: queue
data: {"kind":"queue"}
```

Implemented in `src/logic/subscription.ts` (event bus) +
`src/handlers/apiEvents.ts` (SSE stream). The `SubscriptionEvent` union is
currently a `todo1`/`todo2` stub and grows as slices land. A UI consumer maps
events to its own rendering.

---

## Slices

The deploy pipeline is **written from scratch** in this repo. Slices 0–8 build
the pipeline in small, reviewable steps. Each step produces a working core (the
pipeline grows incrementally). Slices 9–13 add the remaining features on top.

Each slice lists **port sources** from `tower-control/controller/` — those are
the files to mirror into `src/`, adjusted for the standalone layout.

### Phase 1 — Core scaffolding + deploy pipeline

| # | Slice                                                | Goal                                                                      | Working state at end                                                             |
| - | ---------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 0 | [Scaffolding](./00-scaffolding.md)                   | Boot, HTTP server, graph endpoint, SSE, tar-deploy endpoint, deploy queue | Tar POST → 202 `{"id":...}`; deploy queued but pipeline is a no-op stub          |
| 1 | [Step model](./01-step-model.md)                     | New abstraction for resumable, idempotent steps                           | Steps persist to DB, skip if already done, resume after interruption             |
| 2 | [Repository sync](./02-repo-sync.md)                 | Tar → extract → git commit                                                | Queued tar produces a git commit; deploy row records the commit                  |
| 3 | [Change detection](./03-change-detection.md)         | Git diff between previous and current commit                              | Deploy flow records changed files                                                |
| 4 | [Stack discovery](./04-stack-discovery.md)           | Glob compose files, parse them, filter by environment                     | Deploy flow records discovered stacks + services                                 |
| 5 | [Plan generation](./05-plan-generation.md)           | Determine affected services, group into phases                            | Deploy flow records the full plan (phases + per-service decisions)               |
| 6 | [Image resolution](./06-image-resolution.md)         | Check registries for new digests                                          | Deploy flow records image watch results; new images trigger deploys              |
| 7 | [Execution](./07-execution.md)                       | Deploy stacks in phases — networks + service deploy via Docker API        | Stacks actually deploy to Docker Swarm                                           |
| 8 | [State reconciliation](./08-state-reconciliation.md) | Sync live Docker state back to DB after deploys                           | Service/stack tables reflect reality; deploy finalizes as success/partial/failed |

### Phase 2 — Features on top of the pipeline

| #  | Slice                                                                        | Goal                                                                               | Working state at end                            |
| -- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------- |
| 9  | [Deploy trigger + stacks + services queries](./09-deploy-stacks-services.md) | `deploy.trigger`, `stacks.list`, `stacks.info`, `services.list`, `services.byName` | A UI can render the deploy form + service table |
| 10 | [Admin actions](./10-admin-actions.md)                                       | `actions.forceUpdateService`, `removeService`, `removeStack`, `syncDockerState`    | Service/stack management via API                |
| 11 | [Diagnose](./11-diagnose.md)                                                 | `diagnose.create`, `byId`, `listByService`, `remove`                               | Full diagnose lifecycle via API                 |
| 12 | [Service config](./12-service-config.md)                                     | `config.getServiceConfig`, `updateVariable`, `generateValue`                       | Env var management via API                      |
| 13 | [Backups](./13-backups.md)                                                   | `backups.trigger`, `queue`, `list`, `byId`, `flow`, `steps` + BackupSystem mount   | Full backup lifecycle via API                   |

---

## Key decisions

- **Pipeline ported from tower-control, not invented** — the deploy pipeline
  lives in `tower-control/controller/src/logic/` (`system/`, `convert/`,
  `dockerClient/`, `parser/`, `envconfig/`, `backup/`). Each slice names the
  exact files to port into `src/`, adapted to the standalone layout.
- **No GitHub webhook** — only tar deploy as trigger. Remove `"webhook"` from
  `DeployTrigger`.
- **`dispatch.ts` dissolved** — each admin action becomes an individual graph
  resolver. No `ROUTES` imports, no redirect URLs.
- **No JSX** — no `jsx` / `jsxImportSource` compiler options. No
  `@dldc/hono-ui`, `@dldc/css-builder`, `lucide-static`.
- **`routes.ts` kept** — the original plan banned it as the JSX UI's route
  registry. Here `src/routes.ts` holds only the API route constants (uses
  `regexparam`) and is kept.
- **Port source discipline** — ported files must keep their imports
  self-contained inside `src/` and drop all controller UI coupling (partials,
  routes, `ROUTES`, Hono JSX helpers).
- **`/api/graph` auth** — unauthenticated in MVP. Add bearer-token middleware
  when exposing to external consumers.
- **Dev mode** — `gitClient.dev.ts` / `dockerClient.dev.ts` mock implementations
  port over with the git/docker clients. Controlled by a `DEV_MODE` env var (to
  be added to `src/logic/config/`).
- **Config grows as slices land** — current env vars: `PORT`, `DATABASE_PATH`,
  `TRIGGER_TOKEN`. Planned (mirroring
  `tower-control/controller/src/logic/config/`): `DEPLOY_ENVIRONMENT`,
  `DEV_MODE`, `REPO_DIR`, `SECRETS_DIR`, `DATA_DIR`, `REGISTRY_TOKEN`,
  `DEPLOY_CONCURRENCY`, and the `BACKUP_*` block.
