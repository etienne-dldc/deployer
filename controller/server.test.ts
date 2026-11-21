import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "./config.ts";
import type { ApplyHandler } from "./server.ts";
import { MAX_APPLY_BYTES, createServer } from "./server.ts";
import { InvalidArchiveError } from "./pipeline/tar.ts";

const config: Config = {
  port: 0,
  host: "127.0.0.1",
  publicToken: "test-token",
  rootDir: "/tmp/deployer-test",
  socketPath: "/tmp/deployer-test/run/deployer.sock",
  dockerSocket: "/var/run/docker.sock",
};

const success: ApplyHandler = async () => ({
  runId: "run-1",
  commit: "c0ffee",
  status: "success",
  logs: "hello\n",
});

const servers: ReturnType<typeof createServer>[] = [];

async function startServer(apply: ApplyHandler = success): Promise<string> {
  const server = createServer(config, apply);
  servers.push(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

describe("controller server", () => {
  it("answers the health check", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/status`);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
  });

  it("rejects apply without the public token", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/apply`, { method: "POST" });

    expect(response.status).toBe(401);
  });

  it("applies a tar and returns the run result", async () => {
    let received: { tar: Uint8Array; message?: string } | undefined;
    const baseUrl = await startServer(async (request) => {
      received = request;
      return { runId: "run-1", commit: "c0ffee", status: "success", logs: "hello\n" };
    });

    const response = await fetch(`${baseUrl}/api/apply?message=first+deploy`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/x-tar",
      },
      body: new Uint8Array([1, 2, 3]),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ runId: "run-1", status: "success" });
    expect(received?.tar).toEqual(new Uint8Array([1, 2, 3]));
    expect(received?.message).toBe("first deploy");
  });

  it("maps an invalid archive to 400", async () => {
    const baseUrl = await startServer(async () => {
      throw new InvalidArchiveError("archive entry escapes the repository: ../x");
    });

    const response = await fetch(`${baseUrl}/api/apply`, {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/x-tar" },
      body: new Uint8Array([1]),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("escapes"),
    });
  });

  it("rejects an empty body and an oversized body", async () => {
    const baseUrl = await startServer();

    const empty = await fetch(`${baseUrl}/api/apply`, {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: new Uint8Array(),
    });
    expect(empty.status).toBe(400);

    const big = await fetch(`${baseUrl}/api/apply`, {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/x-tar" },
      body: new Uint8Array(MAX_APPLY_BYTES + 1),
    });
    expect(big.status).toBe(413);
  });

  it("returns 404 for every other route", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/graph`, { method: "POST" });

    expect(response.status).toBe(404);
  });
});
