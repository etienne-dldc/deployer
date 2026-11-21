# @dldc/deployer

Headless code-as-deployment engine for Docker Swarm.

The deployable unit is not a desired-state document. It is an **npm package
whose default export is a deploy function**, executed once against the live
system inside a hardened container. Every deploy is a git commit in the
controller's history, and the package that ran is the package in that commit.

This repository contains:

| Path | What |
| --- | --- |
| `controller` | Hono controller: the HTTP apply endpoint, the deploy history, and the Docker/Swarm side. |
| `artifact` | Package format: gzip/tar parsing, contract validation, extraction. Shared by the controller and the CLI. |
| `harness` | In `controller/`: the tiny runner entry that imports a package and calls its default export with a `DeployContext`. |
| `sdk` | **Types only.** `DeployContext`, `ServiceConfig` and friends. |
| `cli` | `@dldc/deployer-cli`: validates a `.tgz` and streams it over SSH. |
| `examples/hello` | A working deploy package: reconciles one whoami service on `:8081`. |
| `docker/runner-base` | The image that runs deploy packages (Node + harness only). |
| `plans/` | Architecture and design notes. |

## The package

A deploy repository builds and packs itself; the deployer never installs or
compiles anything. The artifact is the output of `npm pack`:

```
package/package.json
package/dist/deploy.js      ← entry, ESM, default export
package/assets/…            ← optional files the deploy code reads
```

```json
{
  "name": "hello-deploy",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/deploy.js",
  "files": ["dist"],
  "deployer": { "api": 1 }
}
```

```ts
import type { DeployContext } from "@dldc/deployer-sdk";

export default async function deploy({ service, wait, log, equal, run }: DeployContext) {
  log.info(`deploying from ${run.commit.slice(0, 12)}`);

  const live = await service.inspect("hello");
  if (live === null) await service.create("hello", config);
  else if (!equal(live.config, config)) await service.update("hello", config, live.version);

  await wait.serviceConverged("hello");
}
```

`DeployContext` is the artifact's whole runtime: service calls, waits, logs,
`equal`, the run identity, `packageDir`, and asset access (`readAsset`,
`readTextAsset`, `listAssets`, resolved against the package root so bundling
never moves them).

Rules enforced by both the CLI and the controller:

- gzipped npm tarball, entries under `package/`;
- `type: "module"`, entry inside the package, `deployer.api: 1`;
- no `dependencies` unless `node_modules/` is shipped (`bundledDependencies`,
  the escape hatch for native modules);
- otherwise no unresolved bare specifiers — bundle, or import packages with
  `import type`;
- limits: 20 MiB compressed, 64 MiB decompressed, 20 000 entries.

## Development

```sh
pnpm install
pnpm check        # format, lint, type-check
pnpm test
pnpm build        # controller + harness + sdk + cli, staged in build/npm and build/cli
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
| `DEPLOYER_DATA_DIR` | `.deployer` | Controller root: `repo/` (history) and `run/` (socket, scratch) |
| `DEPLOYER_SOCKET_PATH` | `<data dir>/run/deployer.sock` | Internal socket reached by runs |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker API socket |
| `DEPLOYER_RUNNER_IMAGE` | `deployer-runner-base:dev` | Image that runs deploy packages |

`DEPLOYER_DATA_DIR` must be a host path mounted at the **same** location in the
controller and in run containers: the controller hands Swarm bind mounts of
those paths, and the daemon resolves them on the host.

## Deploying

```sh
# in the deploy repository
pnpm build
npm pack --pack-destination artifacts

npx @dldc/deployer-cli deploy artifacts/*.tgz
```

The CLI validates the package locally (same code as the server, same messages),
prints a summary, streams the file over SSH to the host, forwards the run log,
and exits with the remote status. `--message`, `--host`, `--user`,
`--identity`, `--port` and `--dry-run` are available; `DEPLOY_HOST`,
`DEPLOY_USER`, `DEPLOY_KEY` and `DEPLOY_MESSAGE` are the environment
equivalents. The controller host and key are the only configuration.

The controller then:

1. decompresses and validates the package (a bad artifact is a 400, nothing is
   committed);
2. extracts it into the deploy repository and commits it — the history is the
   artifact tree, so `git show` is the record;
3. runs the runner image once with the package mounted read-only at `/deploy`:
   no network, no Docker socket, read-only root, `--cap-drop ALL`, non-root,
   512 MB, 1 CPU, 120 s;
4. revokes the per-run token and returns the log.

`/api/apply` builds nothing and installs nothing, so it does not need the
registry. Keep it private: bind it to `127.0.0.1` and let CI reach it over SSH
(see [deployer-sandbox](https://github.com/etienne-sandbox/deployer-sandbox),
which uses a key restricted to a single apply command).

## Docker

Build the controller image and the runner image:

```sh
pnpm docker:build   # ghcr.io/etienne-dldc/deployer:dev
pnpm base:build     # deployer-runner-base:dev (harness included)
```

```sh
DEPLOYER_DATA_DIR=/root/deployer-data docker run --rm \
  -p 127.0.0.1:8787:8787 \
  -e DEPLOYER_TOKEN=change-me \
  -e DEPLOYER_DATA_DIR=/root/deployer-data \
  -v /root/deployer-data:/root/deployer-data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ghcr.io/etienne-dldc/deployer:dev
```

`/api/apply` controls Swarm, so it is not meant to be public. In CI, do not
publish the port: run `ssh user@host 'deploy <message>'` with the package on
stdin and a small remote script that posts it to `127.0.0.1:8787`. Restrict the
key with `command="…/apply.mjs"` and `restrict` in `authorized_keys`, so it can
only deploy; the controller's token never leaves the host.

Rebuild the runner image whenever the harness changes (`pnpm base:build`).

## SDK

`@dldc/deployer-sdk` is types-only on purpose: deploy code imports it with
`import type`, the imports disappear at build time, and the artifact needs no
`node_modules`. A plain `tsc` build is therefore self-contained; a bundler works
too and produces a smaller artifact.

```sh
pnpm add -D @dldc/deployer-sdk
```

The wire contract is still the ts-api `Graph` in `sdk/graph.ts`; the harness
implements `DeployContext` on top of it inside the run container, and the
controller uses the same file as its resolver schema. The build copies it to
`dist/controller/graph.ts` for the deployed image.

## Publishing

One version, one `v*` tag, two packages, both with npm
[trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no
`NPM_TOKEN`, provenance attested):

| Package | Folder | Workflow |
| --- | --- | --- |
| `@dldc/deployer-sdk` | `build/npm` | `publish-sdk.yml` |
| `@dldc/deployer-cli` | `build/cli` | `publish-cli.yml` |

```sh
pnpm build && pnpm pack:sdk && pnpm pack:cli   # inspect both before tagging
git tag v0.2.0 && git push origin v0.2.0
```

The workflow finishing is not the same as the version being installable: npm can
take several minutes to serve a fresh tarball even after the version shows up.
Verify before announcing:

```sh
npm view @dldc/deployer-cli@0.2.0 dist.attestations.provenance.predicateType
npx @dldc/deployer-cli@0.2.0 --help
npm audit signatures
```

A new package needs its trusted publisher configured on npmjs.com (repository +
workflow file) and one manual first publish, like the SDK's `0.1.0`.

## Design

- [`plans/code-as-package.md`](./plans/code-as-package.md)
- [`plans/code-deployment-mvp.md`](./plans/code-deployment-mvp.md)
