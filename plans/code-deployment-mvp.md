# Deployer — MVP: One Repo, One Service

> **Status: implemented and accepted** on a real single-node Swarm (see
> [Acceptance run](#acceptance-run)). The smallest end-to-end slice that proves
> the code-as-deployment loop. Everything not needed to prove that loop is cut.

## Steps

- [x] Scaffold Node + pnpm; stage `@dldc/deployer-sdk` in `build/npm`; build the base runner image (publishing to npm is still pending, so the base image carries the staged SDK)
- [x] Tar → git commit → image build
- [x] Isolated run container + Unix socket + per-run token
- [x] Internal `service` primitives + convergence wait
- [x] Public apply API + CLI
- [x] `examples/hello` + acceptance script
- [x] Run the acceptance pass on a clean Swarm; record findings

## Acceptance run

Run on 2026-11-21 against a single-node Swarm manager (`Ubuntu 22.04`,
Docker 29.9.3, controller container on the host Docker socket, data dir
`/root/deployer-data`). Everything below was observed on that machine, not just
in unit tests.

| Scenario | Observed |
| --- | --- |
| First deploy | `run ...: success`; service `hello 1/1`; `curl :8081` returns `Name: hello` |
| Git history | one commit per deploy; a message given to the CLI becomes the commit subject (`second deploy: new greeting`) |
| Unchanged re-deploy | new commit; log says "hello is up to date"; service version unchanged |
| Changed spec | log says "updated hello"; `docker service inspect` shows the new env |
| Public token | no token → `401`; empty body → `400`; 22 MB body → `413` |
| Isolation | from inside the run: `uid=1000`, `CapEff: 0`, `NoNewPrivs: 1`, `Seccomp: 2`, rootfs `/app` → `EROFS`, `/repo` → `EROFS`, `/tmp` writable, no `/var/run/docker.sock`, outbound connect → `ENETUNREACH` |
| Build source | image built from `git archive <commit>`; a failing run still leaves its commit in history |
| Interrupted run | controller killed mid-run: the run container survived; after restart the log said `removed 1 orphan runs` and no `com.deployer.run` containers remained |
| Test suite | `DEPLOYER_TEST_DOCKER=1 pnpm test`: 68/68 passed, including the live Swarm suite |

Findings worth keeping:

- Docker 29 still accepts the classic `/build` API that dockerode uses, so the
  controller does not need the Docker CLI.
- `inspect` + `equal` was enough for `hello` with no normalization code: the
  env/labels/ports ordering was the only thing that needed care.
- The first acceptance run failed on a packaging bug, not a design one: the
  staged SDK's `dist/` was excluded by `.dockerignore`, so the deploy image had
  the SDK's manifest without its code. Everything else ran on the first try.

## Hypothesis

A deploy can be a **git commit plus a script** that runs against a thin Docker
API. The controller does not need to know what "correct" looks like:

- the repository owns reconciliation;
- the controller only stores commits, builds images, runs containers and applies
  low-level Docker operations;
- `inspect` + `equal` + `create/update` is enough to converge one service;
- the run is isolated enough that a broken deploy cannot take down the
  controller.

The MVP succeeds if one small service can be deployed, updated and re-deployed
from a git commit without a desired-state document, and debugged from `git log`
and the run log.

## Scope

| Area | MVP |
| --- | --- |
| Deploy trigger | `deployer deploy <dir>`: tar → `POST /api/apply` → commit → build → run |
| Controller | one host process, not a Swarm service; uses the host Docker socket |
| Target | one Swarm service (`hello`) from `examples/hello` |
| Execution | repo-supplied `Dockerfile`; ephemeral container; `--network none`; Unix socket; per-run token |
| SDK | published `@dldc/deployer-sdk` from npm; `q` query builder + `executeQuery` transport; no method facade |
| Primitives | `meta.*`, `service.inspect/create/update/remove`, `wait.serviceConverged` |
| State | live Docker inspect through the internal API; in-memory run result; git history |
| Auth | one static token for `/api/apply`, read from `DEPLOYER_TOKEN` in the controller environment; one token per run |
| Public surface | one route: `POST /api/apply`; no public graph |
| Transport | ts-api query (`{ path, args }`) over newline-delimited JSON on the internal Unix socket; public raw tar + JSON result |

### Out of scope

- configs, secrets, data folders, `store`, networks
- the public graph/read API (`service.inspect`, `run.list`, `run.get` over HTTP);
  only `/api/apply` is exposed
- multiple repos (the model is one repo); multiple services/environments and
  ordering between them
- controller in Swarm, bootstrap, edge/Caddy, backups, restore
- rollback, scheduler, UI, log streaming
- MessagePack/binary, image digests, image pruning
- default Dockerfile/override; building the deployed app image (the demo deploys
  a public image)
- durable run state/SQLite; the MVP keeps only the in-memory run result
- users/roles; one static public token

## The loop

```text
deployer deploy examples/hello
  └─ POST /api/apply  (Content-Type: application/x-tar)
       └─ controller
            ├─ extract tar, replace the worktree, git commit
            ├─ git archive <commit> → docker build → deployer-run:<sha>
            ├─ docker create → start → wait → logs → remove
            │    └─ SDK over /run/deployer/deployer.sock
            │         ├─ meta.version()          (version query)
            │         ├─ service.inspect("hello")
            │         └─ service.create / update
            └─ capture logs; return result
  └─ { runId, commit, status, logs }
```

The controller runs on the host for the MVP. It owns the host Docker socket; the
run container does not. `docker swarm init` is a one-time setup step.

The MVP deliberately has **one repo** and **one deploy entrypoint**. `repo` is
not an API parameter: everything is committed to `.deployer/repo` and the image
runs its one `start` command. The model stays single-repo: one history per
environment, no registry and no per-repo scoping. A single repo can still contain
multiple services later.

## Minimal API

### Internal (Unix socket, per-run token)

| Method | Result |
| --- | --- |
| `meta.version()` | protocol version; deploy code may check it first |
| `meta.run()` | `{ id, commit }` |
| `meta.log(level, message)` | append to the run's captured log |
| `service.inspect(name)` | `{ config, version } \| null` |
| `service.create(name, config)` | `{ version }` |
| `service.update(name, config, { version })` | `{ version }`; rejects a stale version |
| `service.remove(name)` | removes the service |
| `wait.serviceConverged(name, { timeoutMs })` | resolves when all tasks are running |

### Public (one route)

| Route | Input | Result |
| --- | --- | --- |
| `POST /api/apply[?message=<text>]` | raw tar body (`application/x-tar`), bearer token | `{ runId, commit, status, logs }` |

The route requires `Authorization: Bearer <token>`. The controller compares it
to `DEPLOYER_TOKEN` from its environment; the CLI sends the same variable.
The token is never in the tar, the repo, or the run container. In the MVP the
controller is a host process; when it is containerized, the token is passed as
an env var to the deployer container.

There is no public graph in the MVP. The CLI submits the tar and prints the
result; `git log` is the persistent debugging surface, and the apply response
carries the run logs. Runs are serialized by an in-process queue.

## SDK surface

The SDK is a thin ts-api client. It does not hand-write a `DeployerApi`, a
`connect()` object, or per-resource method wrappers. The callable API is exactly
the `Graph` tree.

Runtime exports:

| Export | Shape | Role |
| --- | --- | --- |
| `q` | `TQueryOf<{ Graph: Graph }>` | typed query builder; every RPC path starts at `q.Graph` |
| `executeQuery(query, options?)` | `<T>(TQuery<T>, options?) => Promise<T>` | one RPC over the internal socket |
| `equal(a, b)` | `(unknown, unknown) => boolean` | deep compare for `inspect().config` |

Type exports: `Graph`, `ServiceConfig`, `ServiceState`, `ServiceVersion`,
`RunInfo`, `WaitServiceOptions`, `LogLevel`, `EnvVar`, `Label`, `ServicePort`,
and `ExecuteQueryOptions`.

The repository is a single package. `sdk` and `controller` share one
`package.json` and one version; `pnpm build` emits `dist/sdk` and
`dist/controller`. `scripts/stage-sdk.ts` creates `build/npm` with the SDK-only
`dist/`, a generated `package.json`, and README. Its dependency list comes from
the imports in the emitted `.mjs` and `.d.mts` files, not from the source or a
hand-maintained list. Controller-only dependencies stay in `devDependencies`
and are bundled into the controller output.

```js
import { executeQuery, q } from "@dldc/deployer-sdk";

const live = await executeQuery(q.Graph.service.inspect("hello"));
```

- `executeQuery` is the only transport entry point. It extracts ts-api's
  `{ path, args }`, sends one newline-delimited JSON request
  (`{ token, path, args }`), and returns the parsed result.
- It reads `DEPLOYER_SOCKET` and `DEPLOYER_RUN_TOKEN`. The optional `options`
  argument exists for host-run tests and overrides those two values only.
- `meta.version()` is available on the graph but is not an automatic handshake
  in the MVP. A run script may call it first; an `assertVersion` helper can be
  added later without changing the query surface.
- `readRepoFile` and `diff` are not in the MVP surface. The repository is
  mounted at `/repo`; plain `fs` works. `equal` is the only comparison helper.

## `ServiceConfig` v0

```ts
type ServiceConfig = {
  image: string;
  replicas: number;              // required in v0
  command?: string[];
  env?: { name: string; value: string }[];
  ports?: { target: number; published: number }[];
  labels?: { name: string; value: string }[];
};
```

`env` and `labels` are arrays of `{ name, value }` because ts-api has no
index signatures; `toSwarm` converts them to Swarm maps internally.

`toSwarm` / `fromSwarm` handle only these fields. Empty optional fields are
omitted, so a live inspect and a desired object compare cleanly. `fromSwarm`
drops Docker defaults and returns the deployer's type; `service.update` requires
the `version` from `inspect`.

## Demo: `examples/hello`

The repo's `Dockerfile` builds the **deploy code** image from the base image and
installs `@dldc/deployer-sdk` from npm like any other dependency. The service it
manages runs a public image, so the MVP does not need an app image build.

```js
import { equal, executeQuery, q } from "@dldc/deployer-sdk";

const name = "hello";
const desired = {
  image: "traefik/whoami:v1.10",
  replicas: 1,
  env: [{ name: "WHOAMI_NAME", value: "hello" }],
  ports: [{ target: 80, published: 8081 }],
};

const live = await executeQuery(q.Graph.service.inspect(name));

if (live === null) {
  await executeQuery(q.Graph.service.create(name, desired));
  await executeQuery(q.Graph.meta.log("info", "created hello"));
} else if (!equal(live.config, desired)) {
  await executeQuery(
    q.Graph.service.update(name, desired, { version: live.version }),
  );
  await executeQuery(q.Graph.meta.log("info", "updated hello"));
} else {
  await executeQuery(q.Graph.meta.log("info", "hello is up to date"));
}

await executeQuery(
  q.Graph.wait.serviceConverged(name, { timeoutMs: 60_000 }),
);
```

Commands:

```sh
docker swarm init            # once
pnpm install
pnpm base:build              # deployer-runner-base:dev
export DEPLOYER_TOKEN=dev
pnpm start                   # controller on :8787
pnpm run deploy examples/hello   # creates the service
curl http://localhost:8081       # whoami
pnpm run deploy examples/hello   # up to date; no service update

git -C .deployer/repo log --oneline
```

Changing `WHOAMI_NAME` and re-deploying must update the service and change the
`curl` response.

## Acceptance

| Scenario | Expected |
| --- | --- |
| First deploy | service created; `curl :8081` answers; git has a commit; run succeeds |
| Git history | one commit per deploy; `git show` displays the changed files |
| Unchanged re-deploy | new commit; service version unchanged; log says "up to date" |
| Changed spec | service updated; `curl` shows the new name |
| Stale update | an update with an old `version` is rejected; no overwrite |
| Deploy code throws | run marked failed; service unchanged; controller still answers |
| Wrong/missing public token | `/api/apply` rejected; no run |
| Wrong/missing run token | internal call rejected; no Docker call |
| Scope separation | the public token cannot reach the internal socket; the run token cannot call `/api/apply` |
| Public surface | `POST /api/apply` is the only public route; graph paths return 404 |
| Version query | deploy code can call `meta.version()`; automatic mismatch handling is a later helper |
| Isolation | run container has no network, no Docker socket, read-only rootfs, non-root, and is gone after the run |
| Run result | apply response carries logs; no JSONL or SQLite run store yet |
| Remove | internal test removes `hello`; subsequent `inspect` returns `null` |
| Interrupted run | after a controller restart, orphan run containers are removed; there is no persisted run state to reconcile |

## Implementation notes

- **Base image:** `node:26-slim` + pnpm; tag `deployer-runner-base:dev`. It
  carries the staged SDK at `/opt/deployer-sdk` for the moment, because the
  package is not published yet; deploy repos install it as
  `file:/opt/deployer-sdk`. Once `@dldc/deployer-sdk` is on npm, drop the copy
  and the base image stays generic.
- **Public route:** `POST /api/apply[?message=<text>]` accepts the raw tar body
  (`application/x-tar`), checks the bearer token against
  `DEPLOYER_TOKEN`, and returns the run result. The controller refuses to
  start if the token is unset. It is the only public route; there is no public
  graph. Never pass this token to the run container.
- **Root:** `DEPLOYER_DATA_DIR` (default `.deployer/`): `repo/` for git and
  `run/` for the socket and scratch space. The path must be mounted at the same
  location in the controller and in run containers, because the controller hands
  Swarm bind mounts to the Docker daemon. No run log; SQLite is the next step.
- **Git:** one normal repo at `.deployer/repo`; replace the worktree,
  `git add -A`, `git commit --allow-empty`. The build context is
  `git archive <commit>`, so the image matches the commit exactly.
- **Run:** `--network none`, `--read-only`, `--tmpfs /tmp`, `--cap-drop ALL`,
  `--security-opt no-new-privileges`, `--memory 512m`, `--cpus 1`,
  `--user 1000:1000`, 120 s timeout, label `com.deployer.run=<runId>`. Mount the
  repo at `/repo:ro`, scratch at `/work`, and the socket directory at
  `/run/deployer`. On startup, remove orphan containers carrying the run label.
- **Socket:** `.deployer/run/deployer.sock`, mounted at
  `/run/deployer/deployer.sock`. For the single-tenant MVP the socket is mode
  `0666` and the scratch dir `0777`; tighten the ACL after the slice.
- **Logs:** stdout/stderr and `meta.log` are captured in memory and returned with
  the apply result. No JSONL and no SQLite; `git log` is the only persisted
  history for now.
- **Tar:** the CLI sends the tar as the raw request body and excludes `.git`,
  `node_modules`, `.deployer`; the controller caps it at 20 MB. The controller
  parses the tar itself: absolute paths, `..`, links, device nodes, duplicate
  entries and truncated payloads are rejected, and the whole archive is validated
  before anything is written, so a bad archive leaves the worktree untouched.
  It accepts ustar prefixes, pax extended headers and GNU long names, which is
  what `git archive` and `tar` emit.
- **Failures:** a build failure, a non-zero run or a timeout marks the run failed
  and keeps the applied changes; re-running the commit is safe.

## Risks and what we learn

- **Unix socket on Docker Desktop is the main unknown.** Bind-mounting a host
  Unix socket into a Linux container and connecting as a non-root user may be
  flaky on macOS. If it fails, the fallback is to run the controller in a
  container sharing a Docker volume for `.deployer/run`; record which path works.
  Production remains a host path on Linux.
- **Build from `git archive`:** confirms the commit, not the worktree, is what
  gets built.
- **`inspect` + `equal`:** does the canonical subset feel natural, or does every
  repo need normalization code?
- **Run ergonomics:** build time, image size, and whether `--network none` + the
  socket is enough for real deploy scripts.
- **Debugging:** whether `git log` + the returned run logs are actually enough to
  diagnose a failed deploy.

## After the MVP

1. SQLite run log/state, replacing the in-memory run result.
2. Publish `@dldc/deployer-sdk` and drop the `/opt/deployer-sdk` copy from the
   runner base image.
3. Image garbage collection: `deployer-run:<commit>` images accumulate one per
   deploy.
4. Configs and secrets (env injection) on the same service.
5. Managed data folders and mounts.
6. Networks and two-service ordering (app + edge).
7. MessagePack/binary and image digests.
8. Controller in Swarm, bootstrap, self-hosting.
9. Public read graph/UI, log streaming, rollback/restore/backups.
10. Multiple deploy entrypoints within the one repo, if run granularity becomes a
    problem.
