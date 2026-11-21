import { isDeepStrictEqual } from "node:util";

/**
 * Compare two canonical service configs. The controller's `fromSwarm` normalizes
 * Docker's defaults, so a deep comparison is enough once both sides are
 * `ServiceConfig` values.
 */
export function equal(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(a, b);
}
