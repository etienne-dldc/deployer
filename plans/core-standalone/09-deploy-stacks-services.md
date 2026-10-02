# Slice 9 — Deploy trigger + stacks + services queries

Add query/mutation resolvers so a UI can render the deploy form and service
table.

> **Port sources (`tower-control/controller/src/`):**
>
> - `logic/actions/dispatch.ts` — `deploy.trigger` (manual deploy with service
>   selections); only the trigger part — the rest is dissolved into individual
>   resolvers in Slice 10
> - `database/actions/deploy.ts`, `database/actions/stack.ts`,
>   `database/actions/service.ts` — DB query helpers for deploy/stack/service
>   rows
> - `logic/system/discoverStacks.ts` — `stacks.info` (discover + parse compose,
>   group by phase for the deploy form)

## What's in

- `deploy.trigger(trigger, selections?)` — enqueue a manual deploy with service
  selections, returns deploy ID
- `deploy.flow(id)` — get the full flow (phases + steps metadata)
- `stacks.list()` — list stacks from DB (synced state)
- `stacks.info()` — discover + parse compose files, group by phase (for the
  deploy form)
- `services.list()` — list all services from DB
- `services.byName(name)` — get a single service by name

## Working state at end

- A UI can enqueue a deploy with selected services
- A UI can render the deploy form (stacks grouped by phase)
- A UI can render the service table
