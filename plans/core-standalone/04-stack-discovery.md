# Slice 4 — Stack discovery

Discover compose files in the repo, parse them, and filter by deploy
environment.

> **Port sources (`tower-control/controller/src/`):**
>
> - `logic/parser/*` — compose parser (`parseCompose.ts`, `schema.ts`,
>   `fields.ts`, `service.ts`, `networks.ts`, `volumes.ts`, `ports.ts`,
>   `helpers.ts`, `types.ts`)
> - `logic/system/discoverStacks.ts` — glob `**/compose.{yml,yaml}` under the
>   deploy dir, parse, filter by `deployEnvironments`
> - `logic/parser/deploy.ts` — parse the `deploy:` section (environment, phases,
>   image watch, concurrency)
> - `logic/system/validateAndPrepareVolumes.ts` — volume validation

> **Dev note:** `deployEnvironments` filtering needs a `DEPLOY_ENVIRONMENT` env
> var added to `src/logic/config/`.

## What's in

- Glob `**/compose.{yml,yaml}` under the deploy directory
- Parse each compose file (reuse existing parser)
- Filter stacks by `deployEnvironments` (skip stacks not meant for this env)
- Validate volumes
- Validate required env specs
- Record discovered stacks + services in the deploy flow

## Working state at end

- Deploy flow records the list of stacks with their services
- Stacks that don't match the current environment are skipped
