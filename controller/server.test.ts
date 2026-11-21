import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "./config.ts";
import { createServer } from "./server.ts";

const config: Config = {
  port: 0,
  host: "127.0.0.1",
  publicToken: "test-token",
};

const servers: ReturnType<typeof createServer>[] = [];

async function startServer(): Promise<string> {
  const server = createServer(config);
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

  it("accepts apply with the public token", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/apply`, {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(501);
  });
});
