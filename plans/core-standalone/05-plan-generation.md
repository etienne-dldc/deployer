# Slice 5 — Plan generation

Determine which services are affected and group stacks into ordered phases.

> **Port sources (`tower-control/controller/src/`):**
>
> - `logic/system/steps/planStacksStep.ts` — compare changed files against
>   bind-mounts, env-file hashes, missing services; per-service decisions; phase
>   grouping (pre → default → post)
> - `logic/convert/*` — as-needed helpers for service/topology reasoning
>   (`convertCompose.ts`, `service.ts`, `networks.ts`, `mounts.ts`, `ports.ts`,
>   `healthcheck.ts`, `duration.ts`, `topology.ts`, `deploy.ts`)

## What's in

- Compare changed files against stack bind-mounts (affected by file changes)
- Compare env file hashes (affected by secret/config changes)
- Detect missing services (not yet in Docker)
- Determine per-service deploy decisions: deploy / skip / force-update
- Group stacks into phases (pre → default → post)
- Record the full plan in the deploy flow

## Working state at end

- Deploy flow records `phases: FlowPhase[]` with per-stack, per-service
  decisions
- Each service has a reason for deploy or skip
