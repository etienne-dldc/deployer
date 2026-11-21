import { readFile } from "node:fs/promises";
import { parse } from "@dldc/ts-api/server";
import { describe, expect, it } from "vitest";
import type { Graph } from "./graph.ts";

describe("Graph", () => {
  it("is a valid ts-api schema", async () => {
    const source = await readFile(new URL("./graph.ts", import.meta.url), "utf8");
    const graph = parse<{ Graph: Graph }>(source);

    expect(graph.Graph.meta.version).toBeDefined();
    expect(graph.Graph.service.inspect).toBeDefined();
    expect(graph.Graph.wait.serviceConverged).toBeDefined();
  });
});
