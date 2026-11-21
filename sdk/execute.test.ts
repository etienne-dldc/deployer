import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeQuery, q } from "./execute.ts";

interface Request {
  token: string;
  path: string[];
  args: unknown[];
}

describe("executeQuery", () => {
  it("builds ts-api queries and sends them over the Unix socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deployer-sdk-"));
    const socketPath = join(directory, "deployer.sock");
    const requests: Request[] = [];

    const server = createServer((socket) => {
      socket.setEncoding("utf8");
      let body = "";

      socket.on("data", (chunk: string) => {
        body += chunk;
        const newline = body.indexOf("\n");
        if (newline === -1) return;

        const request = JSON.parse(body.slice(0, newline)) as Request;
        requests.push(request);

        if (request.path.join(".") === "Graph.service.inspect") {
          socket.end(
            `${JSON.stringify({ ok: false, error: { kind: "Error", message: "boom" } })}\n`,
          );
          return;
        }

        const result = request.path.join(".") === "Graph.service.create" ? { version: 1 } : "1";
        socket.end(`${JSON.stringify({ ok: true, result })}\n`);
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    try {
      const options = { socket: socketPath, token: "run-token" };

      await expect(executeQuery(q.Graph.meta.version(), options)).resolves.toBe("1");
      await expect(
        executeQuery(
          q.Graph.service.create("hello", {
            image: "nginx",
            replicas: 1,
            env: [{ name: "A", value: "1" }],
            labels: [{ name: "L", value: "v" }],
          }),
          options,
        ),
      ).resolves.toEqual({ version: 1 });
      await expect(executeQuery(q.Graph.service.inspect("hello"), options)).rejects.toThrow(
        "Error: boom",
      );

      expect(requests).toHaveLength(3);
      expect(requests[0]).toMatchObject({
        token: "run-token",
        path: ["Graph", "meta", "version"],
        args: [],
      });
      expect(requests[1]).toMatchObject({
        token: "run-token",
        path: ["Graph", "service", "create"],
        args: [
          "hello",
          {
            image: "nginx",
            replicas: 1,
            env: [{ name: "A", value: "1" }],
            labels: [{ name: "L", value: "v" }],
          },
        ],
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
