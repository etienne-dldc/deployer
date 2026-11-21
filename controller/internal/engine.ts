import { readFileSync } from "node:fs";
import { createEngine, parse, type TEngine } from "@dldc/ts-api/server";
import { fileURLToPath } from "node:url";
import type { Graph } from "../../sdk/graph.ts";
import type { ServiceManager } from "../docker/services.ts";
import { createResolvers, type DeployerGraph } from "./resolvers.ts";

/**
 * Where the Graph schema lives. ts-api parses the TypeScript source, so the
 * file itself must be available at runtime.
 *
 * - bundled controller: `dist/controller/graph.ts` (copied by the build)
 * - tests and `pnpm dev`: `sdk/graph.ts` next to the sources
 */
const SCHEMA_CANDIDATES = ["./graph.ts", "../../sdk/graph.ts"];

export interface DeployerEngine {
  graph: DeployerGraph;
  engine: TEngine;
}

/**
 * Build the ts-api engine from the SDK's schema source.
 *
 * Parsing the same file the SDK types come from keeps one wire contract, and
 * lets ts-api validate arguments and results on the controller side.
 */
export function createDeployerEngine(services: ServiceManager): DeployerEngine {
  const graph = parse<{ Graph: Graph }>(readSchemaSource());
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: createResolvers(graph, services),
  });

  return { graph, engine };
}

function readSchemaSource(): string {
  const failures: string[] = [];

  for (const candidate of SCHEMA_CANDIDATES) {
    const path = fileURLToPath(new URL(candidate, import.meta.url));
    try {
      return readFileSync(path, "utf8");
    } catch {
      failures.push(path);
    }
  }

  throw new Error(`cannot find the Graph schema; looked in:\n${failures.join("\n")}`);
}
