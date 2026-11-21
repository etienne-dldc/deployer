# Deployer — Code-as-Deployment Architecture

> A headless engine that owns a Docker Swarm. Each environment has **one deploy
> repository**: its code executes against the live system through a
> controller-provided API. This document describes the architecture, the
> decisions behind it, and the open questions.

## Steps

- [ ] Scaffold Node + pnpm
- [ ] Publish `@dldc/deployer-sdk` from `build/npm`: `q` + `executeQuery` + `equal`; version check is a later helper
- [ ] Internal Unix-socket endpoint (shared host volume) + per-run token
- [ ] MessagePack internal transport + `Uint8Array` builtin
- [ ] Config/secret versioning (`put` / `rotate` / `stale`)
- [ ] Container build + run pipeline (default Dockerfile, Dockerfile override, hardening, tagging)
- [ ] Git commit flow (extract tar → deploy repo → commit)
- [ ] `ServiceConfig` type + `toSwarm` / `fromSwarm`
- [ ] Low-level primitives (service / network / config / secret / data) + deploy-code reconcile
- [ ] Repo mounted read-only at `/repo`, writable `/work` (`readRepoFile` is a later optional helper)
- [ ] Managed data folders (`create` / `files.*` / `sync`) + bind mounts
- [ ] Key/value store (`get` / `set` / `delete` / `list`)
- [ ] `init` command for out-of-band bootstrap
- [ ] Edge (Caddy) as an ordinary service in the one repo
- [ ] Rollback (re-run previous commit) + restore on a blank host

---

## 1. Principles

- **Git is in the loop.** Every deploy is a commit in the deploy repository.
  `git log` is the history and the debugging UI.
- **One deploy repository per environment.** All deploy code lives in it,
  including the edge and the controller's own service. There is no repo id,
  registry or cross-repo scoping; one history is the system history.
- **Code-as-deployment.** Instead of writing down the state we want, we write
  code that executes on the server: "if it does not exist, create; if it
  changed, update."
- **Reconciliation belongs to the repository.** The controller exposes
  primitives; the code decides when to create, update or remove.
- **No writes to Docker except through the controller.** Executing code reaches
  Docker only through the controller's internal API — never a raw socket.
- **Restore, not reconcile.** Rebuilding a blank host is a capability: run the
  repository's terminal code against an empty Docker.
- **The controller is generic.** It only manipulates Docker. There are no
  privileged components and no special-cased services — Caddy, observability,
  and the controller itself are ordinary services.
- **Bootstrap and recovery are out-of-band.** A new server is brought up by an
  idempotent `init` run; a broken controller, edge, or app is recovered over
  SSH. The system does not protect itself from its own deployments.
- **Live Docker and stored state are both exposed.** Each use case picks the one
  that fits (§5.2).

---

## 2. Deploy flow

```
receive tar (deploy repository source: package.json, lockfile, src, optional Dockerfile)
  1. extract locally
  2. commit to the deploy repository     (git history = free)
  3. build the deploy image              (Docker API, tar as build context)
  4. run the image                       (ephemeral container, isolated)
  5. record the run + expose state via the API
```

The deployable is the **deploy repository's source**, received as a tar. By
default it is a Node project with a `start` script; a repository that needs
another runtime ships a `Dockerfile`. The repository can manage any number of
services; one repository is not one service.

---

## 3. Components

| Component | Responsibility |
| --- | --- |
| **Controller** | Public + internal API, apply primitives, run log, scheduler, backup engine, secret store; Docker object graph and managed data folders |
| **SDK** (`@dldc/deployer-sdk`) | `q`, `executeQuery`, `equal`, and the ts-api `Graph`/config types; no hand-written method facade |
| **Run container** | The executed code; reaches the controller over the internal socket |
| **Docker Swarm** | The only projection target — services, networks, configs, and bind-mounted data folders |

There is no platform layer. The edge proxy, observability, and the controller
itself are ordinary services managed by the one deploy repository's code (§10).

---

## 4. Runtime & toolchain

| Decision | Choice | Why |
| --- | --- | --- |
| Runtime | **Node.js + pnpm** | Project baseline. |
| SDK | **Published npm package** | ts-api `Graph` types plus one transport function; generated clients and method facades are not part of the surface. |
| Execution | **Container** | Crash, filesystem and privilege isolation; reproducible; no host toolchain. |

