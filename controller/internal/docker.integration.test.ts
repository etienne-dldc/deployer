import { rm } from "node:fs/promises";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeQuery, q } from "../../sdk/execute.ts";
import type { ServiceConfig } from "../../sdk/graph.ts";
import { PROTOCOL_VERSION } from "../../sdk/protocol.ts";
import { createDockerClient } from "../docker/client.ts";
import { createServiceManager, type ServiceManager } from "../docker/services.ts";
import { createDeployerEngine } from "./engine.ts";
import { createInternalServer } from "./server.ts";
import { RunTokenStore } from "./tokens.ts";

/**
 * End-to-end tests against a live Docker Swarm.
 *
 * They are skipped unless DEPLOYER_TEST_DOCKER=1, so `pnpm test` stays usable
 * without a Docker daemon. Run them on a Swarm manager:
 *
 *   DEPLOYER_TEST_DOCKER=1 pnpm test
 *
 * They create and remove uniquely named services and never touch existing ones.
 *
 * The deploy run container does not exist yet, so this test drives the socket
 * the way a run will: the SDK over a minted per-run token.
 */
const enabled = process.env.DEPLOYER_TEST_DOCKER === "1";

const IMAGE = "traefik/whoami:v1.10";

describe.skipIf(!enabled)("docker integration", () => {
  const suffix = Date.now().toString(36);
  const name = `deployer-it-${suffix}`;
  const errorName = `deployer-it-err-${suffix}`;
  const socketPath = join(tmpdir(), `${name}.sock`);

  let server: Server;
  let services: ServiceManager;
  let options: { socket: string; token: string };
  const logs: { level: string; message: string }[] = [];

  beforeAll(async () => {
    const docker = createDockerClient(process.env.DOCKER_SOCKET ?? "/var/run/docker.sock");
    services = createServiceManager(docker);

    const tokens = new RunTokenStore();
    const token = tokens.mint({
      id: "it-run",
      commit: "0000000",
      log: (level, message) => logs.push({ level, message }),
    });
    options = { socket: socketPath, token };

    const { engine } = createDeployerEngine(services);
    server = await createInternalServer({ socketPath, tokens, engine });
  }, 30_000);

  afterAll(async () => {
    await services?.remove(name).catch(() => undefined);
    await services?.remove(errorName).catch(() => undefined);
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await rm(socketPath, { force: true });
  }, 120_000);

  it("answers the version and run metadata", async () => {
    await expect(executeQuery(q.Graph.meta.version(), options)).resolves.toBe(PROTOCOL_VERSION);
    await expect(executeQuery(q.Graph.meta.run(), options)).resolves.toEqual({
      id: "it-run",
      commit: "0000000",
    });

    await expect(
      executeQuery(q.Graph.meta.log("info", "integration start"), options),
    ).resolves.toBeNull();
    expect(logs).toContainEqual({ level: "info", message: "integration start" });
  });

  it("creates, tracks, updates and removes a real Swarm service", async () => {
    const desired: ServiceConfig = {
      image: IMAGE,
      replicas: 1,
      command: ["--port", "80"],
      env: [
        { name: "WHOAMI_NAME", value: "deployer-it" },
        { name: "SECOND", value: "value-with=equals" },
      ],
      labels: [{ name: "deployer.test", value: name }],
    };

    await expect(executeQuery(q.Graph.service.inspect(name), options)).resolves.toBeNull();

    const created = await executeQuery(q.Graph.service.create(name, desired), options);
    expect(created.version).toBeGreaterThan(0);

    const live = await executeQuery(q.Graph.service.inspect(name), options);
    expect(live?.config).toEqual(desired);
    expect(live?.version).toBe(created.version);

    const all = await executeQuery(q.Graph.service.list(), options);
    expect(
      all.some((service) => service.config.labels?.some((label) => label.value === name)),
    ).toBe(true);

    await expect(
      executeQuery(q.Graph.wait.serviceConverged(name, { timeoutMs: 120_000 }), options),
    ).resolves.toBeNull();

    const updated = await executeQuery(
      q.Graph.service.update(
        name,
        { ...desired, env: [{ name: "WHOAMI_NAME", value: "changed" }] },
        { version: created.version },
      ),
      options,
    );
    expect(updated.version).toBeGreaterThan(created.version);

    const afterUpdate = await executeQuery(q.Graph.service.inspect(name), options);
    expect(afterUpdate?.config.env).toEqual([{ name: "WHOAMI_NAME", value: "changed" }]);
    await expect(
      executeQuery(q.Graph.wait.serviceConverged(name, { timeoutMs: 120_000 }), options),
    ).resolves.toBeNull();

    await expect(
      executeQuery(q.Graph.service.update(name, desired, { version: created.version }), options),
    ).rejects.toThrow(/changed since version/);

    await expect(executeQuery(q.Graph.service.remove(name), options)).resolves.toBeNull();
    await expect(executeQuery(q.Graph.service.inspect(name), options)).resolves.toBeNull();
  }, 240_000);

  it("reports a duplicate create and a missing update as errors over the socket", async () => {
    const config: ServiceConfig = { image: IMAGE, replicas: 1 };
    await executeQuery(q.Graph.service.create(errorName, config), options);

    await expect(executeQuery(q.Graph.service.create(errorName, config), options)).rejects.toThrow(
      /conflict/i,
    );

    await expect(
      executeQuery(
        q.Graph.service.update(
          `${errorName}-missing`,
          { image: IMAGE, replicas: 1 },
          { version: 1 },
        ),
        options,
      ),
    ).rejects.toThrow(/does not exist|not found/i);
  }, 120_000);
});
