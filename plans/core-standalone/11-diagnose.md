# Slice 11 — Diagnose

Add resolvers for the full diagnose lifecycle.

> **Port sources (`tower-control/controller/src/`):**
>
> - `logic/diagnose.ts` — diagnose orchestration (create row, kick off async
>   diagnosis, abort)
> - `database/actions/diagnose.ts` — diagnose row helpers
> - `logic/dockerClient/diagnoseOps.ts` — Docker-side diagnosis operations

## What's in

- `diagnose.create(serviceName)` — create a diagnose row + kick off async
  diagnosis, returns `DiagnoseRow`
- `diagnose.byId(id)` — get a diagnose by ID
- `diagnose.listByService(serviceName, limit?)` — list diagnoses for a service
- `diagnose.remove(id)` — abort if running + delete row

## Working state at end

- Full diagnose lifecycle available via graph API
