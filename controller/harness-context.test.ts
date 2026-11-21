import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServiceConfig } from "../sdk/graph.ts";
import { createHarness } from "./harness-context.ts";

interface Recorded {
  path: string[];
  args: unknown[];
}

const config: ServiceConfig = { image: "nginx", replicas: 1 };

describe("createHarness", () => {
  let packageDir: string;

  beforeEach(async () => {
    packageDir = await mkdtemp(join(tmpdir(), "deployer-harness-"));
    await mkdir(join(packageDir, "assets"), { recursive: true });
    await writeFile(join(packageDir, "assets/note.txt"), "hello asset\n");
    await writeFile(join(packageDir, "assets/secret.env"), "TOKEN=1\n");
  });

  afterEach(async () => {
    await rm(packageDir, { recursive: true, force: true });
  });

  it("fetches the run and routes service calls to the graph", async () => {
    const calls: Recorded[] = [];
    const harness = await createHarness({
      packageDir,
      call: async (path, args) => {
        calls.push({ path, args });
        if (path.join(".") === "Graph.meta.run") return { id: "run-1", commit: "c0ffee" } as never;
        if (path.join(".") === "Graph.service.inspect") return null as never;
        if (path.join(".") === "Graph.service.create") return { version: 1 } as never;
        return null as never;
      },
    });

    expect(harness.context.run).toEqual({ id: "run-1", commit: "c0ffee" });

    await expect(harness.context.service.inspect("hello")).resolves.toBeNull();
    await expect(harness.context.service.create("hello", config)).resolves.toEqual({ version: 1 });
    await expect(harness.context.wait.serviceConverged("hello")).resolves.toBeUndefined();
    await harness.context.service.remove("hello");

    expect(calls.slice(1)).toEqual([
      { path: ["Graph", "service", "inspect"], args: ["hello"] },
      { path: ["Graph", "service", "create"], args: ["hello", config] },
      { path: ["Graph", "wait", "serviceConverged"], args: ["hello", {}] },
      { path: ["Graph", "service", "remove"], args: ["hello"] },
    ]);
  });

  it("queues log lines and flushes them after the deploy", async () => {
    const calls: Recorded[] = [];
    const harness = await createHarness({
      packageDir,
      call: async (path, args) => {
        calls.push({ path, args });
        if (path.join(".") === "Graph.meta.run") return { id: "run-1", commit: "c0ffee" } as never;
        return null as never;
      },
    });

    harness.context.log.info("created hello");
    harness.context.log.error("boom");

    await harness.flushLogs();

    expect(calls.filter((call) => call.path.join(".") === "Graph.meta.log")).toEqual([
      { path: ["Graph", "meta", "log"], args: ["info", "created hello"] },
      { path: ["Graph", "meta", "log"], args: ["error", "boom"] },
    ]);
  });

  it("reads and lists package assets", async () => {
    const harness = await createHarness({
      packageDir,
      call: async (path) =>
        (path.join(".") === "Graph.meta.run" ? { id: "run-1", commit: "c0ffee" } : null) as never,
    });

    await expect(harness.context.readTextAsset("assets/note.txt")).resolves.toBe("hello asset\n");
    await expect(harness.context.readAsset("assets/note.txt")).resolves.toEqual(
      Buffer.from("hello asset\n"),
    );
    await expect(harness.context.listAssets("assets")).resolves.toEqual(["note.txt", "secret.env"]);
  });

  it("refuses asset paths outside the package", async () => {
    const harness = await createHarness({
      packageDir,
      call: async (path) =>
        (path.join(".") === "Graph.meta.run" ? { id: "run-1", commit: "c0ffee" } : null) as never,
    });

    await expect(harness.context.readTextAsset("../outside.txt")).rejects.toThrow(
      /escapes the package/,
    );
  });

  it("compares configs the way the controller does", async () => {
    const harness = await createHarness({
      packageDir,
      call: async (path) =>
        (path.join(".") === "Graph.meta.run" ? { id: "run-1", commit: "c0ffee" } : null) as never,
    });

    const reordered: ServiceConfig = {
      ...config,
      env: [
        { name: "B", value: "2" },
        { name: "A", value: "1" },
      ],
    };
    const desired: ServiceConfig = {
      ...config,
      env: [
        { name: "A", value: "1" },
        { name: "B", value: "2" },
      ],
    };

    expect(harness.context.equal(reordered, desired)).toBe(true);
    expect(harness.context.equal(config, { ...config, replicas: 2 })).toBe(false);
  });
});