### 4.1 Execution contract

- **Default:** the deployer builds on a controller-owned base image.

  ```dockerfile
  FROM node:26-slim
  WORKDIR /app
  COPY package.json pnpm-lock.yaml* ./
  RUN corepack enable && pnpm i --prod
  COPY . .
  CMD ["pnpm", "start"]
  ```

- **Override:** a repository `Dockerfile` is used instead when present (system
  packages, another runtime).

The base image pins the toolchain, which is what makes restore-on-a-blank-host
reproducible.

### 4.2 Run hardening

The deploy run is an **ephemeral `docker run`**, not a Swarm service:

- `--rm`, a wall-clock timeout, and `--memory` / `--cpus` caps.
- `--network none` — the script can reach the internal socket and nothing else
  (no internet, no public API).
- Non-root user; `--read-only` with `--tmpfs /tmp`.
- The extracted repository is mounted **read-only at `/repo`** so the code can
  read templates and assets regardless of the image's `COPY` rules (§5.6).
- A host-backed scratch folder is mounted **read-write at `/work`** (owned by the
  run user, removed after the run) so the code can generate files for `data.sync`
  (§5.8).
- Label `com.deployer.run=<run-id>` so throwaways are never mistaken for managed
  services.
- stdout/stderr are captured as the deploy log.

### 4.3 Build & tagging

- Build through the **Docker API**, using the received tar as the build context.
- Tag `deployer-run:<git-sha>` so an image is tied to the commit that produced it.
- Reuse the layer cache; prune old tags.

### 4.4 SDK surface

The SDK is a thin client over the same ts-api `Graph`. It deliberately does not
hand-write a `DeployerApi`, a `connect()` object, or per-resource method
wrappers. The callable API is exactly the `Graph` tree.

| Export | Shape | Role |
| --- | --- | --- |
| `q` | `TQueryOf<{ Graph: Graph }>` | typed query builder; every RPC path starts at `q.Graph` |
| `executeQuery(query, options?)` | `<T>(TQuery<T>, options?) => Promise<T>` | one RPC over the internal socket |
| `equal(a, b)` | `(unknown, unknown) => boolean` | deep compare for `inspect().config` |

Type exports: `Graph`, `ServiceConfig`, `ServiceState`, `ServiceVersion`,
`RunInfo`, `WaitServiceOptions`, `LogLevel`, `EnvVar`, `Label`, `ServicePort`,
and `ExecuteQueryOptions`.

The repository is a single package. `sdk` and `controller` share one
manifest and version; `pnpm build` emits `dist/sdk` and `dist/controller`.
`scripts/stage-sdk.ts` creates `build/npm` with the SDK-only `dist/`, README,
and a generated `package.json`. The dependency list is extracted from the
emitted `.mjs` and `.d.mts` imports, so controller-only dependencies stay in
`devDependencies`, are bundled into the controller output, and never reach npm
consumers. The npm tarball is packed from `build/npm`, not from the repository
root.

`executeQuery` extracts ts-api's `{ path, args }`, sends
`{ token, path, args }` over the configured transport, and returns the parsed
result. It reads `DEPLOYER_SOCKET` and `DEPLOYER_RUN_TOKEN`; `options` exists for
host-run tests and overrides only those two values. In the MVP the transport is
newline-delimited JSON over the Unix socket. MessagePack is a later transport
change behind the same function, not a new SDK shape.

Not part of the surface: `connect`, `DeployerApi`, `readRepoFile`, `diff`, and an
automatic version assertion. Later helpers must stay thin functions over `q` and
`executeQuery`; they must not introduce a second method shape. `equal` is the one
comparison helper the MVP ships.

---

## 5. API

The controller exposes **two ts-api RPC endpoints** over the same graph and
validation layer. They are **two auth scopes over one graph**, not two
disconnected APIs.

- **Internal:** MessagePack over the Unix socket. Binary is native, and the
  payloads are machine-to-machine.
- **Public:** JSON (SuperJSON) so `curl`, logs and the browser stay readable.
  Binary endpoints stay internal.

MessagePack has no `undefined` or `BigInt`: optional fields are omitted or
`null`, and timestamps are ISO strings.

