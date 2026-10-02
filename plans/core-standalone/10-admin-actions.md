# Slice 10 — Admin actions

Add resolvers for service/stack management and Docker state sync.

> **Port sources (`tower-control/controller/src/`):**
>
> - `logic/actions/adminActionSchema.ts`, `logic/actions/actionProps.ts` — admin
>   action shapes/validation (as input schemas for the new resolvers)
> - `logic/actions/dispatch.ts` — the action bodies for force update / remove
>   (dissolved into individual graph resolvers here)
> - `database/actions/service.ts`, `database/actions/stack.ts` — remove/cleanup
>   helpers
> - `logic/system/syncDockerState.ts` + `logic/dockerClient/stackOps.ts` —
>   `actions.syncDockerState` and post-remove reconciliation
> - `logic/dockerClient/serviceDeploy.ts` — `forceUpdateService` (inspect →
>   redeploy with force counter)

## What's in

- `actions.forceUpdateService(serviceName)` — inspect → redeploy with force
- `actions.removeService(serviceName)` — remove from Docker + sync state
- `actions.removeStack(stackName)` — remove all services + sync state
- `actions.syncDockerState()` — sync live Docker state to DB

## Working state at end

- All Docker management operations available via the graph API
