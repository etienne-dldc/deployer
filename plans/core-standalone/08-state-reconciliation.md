# Slice 8 — State reconciliation

Sync live Docker state back into the DB after deploys and finalize the deploy.

> **Port sources (`tower-control/controller/src/`):**
>
> - `logic/system/syncDockerState.ts` — list live services, upsert DB rows,
>   remove stale rows, emit events, finalize deploy status
> - `logic/dockerClient/serviceReadOps.ts`, `serviceParsers.ts`, `stackOps.ts` —
>   reading live Docker services/stacks and mapping them to rows

## What's in

- List live Docker services
- Upsert service rows (image, replicas, status)
- Remove DB rows for services/stacks that no longer exist in Docker
- Emit subscription events for changed services/stacks
- Finalize the deploy: if any step failed, mark as "partial"; otherwise
  "success"

## Working state at end

- DB service/stack tables reflect live Docker state after each deploy
- Deploy row finalized with status `success` or `partial`
- The full pipeline is complete: tar → commit → diff → plan → images → execute →
  sync → finalize