| Endpoint | Reachable by | Auth | Surface |
| --- | --- | --- | --- |
| **Public** (`POST /api/graph`) | UI / CLI | User token | Read state + one-time actions (restart, rollback, force-update, run-backup, set/rotate secret) |
| **Internal** | Only the executing repo container | Per-run token | Low-level Docker primitives (§5.3) |

The per-run token maps server-side to the restricted internal handler set; a
leaked internal token cannot reach the public write surface.

The public token is supplied to the controller as an environment variable
(`DEPLOYER_TOKEN`); it is never stored in the deploy repository or passed
to the run container. The MVP uses a single static token; user accounts come
later.

### 5.1 Routing is userland

The controller has no HTTP opinion. A service that must be reachable sets labels
(e.g. `edge.host`, `edge.port`) in its own spec. The edge proxy is an ordinary
service whose deploy code reads those labels and renders the config it manages.
Replacing Caddy with another proxy is then an edge deploy-code change, not a
controller change.

### 5.2 Live inspect vs. stored state

Both sources are exposed. Neither is "the" truth; each answer has a use case.

| Question | Source |
| --- | --- |
| What does this object look like right now? | **Live inspect** |
| What `version` do I pass for an optimistic update? | **Live inspect**, at apply time |
| Has it drifted from what the code wants? | **Live**, compared by the repository |
| Is the service behind the current config/secret version? | **Live inspect** (`stale`) |
| What should the UI show instantly? | **Stored** (cached projection) |
| Who deployed what, when, and did it succeed? | **Stored** (append-only run log) |
| What is the last known-good commit to roll back to? | **Stored** (run log) |
| Did the secret I want change? (values stay in the controller) | **Stored** hash |

Stored state is an **append-only run log** (run id, commit, timestamps, outcome,
logs, objects touched) plus per-object metadata where Docker cannot answer
(secret hashes). It is history and a cache — not a required diff anchor.

### 5.3 Internal primitives

The internal API is deliberately low-level: it exposes Docker operations, not
reconciliation. The repository decides what to do.

| Namespace | Methods |
| --- | --- |
| `meta` | `version()` · `run` {id, commit, environment} · `log(level, msg)` |
| `service` | `inspect(name)` → `{ config, version, tasks, stale }` \| null · `list()` · `create(name, config)` · `update(name, config, { version })` · `remove(name)` |
| `network` | `inspect(name)` · `list()` · `create(config)` · `remove(name)` |
| `config` | `put({ name, data })` → `{ version, changed }` · `putFile({ name, path })` · `inspect(name)` · `remove(name)` |
| `secret` | `generate(name)` · `rotate(name)` · `inspect(name)` · `remove(name)` |
| `data` | `list()` · `inspect(name)` · `create(name)` · `remove(name, { recursive? })` · `sync(...)` |
| `data.files` | `list(name, path?)` · `stat(name, path)` · `read(name, path)` · `write(name, path, data)` · `mkdir(name, path)` · `remove(name, path, { recursive? })` |
| `store` | `get(key)` · `set(key, value)` · `delete(key)` · `list(prefix?)` · `clear()` |
| `wait` | `serviceConverged(name, { timeout })` |
| `image` | `resolve(ref)` → digest |

- `update` requires the `version` returned by `inspect` (optimistic locking).
- `inspect` returns the deployer's own type — never a Swarm spec.
- **Secrets never enter the repository or the run.** Specs reference them by
  logical name; the controller resolves the value from its store and injects it
  as an environment variable at apply time. `generate` creates a value only if
  the name is missing; `rotate` replaces it deliberately. Setting a value is an
  admin action on the public API.
- **No Docker secrets.** Env injection is the chosen delivery, so there is no
  immutable secret object in Swarm to version or prune. The controller store is
  the only authoritative copy. A live service spec also carries the injected
  value, but it is not a backup: the service may be removed, and the label
  records only the version. Backing up the store is mandatory, not best-effort.
- **Env values are stripped on the way back.** `toSwarm` writes an internal
  service label mapping each injected `env` name to its logical secret and
  version; `fromSwarm` removes those env keys and returns the logical `secrets`
  list. The label is namespaced (`com.deployer.*`) and is removed from the
  returned `labels` along with the other internal metadata. It carries no value.
- **Redaction.** Secret values are materialized only in the Swarm spec at apply
  time. The run log, `inspect`, diffs and the public API carry the logical name
  and version, never the value. Docker API access remains the trusted boundary.
