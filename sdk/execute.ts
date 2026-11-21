import { connect as connectSocket } from "node:net";
import { query, queryToObject, type TQuery } from "@dldc/ts-api/client";
import type { Graph } from "./graph.ts";

/**
 * The typed ts-api query builder for the deployer Graph.
 *
 * Use it to build a query, then hand that query to `executeQuery`:
 *
 *   const version = await executeQuery(q.Graph.meta.version());
 */
export const q = query<{ Graph: Graph }>();

export interface ExecuteQueryOptions {
  /** Unix socket path. Defaults to `DEPLOYER_SOCKET`. */
  socket?: string;
  /** Per-run token. Defaults to `DEPLOYER_RUN_TOKEN`. */
  token?: string;
}

/**
 * Execute a ts-api query against the controller's internal Unix socket.
 *
 * The SDK extracts ts-api's `{ path, args }` and posts them over
 * newline-delimited JSON:
 *
 *   request:  { token, path: ["Graph", "service", "inspect"], args: ["hello"] }
 *   response: <the JSON result of the ts-api query>
 *
 * A fresh connection is opened per request. That keeps the client simple and
 * makes a failed request easy to isolate; the controller can keep serving other
 * runs in the meantime.
 */
export async function executeQuery<T>(
  builtQuery: TQuery<T>,
  options: ExecuteQueryOptions = {},
): Promise<T> {
  const socketPath = options.socket ?? process.env.DEPLOYER_SOCKET;
  const token = options.token ?? process.env.DEPLOYER_RUN_TOKEN;

  if (!socketPath) {
    throw new Error("Missing internal socket path: pass `socket` or set DEPLOYER_SOCKET");
  }
  if (!token) {
    throw new Error("Missing run token: pass `token` or set DEPLOYER_RUN_TOKEN");
  }

  const { path, args } = queryToObject(builtQuery);
  const raw = await send(socketPath, `${JSON.stringify({ token, path, args })}\n`);

  return JSON.parse(raw) as T;
}

function send(socketPath: string, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connectSocket(socketPath);
    let data = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };

    socket.setEncoding("utf8");
    socket.setTimeout(30_000);

    socket.on("connect", () => {
      socket.write(payload);
    });

    socket.on("data", (chunk: string) => {
      data += chunk;
      const newline = data.indexOf("\n");
      if (newline !== -1) {
        finish(() => resolve(data.slice(0, newline)));
      }
    });

    socket.on("timeout", () => {
      finish(() => reject(new Error("deployer request timed out")));
    });

    socket.on("error", (error) => {
      finish(() => reject(error));
    });

    socket.on("end", () => {
      if (data.trim() !== "") {
        finish(() => resolve(data.trim()));
      } else {
        finish(() => reject(new Error("deployer closed the socket without a response")));
      }
    });
  });
}
