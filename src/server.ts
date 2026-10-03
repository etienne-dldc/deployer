import { Hono } from "@hono/hono";
import { apiEvents } from "./handlers/apiEvents.ts";
import { apiGraph } from "./handlers/apiGraph.ts";
import { ROUTES } from "./routes.ts";

export function createServer() {
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    if (!c.req.path.startsWith("/public/")) {
      c.header("cache-control", "no-store");
    }
  });

  app.get(ROUTES.status.path, (c) => c.text("ok"));
  app.post(ROUTES.apiGraph.path, ...apiGraph);
  app.get(ROUTES.apiEvents.path, ...apiEvents);

  return app;
}
