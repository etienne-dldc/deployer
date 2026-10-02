import { createEngine } from "@dldc/ts-api/server";
import { graph, resolvers } from "./resolvers.ts";

export const engine = createEngine({
  graph,
  entry: "Graph",
  resolvers,
});
