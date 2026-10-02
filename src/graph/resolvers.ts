import { fn, parse, type TResolver } from "@dldc/ts-api/server";
import { readFileSync } from "node:fs";
import denoJson from "../../deno.json" with { type: "json" };
import { builtins } from "./builtins.ts";
import type { Graph } from "./schema.ts";

// ts-api's `parse` takes the schema **source text** (not a path). Resolve the
// schema file relative to this module so it works regardless of CWD (local dev
// and container alike).
const schemaSource = readFileSync(
  new URL("./schema.ts", import.meta.url),
  "utf-8",
);

export const graph = parse<{ Graph: Graph }>(schemaSource, { builtins });

export const resolvers: TResolver[] = [
  fn(graph.Graph.version, () => denoJson.version),
];