- **Configs are content-addressed by the controller.** `put` hashes the data,
  creates an immutable version and moves the logical pointer. Unchanged content
  returns the existing version with `changed: false`. Config objects carry the
  logical name as a label, so the pointer map can be rebuilt from Docker if the
  database is lost.
- **No auto-repoint.** Writing a config or rotating a secret does not restart
  consumers. `service.create` / `update` resolves logical names to the current
  versions at apply time; `inspect` reports `stale` when the live service still
  references an older version (§5.5).
- **Binary is a first-class type.** `Uint8Array` is registered as a ts-api
  builtin and travels natively over MessagePack. Large payloads still go through
  `data.sync`, never through an RPC.
- `image.resolve` runs in the controller because the run has no network.
- `data` folders are managed directories under `DATA_DIR/data` (§5.8). The
  controller manipulates them directly, so there is no helper container and no
  Docker volume in between.

### 5.4 The service type

The repository writes a `ServiceConfig`, the deployer converts it to and from a
Swarm `ServiceSpec`:

```ts
type ServiceConfig = {
  image: string;                 // tag or digest
  replicas?: number;
  command?: string[];
  env?: { name: string; value: string }[];
  secrets?: { name: string; env: string }[];
  configs?: { name: string; target: string }[];
  mounts?: { data: string; target: string; readOnly?: boolean }[];
  networks?: string[];
  ports?: { target: number; published?: number }[];
  labels?: { name: string; value: string }[];
  resources?: { cpus?: string; memory?: string };
  healthcheck?: { test: string[]; interval?: string; retries?: number };
  update?: { parallelism?: number; failureAction?: "pause" | "rollback" | "continue" };
  restart?: { condition?: "none" | "on-failure" | "any" };
};

toSwarm(config): ServiceSpec      // ServiceConfig -> Swarm
fromSwarm(spec): ServiceConfig    // Swarm -> ServiceConfig
```

`env` and `labels` are arrays of `{ name, value }` because ts-api has no
index signatures; `toSwarm` converts them to Swarm maps internally.

`fromSwarm` is what makes the repository's comparison exact: Docker's defaults,
nulls and reordering are absorbed inside the deployer, so the code compares its
own type against its own type. It also resolves concrete config IDs back to their
logical names and strips injected secret env values, so the repository never
compares opaque Swarm IDs or sees a secret.

`mounts` reference data folders by name (§5.8). The deployer resolves
`{ data: "uploads" }` to a bind mount of `DATA_DIR/data/uploads`; the folder must
already exist, so the code calls `data.create("uploads")` first.

A secret is injected as the named environment variable at apply time. The
repository only supplies `{ name, env }`; the controller resolves the value from
its store, writes it into the Swarm spec, and records `{ env, name, version }` in
an internal service label so `fromSwarm` can strip it and return the logical
reference. The value is therefore in the service spec and visible to anyone with
Docker API access — the accepted trade-off for not dealing with `_FILE`. Keep it
out of logs, diffs, `inspect` and the UI. A secret's `env` name must not collide
with an entry in `env`; the controller rejects the config instead of letting one
silently overwrite the other. `com.deployer.*` labels are reserved for this
metadata; the controller rejects them in `ServiceConfig.labels`. Configs are
always files: they are not secret, and multi-line content does not belong in an
environment variable.

### 5.5 Semantics

- **Full replacement.** `update` applies the config as the complete managed
  subset. Fields outside the type are not preserved; the controller owns the
  service.
- **Concurrency.** Runs are serialized by the controller; the `version` guard
  catches out-of-band changes.
- **Comparison.** The repository deep-equals its desired config against
  `inspect().config` with the SDK's `equal`. A `diff` helper is optional and not
  part of the MVP surface; the decision stays in the repository.
- **Config/secret drift.** `inspect` returns `stale: true` when the live service
  references an older config/secret version than the controller's current
  pointer. The repository updates on `!live || live.stale || !equal(...)`. This
  closes the window where `config.put` succeeds and the service update does not.
  `stale` covers config/secret versions, not image tags.

### 5.6 Files

