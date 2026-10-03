# Tower Control — Requirements & Architecture (draft)

> Consolidated from the design discussions (Oct 2026). This is a working
> document — it captures the requirements we validated and the architecture we
> designed together, plus the open decisions still to settle.

---

## 1. Requirements

### 1.1 Foundational principle

> **The controller's internal state (SQLite) is the source of truth. Docker is a
> projection of that state. There is no git reconciliation.**

- Reproducing a fresh server is a **restore capability**, not a sync loop.
- "Rebuild on a fresh system" = one action: restore the controller DB, then run
  the projector to bring the whole world back.
- **No writes to Docker except through the controller.** The one realistic
  violator is an operator working over SSH — treat that as _expected_ and give
  it a first-class recovery path (reimport/diagnose), not a reconciliation loop.

### 1.2 What we keep as-is

| Thing                                 | Note                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Caddy + OVH DNS-01** reverse proxy  | Keep. Cert expiry/renewal must become observable + alertable.                                            |
| **Auth-portal**                       | Keep. Identity for the UI/API.                                                                           |
| **Docker Swarm** (direct service API) | Keep — _not_ compose. Gives full ServiceSpec control, update/rollback policies, optimistic locking.      |
| **Dozzle**                            | Keep, but demoted to **live tail only**. History/search is Loki's job (or a controller logs view later). |
| **dufs**                              | S3-compatible target for backups.                                                                        |

Dropped: **git-based deployment/reconciliation** (the old tar → diff → plan →
deploy pipeline and its controller slices 3–8).

---

## 2. Architecture

### 2.1 Topology

```
┌────────── dev server ──────────┐      ┌────────── prod server ──────────┐
│  Controller (SQLite + UI/API)  │      │  Controller (SQLite + UI/API)  │
│        │  Docker API           │      │        │  Docker API           │
│  Docker Swarm                  │      │  Docker Swarm                  │
│  (Caddy, auth-portal, otel,    │      │  (Caddy, auth-portal, otel,    │
│   dozzle, dufs, apps)          │      │   dozzle, dufs, apps)          │
└──────────────┬─────────────────┘      └──────────────┬─────────────────┘
               │  promotion: export / import           │
               └──────────  (manual, reviewable) ──────┘
      both are independent — no sync, no shared artifact
```

- One controller **per environment**, each with its own state.
- The controller engages Docker through the **Engine API** and manages the full
  Swarm object graph: networks, configs, secrets, services.
- Platform containers (Caddy, Otel collector, Grafana, Dozzle, dufs,
  auth-portal) are **regular services** in the controller — same lifecycle,
  logs, backup, secrets treatment as any app. They differ only in _role_.

### 2.2 Components

| Component              | Responsibility                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Controller core**    | API (ts-api RPC), SSE events, projector (apply engine), scheduler, backup engine, drift report                                    |
| **SQLite DB**          | Applied state, drafts, apply history (snapshots), steps, audit log                                                                |
| **Docker API (Swarm)** | The projection target — `POST /services/{id}/update?version=N` with full spec                                                     |
| **Platform services**  | Caddy (config rendered from services), auth-portal (ACLs), OTEL collector + Grafana (config + generated dashboards), Dozzle, dufs |
| **Backup target**      | S3-compatible (dufs or real S3), with retention                                                                                   |

### 2.3 The data model

| Store      | Holds                                                                   | Role                                                                     |
| ---------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **State**  | One row per managed object: service, network, caddy config, otel config | Committed truth, mirrors live Docker, carries the Swarm `version` marker |
| **Drafts** | List of changes not yet applied                                         | Staged, not live                                                         |

### 2.4 The service model

- **Curated subset of ServiceSpec:** image, env/secrets, mounts, networks,
  update/rollback policy, restart policy, resources, ports, healthcheck.

### 2.5 Two channels: state changes vs. actions

| State (draft → apply)                                                           | Actions (immediate, no draft)                                                                                         |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Image, env, volumes, ports, expose, network membership, caddy/otel config edits | Restart, force-update ("apply spec but you choose when"), generate-secret, rollback, reimport-from-docker, run-backup |

Keep them separate — a "restart after env change" is a draft (env) + an action
(rollout when you say go).

### 2.6 The apply flow (the projector)

```
edit svc A  ->  add draft item 1
edit svc B  ->  add draft item 2
add network ->  add draft item 3

Apply
    1. validate drafts
    2. Compute new state and collect required changes  
    3. Apply update in docker  
    4. Save updated state
```

Note: The save after docker changes need to be confirmed because it might cause
issues in case of failure... Need to think about that...
