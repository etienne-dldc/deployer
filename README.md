# @dldc/deployer

Headless code-as-deployment engine for Docker Swarm.

The deployable unit is not a desired-state document. It is the code in **one
deploy repository per environment**, executed against the live system through a
small controller API. Every deploy is a git commit; `git log` is the history and
the debugging UI.

This repository contains:

| Path | What |
| --- | --- |
| `controller` | The Hono controller server; it owns the Docker/Swarm side. Private, shipped as a Docker image. |
| `sdk` | The SDK used by deploy code. Its build is the only npm artifact. |
| `cli` | `deploy <dir>`: packs a deploy repo and posts it to the controller. |
| `examples/hello` | A working deploy repo: reconciles one whoami service on `:8081`. |
| `scripts/stage-sdk.ts` | Creates `build/npm`, the SDK-only publish folder, with a generated `package.json`. |
| `docker/runner-base` | Base image for deploy-code containers. |
| `plans/` | Architecture and MVP design notes. |

## Status

The apply pipeline is complete: `POST /api/apply` takes a tar of the deploy
repository, commits it to the deploy git history, builds an image from
`git archive <commit>`, and runs that image once in a hardened ephemeral
container. The run talks back through the internal Unix socket with a per-run
token, and the response carries the run id, the commit and the run log.

The Docker side was already in place: `ServiceConfig` ↔ Swarm conversion, the
internal `service` primitives (`inspect`, `list`, `create`, `update`, `remove`)
plus `wait.serviceConverged` behind a per-run-token Unix socket.

One thing is deliberately not done yet: the controller keeps exactly one deploy
repository and one socket, so applies are serialized.

## Development

```sh
pnpm install
pnpm check        # format, lint, type-check
pnpm test
pnpm build        # controller + SDK + build/npm publish staging
```

Run the controller locally:

```sh
DEPLOYER_TOKEN=dev pnpm dev
```

| Env | Default | Meaning |
| --- | --- | --- |
| `DEPLOYER_TOKEN` | required | Bearer token for `POST /api/apply` |
| `PORT` | `8787` | HTTP port |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `DEPLOYER_DATA_DIR` | `.deployer` | Controller root: `repo/` (deploy history) and `run/` (socket, scratch) |
| `DEPLOYER_SOCKET_PATH` | `<data dir>/run/deployer.sock` | Internal Unix socket reached by deploy runs |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker API socket |

The controller refuses to start without `DEPLOYER_TOKEN`. `DEPLOYER_DATA_DIR`
must be a host path mounted at the **same** location in the controller and in
run containers: the controller hands Swarm bind mounts of `repo/` and `run/`,
and those paths are resolved by the Docker daemon on the host.

## Deploying

A deploy repo is a directory with a `Dockerfile` and deploy code:

```sh
DEPLOYER_URL=http://127.0.0.1:8787 DEPLOYER_TOKEN=dev pnpm deploy examples/hello
```

The CLI packs the directory (skipping `.git`, `node_modules`, `.deployer`),
posts it to `/api/apply`, and prints the run log. The controller then:

1. unpacks the tar into the deploy repository and commits it (every deploy is a
   commit, even when nothing changed);
2. builds `deployer-run:<commit>` from `git archive <commit>`;
3. runs that image once, with no network, a read-only root, `--cap-drop ALL`,
   a non-root user, and a wall-clock cap, mounted to `/repo` (read-only),
   `/work` (scratch) and the socket directory;
4. revokes the run token and returns the log.

Deploy code does the reconciling. `examples/hello/index.js` inspects the live
service, creates it, updates it when the config differs, and logs "up to date"
when it already matches.

```sh
DEPLOYER_DATA_DIR=/root/deployer-data docker run --rm \
  -p 127.0.0.1:8787:8787 \
  -e DEPLOYER_TOKEN=change-me \
  -e DEPLOYER_DATA_DIR=/root/deployer-data \
  -v /root/deployer-data:/root/deployer-data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ghcr.io/etienne-dldc/deployer:dev
```

In CI, do not publish the controller port: run `ssh user@host 'deploy <message>'`
with the tar on stdin and a small remote script that posts it to
`127.0.0.1:8787`. Restrict the key with
`command="…/apply.mjs"` and `restrict` in `authorized_keys`, so it can only
deploy. The controller's token never leaves the host that way.


## Docker

Build the controller image:

```sh
pnpm docker:build
```

Run it:

```sh
docker run --rm \
  -p 127.0.0.1:8787:8787 \
  -e DEPLOYER_TOKEN=change-me \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$PWD/.deployer:/app/.deployer" \
  ghcr.io/etienne-dldc/deployer:dev
```

`/api/apply` builds images and controls Swarm, so it is not meant to be public:
bind it to loopback and let CI reach it over SSH (see
[deployer-sandbox](https://github.com/etienne-sandbox/deployer-sandbox), which
streams the tar through an SSH key restricted to a single apply command).

Images are published to
`ghcr.io/etienne-dldc/deployer` by `.github/workflows/docker-publish.yml` on
pushes to `main` and tags.

Build the deploy-code base image:

```sh
pnpm base:build   # deployer-runner-base:dev
```

## SDK

The repository is one package; the npm artifact is generated in `build/npm` and
is the only thing published.

```sh
pnpm pack:sdk
cd build/npm && npm pack --dry-run
```

`scripts/stage-sdk.ts` copies `dist/sdk`, scans the emitted `.mjs` and `.d.mts`
files for package imports, and generates a `package.json` containing only the
dependencies the SDK actually uses. The controller is built into
`dist/controller` for the Docker image and is never part of the tarball.

Deploy code installs the SDK like any other dependency:

```sh
pnpm add @dldc/deployer-sdk
```

Publishing goes through GitHub Actions, not a laptop: pushing a `v<version>` tag
runs `.github/workflows/publish-sdk.yml`, which checks that the tag matches
`package.json`, packs the SDK, and publishes with npm
[trusted publishing](https://docs.npmjs.com/trusted-publishers) — the workflow
gets a short-lived OIDC token, so there is no `NPM_TOKEN` secret, and the
tarball ships a provenance attestation. To release `0.1.2`: bump the version,
push the commit, then push the matching tag.

```sh
pnpm build && pnpm pack:sdk   # inspect build/npm before tagging
git tag v0.1.2 && git push origin v0.1.2
```

The workflow finishing is not the same as the version being installable: npm
answers "Your package is being processed" and can take several minutes to serve
the tarball, even though the version already shows up in the registry. Verify
before announcing a release:

```sh
npm view @dldc/deployer-sdk@0.1.2 dist.attestations.provenance.predicateType
npm install @dldc/deployer-sdk@0.1.2   # in a scratch project
npm audit signatures
```

The API is a ts-api `Graph` defined in `sdk/graph.ts`. The SDK exports the
typed query builder `q`, `executeQuery`, and `equal`:

```ts
import { executeQuery, q } from "@dldc/deployer-sdk";

const version = await executeQuery(q.Graph.meta.version());
```

`executeQuery` reads `DEPLOYER_SOCKET` and `DEPLOYER_RUN_TOKEN` from the run
environment; the controller uses the same `Graph` as its resolver contract. A
failed call rejects with the controller's message (`Unauthorized: ...`, or the
argument validation error) instead of returning an error object.

The controller parses `sdk/graph.ts` itself, so the schema file is the single
wire contract for both sides. The build copies it to `dist/controller/graph.ts`
for the deployed image.

## Design

- [`plans/code-deployment-architecture.md`](./plans/code-deployment-architecture.md)
- [`plans/code-deployment-mvp.md`](./plans/code-deployment-mvp.md)