The deploy code runs from the repository, but the image's `COPY` rules are not a
reliable contract for non-code assets. The controller therefore mounts the
extracted repository **read-only at `/repo`** in the run container, plus a
host-backed `/work` folder for anything the code generates. In the MVP plain
`fs` reads `/repo`; a `readRepoFile(path)` helper is a later optional addition,
not part of the current SDK surface.

Delivering a file to a **service** is separate: the service never sees the
deploy repository.

| File | Mechanism |
| --- | --- |
| Small text/binary, non-secret | `config.put({ name, data })` or `config.putFile({ name, path })`; mounted read-only at the target |
| Sensitive | Controller secret store; injected as an env var at apply time |
| Large or static | Baked into the service image at build time |
| Large or mutable at runtime | A **data folder** (§5.8): `data.sync` / `data.files.write`, bind-mounted into the service |

Swarm stores configs in the Raft log, so they are size-limited; `put` rejects
oversized data with a clear error instead of failing later. Secret values are
env vars, bounded by the platform's environment limit rather than the Raft log.
There is no general host-filesystem API: `data.*` is confined to `DATA_DIR/data`.
The internal transport is MessagePack, so `Uint8Array` crosses the socket as
bytes rather than base64; the public JSON endpoint does not expose binary.

### 5.7 Arbitrary data

A key/value store in the controller, for facts the code must remember between
runs but that Docker cannot answer.

```ts
store.get<T = JsonValue>(key): Promise<T | null>
store.set(key, value: JsonValue): Promise<{ version: number }>
store.delete(key): Promise<boolean>
store.list(prefix?): Promise<{ key: string; updatedAt: string; version: number }[]>
store.clear(): Promise<void>
```

- **Scoped to the environment.** One controller serves one environment and one
  deploy repository, so the store is a single namespace. There is no repo id;
  the run token authorizes the run, not a repository. A run cannot read another
  environment's data because each environment has its own controller and store.
- **JSON values.** Binary belongs in a data folder or a config, not in the
  store; the store stays queryable and UI-friendly.
- **Facts, not desired state.** The store is for the chosen image digest, a
  generated identifier, a migration marker, an external resource id. Using it to
  remember what should exist recreates the hidden-state problem the architecture
  avoids.
- **Restore.** The store lives in SQLite and returns with a database restore. A
  code-only rebuild starts empty, so code must tolerate missing keys.
- **Audit.** `set` and `delete` are recorded in the run log as key, action and
  value hash — not the value itself.
- **Limits.** Per-value and total quotas, enforced by the controller.

### 5.8 Data folders

A **data folder** is a directory the controller owns under
`DATA_DIR/data/<name>`. A service mounts it by name, and the deployer turns that
into a bind mount. The controller already has `DATA_DIR` mounted — the socket
lives there (§6) — so it can create and populate a folder directly. No helper
container, no Docker volume in between.

```ts
data.list(): Promise<{ name: string; path: string; size: number }[]>
data.inspect(name): Promise<{ name: string; path: string; size: number } | null>
data.create(name, { owner?, mode? }?): Promise<void>
data.remove(name, { recursive?: boolean }): Promise<void>

data.files.list(name, path?): Promise<{ name: string; type: "file" | "dir"; size: number; mode: number }[]>
data.files.stat(name, path): Promise<{ type: "file" | "dir"; size: number; mode: number; mtime: string } | null>
data.files.read(name, path): Promise<Uint8Array>
data.files.write(name, path, data: Uint8Array | string, { owner?, mode? }?): Promise<void>
data.files.mkdir(name, path, { owner?, mode? }?): Promise<void>
data.files.remove(name, path, { recursive?: boolean }): Promise<void>

data.sync(name, {
  from: string,              // "/repo/..." or "/work/..."
  to?: string,               // inside the folder, default "/"
  delete?: boolean,          // remove entries absent from the source
  owner?: { uid: number; gid: number },
  mode?: string,
}): Promise<{ files: number; bytes: number }>
```

- **Two sources per run.** `from` resolves against the deployed repository at
  `/repo` or the run's scratch folder at `/work` — never an arbitrary host path.
  Symlinks are rejected and `to` cannot escape the folder, because the controller
  is the one walking the tree on the host.
- **Contents, not the directory.** `from` is a directory and its contents are
  copied into `to` (`cp -a src/. dst/`), so `/repo/seed` fills the folder root
  rather than creating `/seed`.
