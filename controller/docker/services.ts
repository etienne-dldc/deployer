import type Docker from "dockerode";
import { setTimeout as delay } from "node:timers/promises";
import type { ServiceConfig, ServiceState, ServiceVersion } from "../../sdk/graph.ts";
import { fromSwarm, toSwarm } from "../service/spec.ts";

export const DEFAULT_CONVERGE_TIMEOUT_MS = 60_000;
export const DEFAULT_CONVERGE_INTERVAL_MS = 500;

/** Thrown when `update` is applied with a `version` that is no longer current. */
export class ServiceVersionConflictError extends Error {
  constructor(name: string, version: number) {
    super(`service "${name}" changed since version ${String(version)}; inspect it again`);
    this.name = "ServiceVersionConflictError";
  }
}

export interface ServiceManager {
  inspect(name: string): Promise<ServiceState | null>;
  list(): Promise<ServiceState[]>;
  create(name: string, config: ServiceConfig): Promise<ServiceVersion>;
  update(name: string, config: ServiceConfig, version: number): Promise<ServiceVersion>;
  remove(name: string): Promise<null>;
  serviceConverged(name: string, timeoutMs?: number): Promise<null>;
}

/**
 * Low-level Swarm service operations behind the internal API.
 *
 * This is deliberately not a reconciler: it applies exactly what the deploy
 * repository asks for and reports live state. The repository decides when to
 * create, update or remove.
 */
export function createServiceManager(docker: Docker): ServiceManager {
  async function inspectLive(name: string): Promise<Docker.Service | null> {
    try {
      return await docker.getService(name).inspect();
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function stateOf(name: string): Promise<ServiceState> {
    const live = await inspectLive(name);
    if (!live) {
      throw new Error(`service "${name}" does not exist`);
    }
    if (!live.Spec) {
      throw new Error(`service "${name}" has no spec`);
    }
    return {
      config: fromSwarm(live.Spec),
      version: live.Version?.Index ?? 0,
    };
  }

  return {
    async inspect(name) {
      const live = await inspectLive(name);
      if (!live || !live.Spec) return null;
      return { config: fromSwarm(live.Spec), version: live.Version?.Index ?? 0 };
    },

    async list() {
      const services = await docker.listServices();
      return services
        .filter((service) => service.Spec !== undefined)
        .map((service) => ({
          config: fromSwarm(service.Spec as Docker.ServiceSpec),
          version: service.Version?.Index ?? 0,
        }));
    },

    async create(name, config) {
      await docker.createService({ Name: name, ...toSwarm(config) });
      return { version: (await stateOf(name)).version };
    },

    async update(name, config, version) {
      const spec = toSwarm(config);
      try {
        // The update body is the full spec: Docker rejects a body without the
        // service name ("renaming services is not supported").
        await docker.getService(name).update({ Name: name, ...spec, version });
      } catch (error) {
        if (isVersionConflict(error)) {
          throw new ServiceVersionConflictError(name, version);
        }
        if (isNotFound(error)) {
          throw new Error(`service "${name}" does not exist`);
        }
        throw error;
      }
      return { version: (await stateOf(name)).version };
    },

    async remove(name) {
      try {
        await docker.getService(name).remove();
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      return null;
    },

    async serviceConverged(name, timeoutMs = DEFAULT_CONVERGE_TIMEOUT_MS) {
      const deadline = Date.now() + timeoutMs;
      let last = "no tasks reported";

      for (;;) {
        const progress = await convergence(name);
        last = `running ${String(progress.running)}/${String(progress.desired)}`;

        if (progress.desired === 0 || progress.running === progress.desired) {
          return null;
        }
        if (Date.now() >= deadline) {
          throw new Error(
            `service "${name}" did not converge within ${String(timeoutMs)}ms (${last})`,
          );
        }

        await delay(DEFAULT_CONVERGE_INTERVAL_MS);
      }
    },
  };

  async function convergence(name: string): Promise<{ desired: number; running: number }> {
    const live = await inspectLive(name);
    if (!live) {
      throw new Error(`service "${name}" does not exist`);
    }

    const desired = live.Spec?.Mode?.Replicated?.Replicas ?? 1;

    const tasks = (await docker.listTasks({
      filters: { service: [name], "desired-state": ["running"] },
    })) as { Status?: { State?: string } }[];

    return {
      desired,
      running: tasks.filter((task) => task.Status?.State === "running").length,
    };
  }
}

interface DockerError {
  statusCode?: number;
  message?: string;
  reason?: string;
  json?: { message?: string };
}

function asDockerError(error: unknown): DockerError | null {
  return typeof error === "object" && error !== null ? (error as DockerError) : null;
}

function errorText(error: unknown): string {
  const dockerError = asDockerError(error);
  return dockerError?.json?.message ?? dockerError?.reason ?? dockerError?.message ?? String(error);
}

export function isNotFound(error: unknown): boolean {
  return asDockerError(error)?.statusCode === 404;
}

export function isVersionConflict(error: unknown): boolean {
  return /out of sequence|update out of sequence/i.test(errorText(error));
}
