# Slice 1 — Step model

Build the new abstraction for resumable, idempotent steps. Steps persist to DB,
skip if already complete, and resume after interruption.

> **Port sources (`tower-control/controller/src/`):**
>
> - `database/schema/types.ts` — `steps` table (`ownerId` + `kind`); add the
>   steps table to `src/database/schema.ts` (currently a `todo` stub)
> - `database/actions/step.ts` — step row CRUD helpers
> - `logic/system/steps/runStep.ts` — step runner (create → in_progress →
>   success/failed/skipped)
> - `logic/subscription.ts` — step state-change events; adapt the event union in
>   `src/logic/subscription.ts` (currently `todo1`/`todo2`)

## What's in

- Step lifecycle: create → in_progress → success/failed/skipped
- Step persistence (reuse existing `steps` table — `ownerId` + `kind`)
- Step runner: given a step ID + a function, check if already done; if not, run
  and persist the result
- Skip + fail helpers
- Steps emit `Subscription` events on state change

## What's NOT in

Any actual pipeline step. Just the mechanism.

## Working state at end

- Step runner can create, run, skip, and fail steps
- Resuming a deploy re-runs in-progress steps, skips completed ones
- `deploy.steps(deployId)` resolver returns step rows
