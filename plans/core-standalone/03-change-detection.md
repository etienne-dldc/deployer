# Slice 3 — Change detection

Compute which files changed between the previous deploy's commit and the current
one.

> **Port sources (`tower-control/controller/src/`):**
>
> - `logic/system/steps/gitDiffStep.ts` — `git diff` between previous commit and
>   current HEAD, parsed into changed file paths

## What's in

- `git diff` between previous commit and current HEAD
- Parse the diff output into a list of changed file paths
- Store the changed files list in the deploy flow
- Wrapped in the step model

## Working state at end

- Deploy flow records `changedFiles: string[]`
- If no previous deploy exists, treat as full-tree diff (everything changed)
