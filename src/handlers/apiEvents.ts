import { streamSSE } from "@hono/hono/streaming";
import { createPathHandler } from "../logic/factory.ts";
import { Subscription } from "../logic/subscription.ts";
import { ROUTES } from "../routes.ts";

export const apiEvents = createPathHandler(ROUTES.apiEvents.path)((c) => {
  const sub = Subscription.get();
  return streamSSE(c, async (stream) => {
    let queue = Promise.resolve();
    const unsub = sub.subscribe((event) => {
      queue = queue.then(async () => {
        await stream.writeSSE({
          event: event.kind,
          data: JSON.stringify(event),
        });
      }).catch((err) => {
        console.error("[sse] Failed to send event:", err);
      });
    });

    const heartbeat = setInterval(() => {
      stream.writeSSE({ data: "" }).catch(() => {});
    }, 15_000);

    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        clearInterval(heartbeat);
        unsub();
        resolve();
      });
    });
  });
});
