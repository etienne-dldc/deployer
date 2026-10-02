# Slice 13 — Backups

Add `backups.*` resolvers and mount `BackupSystem`.

> **Port sources (`tower-control/controller/src/`):**
>
> - `logic/backup/` — the whole module: `backupSystem.ts`, `runBackup.ts`,
>   `s3Client.ts`, `steps/*` (plan, archive, artifactCopy, controllerDbSnapshot,
>   retention, upload)
> - `database/actions/backup.ts` — backup row/flow/step helpers
> - `logic/config/types.ts` + `defaultConfig.ts` — the `BackupConfig` block
>   (allowedRoots, concurrency, maxArchiveSize, retentionCount, s3 …) and its
>   `BACKUP_*` env parsing to add to `src/logic/config/`
> - Mount `BackupSystem` in `src/mount.ts`

## What's in

- `backups.trigger()` — `BackupSystem.get().backup("manual")`, returns backup ID
- `backups.queue()` — backup queue state
- `backups.list(pageSize)` — list recent backups
- `backups.byId(id)` — get a backup by ID
- `backups.flow(id)` — get the backup flow
- `backups.steps(backupId)` — list steps for a backup
- Add `BackupSystem.mount()` to `mount.ts`

## Working state at end

- Full backup lifecycle available via graph API
- All subsystems from the original controller are now available — core is
  feature-complete (minus UI)
