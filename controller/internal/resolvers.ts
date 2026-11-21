import { fn, type TGraphOf, type TResolver } from "@dldc/ts-api/server";
import type { Graph } from "../../sdk/graph.ts";
import { PROTOCOL_VERSION } from "./protocol.ts";
import type { ServiceManager } from "../docker/services.ts";
import { RunKey } from "./run-context.ts";

export type DeployerGraph = TGraphOf<{ Graph: Graph }>;

/**
 * Resolvers behind the internal socket. They are a thin mapping onto the
 * service manager: no reconciliation, no defaults, no ownership checks.
 */
export function createResolvers(graph: DeployerGraph, services: ServiceManager): TResolver[] {
  return [
    fn(graph.Graph.meta.version, () => PROTOCOL_VERSION),

    fn(graph.Graph.meta.run, (context) => {
      const run = context.getOrFail(RunKey.Consumer);
      return { id: run.id, commit: run.commit };
    }),

    fn(graph.Graph.meta.log, (context, [level, message]) => {
      context.getOrFail(RunKey.Consumer).log(level, message);
      return null;
    }),

    fn(graph.Graph.service.inspect, (_context, [name]) => services.inspect(name)),

    fn(graph.Graph.service.list, () => services.list()),

    fn(graph.Graph.service.create, (_context, [name, config]) => services.create(name, config)),

    fn(graph.Graph.service.update, (_context, [name, config, options]) =>
      services.update(name, config, options.version),
    ),

    fn(graph.Graph.service.remove, (_context, [name]) => services.remove(name)),

    fn(graph.Graph.wait.serviceConverged, (_context, [name, options]) =>
      services.serviceConverged(name, options.timeoutMs),
    ),
  ];
}