- **Committed assets or generated files.** `data.sync("uploads", { from:
  "/repo/seed" })` copies what is in git; content produced by the code is written
  to `/work` and synced the same way.
- **Additive by default.** `sync` creates directories and overwrites files but
  leaves unrelated files alone, which is what a data directory a service also
  writes to needs. `delete: true` makes it an exact mirror; reserve it for fully
  managed content.
- **Ownership is explicit.** The controller writes the files, so `owner` and
  `mode` set the uid/gid and permissions the service needs. A root-owned file in
  a folder mounted by a non-root service is the failure to avoid.
- **In place, not atomic.** A running service holds a bind mount to the folder's
  inode, so swapping the directory would not update the mount. `sync` writes in
  place; for a mirror, the controller removes entries missing from the source and
  then copies, so a service can observe a partial tree. Update the service after
  a mirror, or make the code tolerate it.
- **Small files over RPC.** `files.read` and `files.write` accept
  `Uint8Array | string` and are capped at a few MiB. The internal transport is
  MessagePack, so bytes are native; `sync` remains the path for large trees
  because it never moves bytes through the API.
- **Mounting.** `mounts: [{ data: "uploads", target: "/app/uploads" }]` is a bind
  mount of `DATA_DIR/data/uploads`. The folder must exist: `service.create` /
  `update` fails with a clear error if it is missing, so the code calls
  `data.create` first (idempotent). Folder names are global, like service names.
- **Not for secrets.** A data folder is a plaintext directory. Secrets are
  injected as env vars; small immutable files use configs.
- **Backups.** Folders live under `DATA_DIR`, so the backup engine can include
  them; which folders are backed up is a policy question (§8.1).

Single-node assumption: the folder is a host directory and the bind mount is
resolved on the node. The socket design already requires the run and the
controller to share a host, so this adds no new constraint. It also requires
`DATA_DIR` to be a host path mounted at the same location in the controller, so
the path the deployer passes to Swarm is the one the node sees.

---

## 6. Transport: host-local socket + per-run token

- The internal endpoint binds a **Unix socket**, distinct from the public HTTP
  listener.
- Auth is a **per-run token**: single-use, short-lived, minted at apply time,
  revoked when the run ends or times out.
- The socket is the *reachability* fence; the token is the *identity* gate. Both
  are required — the socket alone does not stop another process under the same
  uid.

**Socket on a shared host volume.** The controller runs in a container, and
`docker run -v` can only mount a host path. The socket therefore lives on a
host-mounted volume (`DATA_DIR/deployer.sock`), mounted at the same path in the
controller and the ephemeral deploy container. This keeps `--network none`
valid — a Unix socket is a filesystem mount, not networking — so the script can
reach exactly the internal API and nothing else.

- **uid/gid:** the deploy container's user must be able to open the socket; run
  it as a non-root user matching the socket's owner/group, or `chown` it.
- **macOS:** bind-mounting a Unix socket through Docker Desktop's VM is finicky.
  Local development can run the deploy process on the host against the same
  socket, or use loopback TCP through a later `executeQuery` transport option.
  The MVP only supports the Unix socket.

### 6.1 `pnpm start` contract

```sh
DEPLOYER_SOCKET=... DEPLOYER_RUN_TOKEN=... pnpm start
```

1. Read `DEPLOYER_SOCKET` + `DEPLOYER_RUN_TOKEN` from the environment.
2. `const version = await executeQuery(q.Graph.meta.version());`
3. Drive the controller via the primitives (§5.3).
4. Exit 0 on success, non-zero on failure; the controller times out and revokes
   the token either way.

---

## 7. Version query

The internal graph exposes a **`version()`** RPC. The SDK exposes it as
`q.Graph.meta.version()`; it does not perform an automatic handshake in the MVP.
Deploy code may check it first. A later `assertVersion` helper can compare the
controller version with the SDK's expected version and fail loudly on mismatch
without changing the `q` / `executeQuery` surface.

---

## 8. Reconciliation lives in the repository

The controller has no `ensure`. The repository reads live state and decides:

```ts
const live = await executeQuery(q.Graph.service.inspect("web"));

if (!live) {
  await executeQuery(q.Graph.service.create("web", desired));
} else if (live.stale || !equal(live.config, desired)) {
  await executeQuery(
    q.Graph.service.update("web", desired, { version: live.version }),
  );
}

await executeQuery(q.Graph.wait.serviceConverged("web", {}));
```

