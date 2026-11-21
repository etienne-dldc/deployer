import { chmod, mkdir, rm } from "node:fs/promises";
import { createServer, createConnection, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import type { TEngine } from "@dldc/ts-api/server";
import type { InternalError, InternalResponse } from "./protocol.ts";
import { RunKey } from "./run-context.ts";
import type { RunTokenStore } from "./tokens.ts";

export interface InternalServerOptions {
  socketPath: string;
  tokens: RunTokenStore;
  engine: TEngine;
  /** Reject requests larger than this. One RPC is expected to be small. */
  maxRequestBytes?: number;
  /** Socket mode. The MVP is single-tenant; deploy runs share the socket. */
  socketMode?: number;
}

export const DEFAULT_MAX_REQUEST_BYTES = 1_048_576;

interface InternalRequest {
  token: string;
  path: string[];
  args: unknown[];
}

/**
 * The internal, run-only API.
 *
 * Reachability is fenced by the Unix socket (the run container mounts it), and
 * identity is gated by the per-run token. Both are required: the socket alone
 * does not stop another process with access to the same mount.
 *
 * Unlinking a stale socket happens before `listen`, so a controller restarted
 * after a crash can bind again without manual cleanup.
 */
export async function createInternalServer(options: InternalServerOptions): Promise<Server> {
  const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const server = createServer((socket) => {
    handleConnection(socket, options, maxRequestBytes);
  });

  await mkdir(dirname(options.socketPath), { recursive: true });
  await ensureSocketIsFree(options.socketPath);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  await chmod(options.socketPath, options.socketMode ?? 0o666);
  return server;
}

/**
 * Remove a socket left behind by a crashed controller, but never steal the
 * socket from a controller that is still answering.
 */
async function ensureSocketIsFree(socketPath: string): Promise<void> {
  const live = await new Promise<boolean>((resolve) => {
    const probe = createConnection(socketPath);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });

  if (live) {
    throw new Error(`another controller is already listening on ${socketPath}`);
  }

  await rm(socketPath, { force: true });
}

function handleConnection(socket: Socket, options: InternalServerOptions, maxRequestBytes: number) {
  socket.setEncoding("utf8");
  // Only the wait for a request line is bounded here. Once dispatch starts, a
  // resolver may legitimately block for a while (serviceConverged waits for
  // tasks), so the transport must not cut it short.
  socket.setTimeout(30_000, () => socket.destroy());

  let buffer = "";
  let handled = false;

  socket.on("error", () => {
    // A deploy run that dies mid-request is not a controller problem.
  });

  socket.on("data", (chunk: string) => {
    if (handled) return;

    buffer += chunk;
    if (Buffer.byteLength(buffer) > maxRequestBytes) {
      handled = true;
      respond(socket, {
        ok: false,
        error: {
          kind: "RequestTooLarge",
          message: `request exceeds ${String(maxRequestBytes)} bytes`,
        },
      });
      return;
    }

    const newline = buffer.indexOf("\n");
    if (newline === -1) return;

    handled = true;
    socket.setTimeout(0);
    void dispatch(socket, buffer.slice(0, newline), options);
  });
}

async function dispatch(socket: Socket, line: string, options: InternalServerOptions) {
  const request = parseRequest(line);
  if ("kind" in request) {
    respond(socket, { ok: false, error: request });
    return;
  }

  const run = options.tokens.resolve(request.token);
  if (!run) {
    respond(socket, {
      ok: false,
      error: { kind: "Unauthorized", message: "missing, unknown or expired run token" },
    });
    return;
  }

  try {
    const result = await options.engine.run({ path: request.path, args: request.args }, (context) =>
      context.with(RunKey.Provider(run)),
    );
    respond(socket, { ok: true, result });
  } catch (error) {
    respond(socket, {
      ok: false,
      error: { kind: "Error", message: error instanceof Error ? error.message : String(error) },
    });
  }
}

function parseRequest(line: string): InternalRequest | InternalError {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { kind: "InvalidRequest", message: "request is not valid JSON" };
  }

  if (typeof value !== "object" || value === null) {
    return { kind: "InvalidRequest", message: "request must be an object" };
  }

  const record = value as Record<string, unknown>;
  const { token, path, args } = record;

  if (typeof token !== "string" || token === "") {
    return { kind: "InvalidRequest", message: "token must be a non-empty string" };
  }
  if (
    !Array.isArray(path) ||
    path.length === 0 ||
    !path.every((part) => typeof part === "string")
  ) {
    return { kind: "InvalidRequest", message: "path must be a non-empty array of strings" };
  }
  if (!Array.isArray(args)) {
    return { kind: "InvalidRequest", message: "args must be an array" };
  }

  return { token, path, args };
}

function respond(socket: Socket, response: InternalResponse) {
  socket.end(`${JSON.stringify(response)}\n`);
}
