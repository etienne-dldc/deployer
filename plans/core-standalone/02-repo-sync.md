# Slice 2 — Repository sync

Turn an uploaded tar into a git commit. This is the first real pipeline step.

> **Port sources (`tower-control/controller/src/`):**
>
> - `logic/system/tarSync.ts` — extract tar into the repo dir (preserving
>   `.git`)
> - `logic/system/steps/tarSyncStep.ts` — the sync as a resumable step
> - `logic/gitClient/gitClient.ts`, `gitClient.prod.ts`, `gitClient.dev.ts`,
>   `types.ts` — git command runner (prod) + dev mock
> - `logic/system/system.ts` — `System` + deploy queue; introduces the `System`
>   that `src/mount.ts` must start mounting (the Slice 0 gap)

> **Dev note:** `gitClient.dev.ts` mock ports as-is, gated by a `DEV_MODE` env
> var to be added to `src/logic/config/`.

## What's in

- Extract tar into the repo directory (preserving `.git`)
- `git add -A` + commit
- Record the new commit hash on the deploy row
- Record the previous commit (for diffing in the next step)
- Wrapped in the step model (resumable, idempotent)
- Wire into `runDeploy` — replace the stub with this first phase

## Working state at end

- `POST /api/tar-deploy` → tar extracted → git commit created
- Deploy row has `gitCommit` set
- Deploy flow has `previousCommit` set
- Step row records the sync result
