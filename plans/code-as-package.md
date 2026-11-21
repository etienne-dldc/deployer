# Deployer — Code as a Package

Status: implemented in `0.2.0` (SDK + CLI aligned on one version).

## Why

The first design shipped a repository tar, committed it, built a Docker image
from the commit and ran the deploy script inside that image. That worked, but it
made the deploy path heavy and fragile:

- one ~560 MB image per commit (`deployer-run:<sha>`), plus build cache to GC;
- a `Dockerfile` in every deploy repo whose only purpose was to run the script;
- dependency installs on the deploy host, so registry availability, auth and
  `postinstall` scripts became deploy-time concerns;
- two bundlers (`ship.sh` and `deployer deploy`) with drifting exclusion lists.

The deploy artifact is now an **npm package tarball** and the controller runs it
in a fixed, sandboxed runner. Dependency resolution moved to CI, and the deploy
host never builds, installs, or contacts a registry.

## Artifact contract

Input to `POST /api/apply`: a gzipped npm tarball (`npm pack` / `pnpm pack`),
entries prefixed with `package/`.

```
package/package.json
package/dist/deploy.js       (entry, ESM)
package/dist/deploy.js.map   (optional, source maps)
package/assets/…             (optional, any files the deploy code reads)
```

`package.json`:

```json
{
  "name": "hello-deploy",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/deploy.js",
  "files": ["dist", "assets"],
  "deployer": { "api": 1 }
}
```

Rules, enforced identically by the controller and the CLI:

1. gzip tarball, every path under `package/`;
2. `type: "module"`, entry (`exports["."]`, then `main`) resolves to a file
   inside the package;
3. `deployer.api === 1`;
4. no `dependencies` unless `node_modules/` is shipped (`bundledDependencies`
   escape hatch for native modules);
5. no unresolved bare specifiers in shipped `.js`/`.mjs`/`.cjs` when
   `node_modules/` is absent — bundle, or import types with `import type`;
6. limits: 20 MiB compressed, 64 MiB decompressed, 20 000 entries, 1 024-byte
   paths.

Errors are `InvalidPackageError` and map to HTTP 400 before anything is
committed.

## Runtime contract

The entry default-exports an async function receiving a `DeployContext`
(types from `@dldc/deployer-sdk`; the SDK is types-only, so nothing resolves at
runtime):

```ts
export default async function deploy(ctx: DeployContext): Promise<void>;
```

`ctx`: `run` (`{ id, commit }`), `packageDir`, `log.{debug,info,warn,error}`,
`service.{list,inspect,create,update,remove}`, `wait.serviceConverged`,
`equal(a, b)`, `readAsset(path)`, `readTextAsset(path)`, `listAssets(dir)`.
Asset paths resolve against the package root, so bundling never moves them.

## Pipeline

```
npm pack → .tgz → ship (SSH) → controller
  → gunzip + validate (400 on failure)
  → extract into the deploy repo + git commit (history = artifact tree)
  → extract into run/work/<runId>/deploy
  → docker run <runner image>, package mounted read-only at /deploy
  → harness: import entry, build ctx, call default(ctx)
```

Runner: fixed image (`deployer-runner-base:dev`, `DEPLOYER_RUNNER_IMAGE`), no
network, read-only rootfs, no Docker socket, uid 1000, 512 MB / 1 CPU, 120 s,
`/repo` replaced by `/deploy`. The harness lives at `/opt/deployer/harness.mjs`.

## CLI

`@dldc/deployer-cli`, published from the same repo at the same version, zero
runtime dependencies, one `bin` (`deployer`).

```
deployer deploy <artifact.tgz> [--message <text>] [--host <host>] [--user <user>]
                               [--identity <key>] [--dry-run]
```

Reads the tarball, validates it locally with the shared artifact module, streams
it over SSH to `user@host` with the forced command `deploy <message>`, forwards
the run log and exits with the remote status. `DEPLOY_HOST`, `DEPLOY_USER`,
`DEPLOY_KEY`, `DEPLOY_MESSAGE` are the env equivalents. Default message is
`<name>@<version>`.

## Publishing

One version, one `v*` tag, two packages:

- `@dldc/deployer-sdk` → `build/npm` (`publish-sdk.yml`)
- `@dldc/deployer-cli` → `build/cli` (`publish-cli.yml`)

Both use npm trusted publishing (OIDC). The CLI needs its trusted publisher
configured on npmjs.com and one manual first publish.

## Migration

- `examples/hello`: plain ESM default export, no Dockerfile.
- `deployer-sandbox`: TypeScript + esbuild bundle, `npm pack`, CI calls
  `npx @dldc/deployer-cli@0.2.0 deploy artifacts/*.tgz`; `ship.sh` and the
  Dockerfile are deleted.
- Controller image: `artifact/` added to the build context; runner base image
  rebuilds to carry the harness.

## Acceptance

- `pnpm check`, `pnpm test`, `pnpm build` green.
- Second apply of the same artifact logs `up to date`; no service churn.
- No `deployer-run:*` images are created.
- Bad artifacts fail locally and remotely with the same message: no default
  export, non-function export, deps without `node_modules`, wrong `api`, entry
  outside the package, bare specifier left in `dist`.
- Isolation probe unchanged: no network, no Docker socket, timeout kills.
- Sandbox CI green from a push once `0.2.0` is published.
