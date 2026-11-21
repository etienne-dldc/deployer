import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeQuery, q } from "../../sdk/execute.ts";
import type { ServiceConfig, ServiceState, ServiceVersion } from "../../sdk/graph.ts";
import { PROTOCOL_VERSION } from "../../sdk/protocol.ts";
import type { ServiceManager } from "../docker/services.ts";
import { createDeployerEngine } from "./engine.ts";
import { createInternalServer } from "./server.ts";
import { RunTokenStore } from "./tokens.ts";

class FakeServices implements ServiceManager {
  readonly services = new Map<string, ServiceState>();

  async inspect(name: string): Promise<ServiceState | null> {
    return this.services.get(name) ?? null;
  }

  async list(): Promise<ServiceState[]> {
    return [...this.services.values()];
  }

  async create(name: string, config: ServiceConfig): Promise<ServiceVersion> {
    if (this.services.has(name)) throw new Error(`service "${name}" already exists`);
    this.services.set(name, { config, version: 1 });
    return { version: 1 };
  }

  async update(name: string, config: ServiceConfig, version: number): Promise<ServiceVersion> {
    const live = this.services.get(name);
    if (!live) throw new Error(`service "${name}" does not exist`);
    if (live.version !== version) throw new Error("out of sequence");
    const next = live.version + 1;
    this.services.set(name, { config, version: next });
    return { version: next };
  }

  async remove(name: string): Promise<null> {
    this.services.delete(name);
    return null;
  }

  async serviceConverged(): Promise<null> {
    return null;
  }
}

const hello: ServiceConfig = {
  image: "traefik/whoami:v1.10",
  replicas: 1,
  env: [{ name: "WHOAMI_NAME", value: "hello" }],
  ports: [{ target: 80, published: 8081 }],
};

describe("internal socket", () => {
  let directory: string;
  let socketPath: string;
  let server: Server;
  let tokens: RunTokenStore;
  let services: FakeServices;
  let token: string;
  let options: { socket: string; token: string };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "deployer-internal-"));
    socketPath = join(directory, "deployer.sock");

    services = new FakeServices();
    tokens = new RunTokenStore();
    token = tokens.mint({ id: "run-1", commit: "c0ffee", log: vi.fn() });
    options = { socket: socketPath, token };

    const { engine } = createDeployerEngine(services);
    server = await createInternalServer({ socketPath, tokens, engine });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  it("answers meta.version and meta.run", async () => {
    await expect(executeQuery(q.Graph.meta.version(), options)).resolves.toBe(PROTOCOL_VERSION);
    await expect(executeQuery(q.Graph.meta.run(), options)).resolves.toEqual({
      id: "run-1",
      commit: "c0ffee",
    });
  });

  it("creates, inspects, updates and removes a service", async () => {
    await expect(executeQuery(q.Graph.service.inspect("hello"), options)).resolves.toBeNull();
    await expect(executeQuery(q.Graph.service.create("hello", hello), options)).resolves.toEqual({
      version: 1,
    });

    const live = await executeQuery(q.Graph.service.inspect("hello"), options);
    expect(live).toEqual({ config: hello, version: 1 });
    await expect(executeQuery(q.Graph.service.list(), options)).resolves.toEqual([live]);

    await expect(
      executeQuery(
        q.Graph.service.update("hello", { ...hello, replicas: 2 }, { version: 1 }),
        options,
      ),
    ).resolves.toEqual({ version: 2 });

    await expect(
      executeQuery(q.Graph.wait.serviceConverged("hello", {}), options),
    ).resolves.toBeNull();
    await expect(executeQuery(q.Graph.service.remove("hello"), options)).resolves.toBeNull();
    await expect(executeQuery(q.Graph.service.inspect("hello"), options)).resolves.toBeNull();
  });

  it("rejects a stale version", async () => {
    await executeQuery(q.Graph.service.create("hello", hello), options);
    await executeQuery(q.Graph.service.update("hello", hello, { version: 1 }), options);

    await expect(
      executeQuery(q.Graph.service.update("hello", hello, { version: 1 }), options),
    ).rejects.toThrow("out of sequence");
  });

  it("validates arguments against the graph", async () => {
    await expect(
      executeQuery(q.Graph.service.inspect(42 as unknown as string), options),
    ).rejects.toThrow(/inspect|invalid|expected|string/i);
  });

  it("rejects unknown and revoked tokens", async () => {
    await expect(
      executeQuery(q.Graph.meta.version(), { socket: socketPath, token: "not-a-token" }),
    ).rejects.toThrow(/Unauthorized/);

    tokens.revoke(token);
    await expect(executeQuery(q.Graph.meta.version(), options)).rejects.toThrow(/Unauthorized/);
  });

  it("routes meta.log to the run's log sink", async () => {
    const log = vi.fn();
    const logToken = tokens.mint({ id: "run-2", commit: "beef", log });
    const logOptions = { socket: socketPath, token: logToken };

    await expect(
      executeQuery(q.Graph.meta.log("info", "created hello"), logOptions),
    ).resolves.toBeNull();
    expect(log).toHaveBeenCalledWith("info", "created hello");
  });

  it("refuses to bind a socket another controller is serving", async () => {
    const { engine } = createDeployerEngine(services);

    await expect(createInternalServer({ socketPath, tokens, engine })).rejects.toThrow(
      /already listening/,
    );
  });
});