- **Read live** with `inspect`; compare the deployer's canonical type.
- **Write** with `create` / `update` (version-guarded) / explicit `remove`.
- **Ordering is the repository's:** create the network, create the service, wait
  for convergence, then remove the old one.
- **No ownership marker and no automatic prune.** Deletion is explicit, and
  ordering and blast radius are the repository's responsibility.
- **Interrupted runs leave applied changes in place.** The run log marks the run
  failed; re-running the same commit is safe because `inspect` reflects reality.
- **Rollback** re-runs the previous commit's code; **restore** on a blank host
  runs the repository's terminal code.

### 8.1 Open questions

- **Version pruning:** Docker configs are immutable, so every config change
  leaves an old object behind, and Docker refuses to remove one while a service
  references it. Keep a bounded history and prune unreferenced config versions
  after services converge. Secret versions live only in the controller store;
  keep enough old values for an explicit revert, then prune them on the same
  schedule.
- **File-shaped secrets:** env is the chosen delivery. TLS keys and
  service-account files do not fit env vars; decide whether to support a
  sensitive config (mounted as a file) for those, accepting the same Docker API
  exposure as env.
- **Secret rollback:** re-running an older commit does not revert a rotated
  secret; `generate` resolves the current value. Decide whether an explicit
  revert-to-version action is needed.
- **Secret store encryption:** the controller's SQLite holds the only
  authoritative copy of generated secret values. Decide whether to encrypt them
  at rest and where the key lives. The Swarm Raft log also stores the injected
  env value, so encrypting SQLite alone is not enough if the Raft log is not
  encrypted.
- **Atomicity:** multi-step applies are not atomic (create network → create
  service → drop old only if healthy). Record progress in the run log and lean on
  Swarm's native `update-failure-action=rollback` + `PreviousSpec`.
- **Granularity:** one deploy script that reconciles all services vs. multiple
  entrypoints inside the one repository (still one history and one tar).
- **Unmanaged fields on update:** full replacement is the current default, so a
  field outside `ServiceConfig` set by an operator is dropped on the next
  update. Decide whether `update` should merge those fields instead.
- **Data-folder backups:** whether every folder is backed up, or only those that
  opt in.
- **Data-folder mirroring:** `delete: true` writes in place because a bind mount
  pins the inode, so a live service can see a partial tree. Decide whether to
  require a service update after a mirror.
- **Store retention:** quotas, and whether `store` is cleared when the deploy
  repository is reset to a new history.
- **Manual SSH drift:** a reimport/diagnose path for the expected
  operator-over-SSH violator.

---

## 9. Bootstrap & recovery

`docker run --rm <deployer-image> init` is the only thing that runs without a
controller. It is idempotent and does the minimum:

1. Ensure Swarm is initialised.
2. Create the controller volume (DB, git repo, socket, `data/` root) and any base
   network.
3. Create the controller's own service (Docker socket + controller volume mounted).
4. Exit; the controller takes over.

After that, the controller is an ordinary service. Updating it is an ordinary
deploy: the deploy code is responsible for ordering so the controller is not
killed mid-run (make it the last step, or run it separately). Swarm accepts a
service update before replacing the task, so a self-update can be the final call
of a run. No reserved labels, no self-detection, no GC exception.

**Recovery:** breaking the controller, the edge, or an app can stop deployments.
That is accepted. SSH is the recovery path: fix the repo, re-run `init` if the
controller is down, or start the controller and redeploy.

**Assets survive restarts.** The DB, git repo and socket live on the controller
volume; SQLite in WAL mode tolerates an abrupt kill. On startup the controller
unlinks a stale socket and rebinds before accepting connections.

---

## 10. The platform is userland

Every runtime concern is an ordinary deployment:

| Concern | How |
| --- | --- |
| Edge proxy (Caddy) | Deploy code in the one repository that reads `edge.*` labels and renders proxy config; validates and reloads it itself |
| Observability | Deploy code in the same repository, or none; opts in through its own service spec |
| The controller | Deploy code in the same repository that creates/updates the controller's own service |
| Apps | Services managed by the same deploy code |

This keeps the core small: add a capability by changing the deploy code, not by
changing the controller.
