import type {
  RunInfo,
  ServiceConfig,
  ServiceState,
  ServiceVersion,
  WaitServiceOptions,
} from "./graph.ts";

/** Run log sink. Lines are streamed into the apply result. */
export interface DeployLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Swarm services, exactly as the controller sees them. */
export interface DeployServiceApi {
  list(): Promise<ServiceState[]>;
  inspect(name: string): Promise<ServiceState | null>;
  create(name: string, config: ServiceConfig): Promise<ServiceVersion>;
  /**
   * Update a service. Pass the `version` from `inspect` so a concurrent change
   * is rejected instead of overwritten.
   */
  update(name: string, config: ServiceConfig, options: ServiceVersion): Promise<ServiceVersion>;
  remove(name: string): Promise<null>;
}

export interface DeployWaitApi {
  /** Resolve once Swarm reports the service converged, or reject on timeout. */
  serviceConverged(name: string, options?: WaitServiceOptions): Promise<void>;
}

/**
 * What a deploy package receives when it runs.
 *
 * The context is the artifact's whole runtime: it is created by the runner
 * harness, so a package needs no imports at all and can be a single bundled
 * file. `equal` is the controller's own comparison, and asset paths resolve
 * against the package root so bundling never moves them.
 */
export interface DeployContext {
  /** The apply this run belongs to. */
  readonly run: RunInfo;
  /** Absolute path of the unpacked package inside the run container. */
  readonly packageDir: string;
  readonly log: DeployLogger;
  readonly service: DeployServiceApi;
  readonly wait: DeployWaitApi;
  /** Compare a desired config with `inspect().config`, ignoring map ordering. */
  equal(a: unknown, b: unknown): boolean;
  /** Read a file from the package. Rejects paths outside it. */
  readAsset(path: string): Promise<Uint8Array>;
  /** Read a UTF-8 file from the package. */
  readTextAsset(path: string): Promise<string>;
  /** List files under a package directory, relative to it and sorted. */
  listAssets(path: string): Promise<string[]>;
}
