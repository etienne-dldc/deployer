# Slice 6 — Image resolution

Check remote registries for new image digests and decide whether services need
updating due to image changes.

> **Port sources (`tower-control/controller/src/`):**
>
> - `logic/system/steps/imageWatchStep.ts` — image watch step (compares remote
>   digest vs local pinned digest, records results in the flow)
> - `logic/dockerClient/registry.ts` — registry queries (need `REGISTRY_TOKEN`
>   config added to `src/logic/config/`)
> - `logic/dockerClient/imageOps.ts` — image ingestion/pinning helpers

## What's in

- For services with `imageWatch: true`, query the remote registry for the latest
  digest
- Compare remote digest against the local digest
- Record results in the deploy flow
- Services with a new image become deploy candidates (pin the digest)

## Working state at end

- Deploy flow records `imageWatchResults` per watched service
- Services with new images are flagged for deploy
