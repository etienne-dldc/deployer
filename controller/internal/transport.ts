import { connect as connectSocket } from "node:net";
import { isInternalResponse } from "./protocol.ts";

export interface CallOptions {
  /** Unix socket path. Defaults to `DEPLOYER_SOCKET`. */
  socket?: string;
  /** Per-run token. Defaults to `DEPLOYER_RUN_TOKEN`. */
  token?: string;
  /**
   * Client-side deadline in milliseconds. Omitted means no client deadline:
   * the controller bounds its own waits (`wait.serviceConverged` takes a
   * timeout), so a fixed transport timeout must not cut a long wait short.
   */
  timeoutMs?: number;
}

/**
 * Send one request to the controller's internal Unix socket.
 *
 *   request:  { token, path: ["Graph", "service", "inspect"], args: ["hello"] }
 *   response: { ok: true, result } | { ok: false, error: { kind, message } }
 *
 * A failed call rejects with the controller's message instead of returning an
 * error object, so deploy code can let a bad apply stop the run.
 *
 * A fresh connection is opened per request. That keeps the client simple and
 * makes a failed request easy to isolate; the controller can keep serving other
 * runs in the meantime.
 */
export async function call<T>(
  path: string[],
  args: unknown[],
  options: CallOptions = {},
): Promise<T> {
  const socketPath = options.socket ?? process.env.DEPLOYER_SOCKET;
  const token = options.token ?? process.env.DEPLOYER_RUN_TOKEN;

  if (!socketPath) {
    throw new Error("Missing internal socket path: pass `socket` or set DEPLOYER_SOCKET");
  }
  if (!token) {
    throw new Error("Missing run token: pass `token` or set DEPLOYER_RUN_TOKEN");
  }

  const raw = await send(
    socketPath,
    `${JSON.stringify({ token, path, args })}\n`,
    options.timeoutMs,
  );

  let response: unknown;
  try {
    response = JSON.parse(raw);
  } catch {
    throw new Error(`deployer returned a malformed response: ${JSON.stringify(raw.slice(0, 200))}`);
  }

  if (!isInternalResponse(response)) {
    throw new Error(
      `deployer returned an unexpected response: ${JSON.stringify(raw.slice(0, 200))}`,
    );
  }
  if (!response.ok) {
    throw new Error(`${response.error.kind}: ${response.error.message}`);
  }

  return response.result as T;
}

function send(socketPath: string, payload: string, timeoutMs: number | undefined): Promise<string> {
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

    if (timeoutMs !== undefined && timeoutMs > 0) {
      socket.setTimeout(timeoutMs);
      socket.on("timeout", () => {
        finish(() => reject(new Error(`deployer request timed out after ${String(timeoutMs)}ms`)));
      });
    }

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
