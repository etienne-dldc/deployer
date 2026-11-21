import { createKey } from "@dldc/ts-api/server";
import type { LogLevel } from "../../sdk/graph.ts";

/**
 * The identity of the run currently executing a query.
 *
 * It is stored in the ts-api context by the internal socket server, so
 * resolvers can answer `meta.run()` and route `meta.log()` without the run id
 * being part of every call.
 */
export interface RunIdentity {
  id: string;
  commit: string;
  log: (level: LogLevel, message: string) => void;
}

export const RunKey = createKey<RunIdentity>("deployer.run");
