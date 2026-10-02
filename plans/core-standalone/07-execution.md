# Slice 7 — Execution

Deploy stacks to Docker Swarm, phase by phase, with concurrency within each
phase.

> **Port sources (`tower-control/controller/src/`):**
>
> - `logic/system/steps/serviceDeployStep.ts` — per-service deploy as a
>   resumable step
> - `logic/system/steps/networksStep.ts` — ensure Docker networks exist
> - `logic/dockerClient/dockerClient.ts`, `dockerClient.prod.ts`,
>   `dockerClient.dev.ts`, `types.ts`, `helpers.ts` — Docker API client + dev
>   mock
> - `logic/dockerClient/serviceDeploy.ts` — compose → ServiceSpec conversion,
>   create/update, `ForceUpdate`, image digest pinning
> - `logic/dockerClient/convergence.ts` — poll for service convergence (unless
>   `skipUpdatePoll`)
> - `logic/convert/*` — compose → Docker ServiceSpec conversion
>   (`convertCompose.ts`, `service.ts`, `networks.ts`, `mounts.ts`, `ports.ts`,
>   `healthcheck.ts`, `duration.ts`, `topology.ts`, `deploy.ts`)

> **Dev note:** `dockerClient.dev.ts` mock ports as-is, gated by `DEV_MODE`
> (same env var as Slice 2). Concurrency uses `DEPLOY_CONCURRENCY` config
> (planned env var, mirroring the controller default of 4).

## What's in

- For each phase (pre → default → post):
  - For each stack in the phase:
    - Ensure Docker networks exist (networks step)
    - For each service that should deploy:
      - Convert compose service → Docker ServiceSpec
      - Call Docker API: create or update service
      - Handle `ForceUpdate` counter (force-update semantics)
      - Pin image digest if new image detected
      - Poll for service convergence (unless `skipUpdatePoll`)
- Concurrency: deploy multiple stacks within a phase up to `deployConcurrency`
- Wrapped in the step model (each service deploy is a resumable step)

## Working state at end

- Stacks actually deploy to Docker Swarm
- Each service deploy is a step row (success/failed/skipped)
- Interrupted deploys resume: completed services are skipped
