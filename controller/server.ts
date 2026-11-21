import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import type { Server } from "node:http";
import { isAuthorized } from "./auth.ts";
import type { Config } from "./config.ts";
import type { ApplyRequest, ApplyResult } from "./pipeline/apply.ts";
import { InvalidPackageError } from "../artifact/errors.ts";

/** Deploy archives are small; anything bigger is rejected before parsing. */
export const MAX_APPLY_BYTES = 20 * 1024 * 1024;

export type ApplyHandler = (request: ApplyRequest) => Promise<ApplyResult>;

export function createApp(config: Config, apply: ApplyHandler): Hono {
  const app = new Hono();

  app.use("*", async (context, next) => {
    await next();
    context.header("cache-control", "no-store");
  });

  app.get("/status", (context) => context.text("ok"));

  app.post("/api/apply", async (context) => {
    if (!isAuthorized(context.req.header("authorization"), config.publicToken)) {
      return context.json({ error: "unauthorized" }, 401);
    }

    const declared = Number(context.req.header("content-length") ?? "0");
    if (declared > MAX_APPLY_BYTES) {
      return context.json({ error: `archive exceeds ${String(MAX_APPLY_BYTES)} bytes` }, 413);
    }

    const body = new Uint8Array(await context.req.arrayBuffer());
    if (body.byteLength === 0) {
      return context.json({ error: "empty archive" }, 400);
    }
    if (body.byteLength > MAX_APPLY_BYTES) {
      return context.json({ error: `archive exceeds ${String(MAX_APPLY_BYTES)} bytes` }, 413);
    }

    try {
      const result = await apply({ tar: body, message: context.req.query("message") });
      return context.json(result);
    } catch (error) {
      if (error instanceof InvalidPackageError) {
        return context.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  app.notFound((context) => context.json({ error: "not found" }, 404));

  app.onError((error, context) => {
    console.error(error);
    return context.json({ error: "internal server error" }, 500);
  });

  return app;
}

export function createServer(config: Config, apply: ApplyHandler): Server {
  // createAdaptorServer uses node:http by default; the cast narrows away the
  // optional http2/https variants in its return type.
  return createAdaptorServer({ fetch: createApp(config, apply).fetch }) as Server;
}
