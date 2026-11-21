import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import type { Server } from "node:http";
import { isAuthorized } from "./auth.ts";
import type { Config } from "./config.ts";

export function createApp(config: Config): Hono {
  const app = new Hono();

  app.use("*", async (context, next) => {
    await next();
    context.header("cache-control", "no-store");
  });

  app.get("/status", (context) => context.text("ok"));

  app.post("/api/apply", (context) => {
    if (!isAuthorized(context.req.header("authorization"), config.publicToken)) {
      return context.json({ error: "unauthorized" }, 401);
    }

    // The deploy pipeline lands next: tar -> git commit -> image build -> run.
    return context.json({ error: "apply is not implemented yet" }, 501);
  });

  app.notFound((context) => context.json({ error: "not found" }, 404));

  app.onError((error, context) => {
    console.error(error);
    return context.json({ error: "internal server error" }, 500);
  });

  return app;
}

export function createServer(config: Config): Server {
  // createAdaptorServer uses node:http by default; the cast narrows away the
  // optional http2/https variants in its return type.
  return createAdaptorServer({ fetch: createApp(config).fetch }) as Server;
}
