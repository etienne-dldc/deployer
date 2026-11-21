export type LogLevel = "debug" | "info" | "warn" | "error";

export interface EnvVar {
  name: string;
  value: string;
}

export interface Label {
  name: string;
  value: string;
}

export interface ServicePort {
  target: number;
  published: number;
}

/**
 * The service shape accepted by the controller.
 *
 * ts-api does not support index signatures, so env vars and labels cross the
 * RPC boundary as arrays of `{ name, value }`. The controller converts them to
 * Swarm's map form internally.
 */
export interface ServiceConfig {
  image: string;
  replicas: number;
  command?: string[];
  env?: EnvVar[];
  ports?: ServicePort[];
  labels?: Label[];
}

export interface ServiceState {
  config: ServiceConfig;
  version: number;
}

export interface ServiceVersion {
  version: number;
}

export interface RunInfo {
  id: string;
  commit: string;
}

export interface WaitServiceOptions {
  timeoutMs?: number;
}

/**
 * The ts-api schema. The same `Graph` is the server's resolver contract and the
 * client's type source. Keep this file self-contained and declarations-only:
 * `parseFromFile` reads its source text.
 */
export interface Graph {
  meta: {
    version: () => string;
    run: () => RunInfo;
    log: (level: LogLevel, message: string) => null;
  };
  service: {
    inspect: (name: string) => ServiceState | null;
    list: () => ServiceState[];
    create: (name: string, config: ServiceConfig) => ServiceVersion;
    update: (name: string, config: ServiceConfig, options: ServiceVersion) => ServiceVersion;
    remove: (name: string) => null;
  };
  wait: {
    serviceConverged: (name: string, options: WaitServiceOptions) => null;
  };
}
