/**
 * Types for deploy packages.
 *
 * This package is types-only on purpose: deploy code imports it with
 * `import type`, the imports are erased at build time, and the artifact needs
 * no `node_modules`. Everything runtime comes from the `DeployContext` the
 * runner passes to the package's default export.
 */
export type { DeployContext, DeployLogger, DeployServiceApi, DeployWaitApi } from "./context.ts";

export type {
  EnvVar,
  Graph,
  Label,
  LogLevel,
  RunInfo,
  ServiceConfig,
  ServicePort,
  ServiceState,
  ServiceVersion,
  WaitServiceOptions,
} from "./graph.ts";
