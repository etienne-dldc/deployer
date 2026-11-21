import { isDeepStrictEqual } from "node:util";
import type { EnvVar, Label, ServiceConfig, ServicePort } from "./graph.ts";

/**
 * Compare a desired `ServiceConfig` with `inspect().config`.
 *
 * `env`, `labels` and `ports` encode maps and sets, not sequences: Docker
 * returns them in its own order (env comes back sorted by name), so comparing
 * them positionally would report a difference on every run. They are compared
 * as unordered entries; `command` stays ordered because it is a sequence.
 *
 * Values that do not look like a `ServiceConfig` fall back to a deep compare,
 * so the helper is still usable for plain JSON.
 */
export function equal(a: unknown, b: unknown): boolean {
  if (!isServiceConfig(a) || !isServiceConfig(b)) {
    return isDeepStrictEqual(a, b);
  }

  return (
    a.image === b.image &&
    a.replicas === b.replicas &&
    isDeepStrictEqual(compact(a.command), compact(b.command)) &&
    isDeepStrictEqual(sortedPairs(a.env), sortedPairs(b.env)) &&
    isDeepStrictEqual(sortedPairs(a.labels), sortedPairs(b.labels)) &&
    isDeepStrictEqual(sortedPorts(a.ports), sortedPorts(b.ports))
  );
}

function isServiceConfig(value: unknown): value is ServiceConfig {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.image === "string" && typeof record.replicas === "number";
}

function compact<T>(values: T[] | undefined): T[] | undefined {
  return values === undefined || values.length === 0 ? undefined : values;
}

function sortedPairs(entries: (EnvVar | Label)[] | undefined): (EnvVar | Label)[] | undefined {
  if (entries === undefined || entries.length === 0) return undefined;
  return [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function sortedPorts(ports: ServicePort[] | undefined): ServicePort[] | undefined {
  if (ports === undefined || ports.length === 0) return undefined;
  return [...ports].sort((a, b) => a.target - b.target || a.published - b.published);
}
