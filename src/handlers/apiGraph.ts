import * as v from "@valibot/valibot";
import { SuperJSON } from "../graph/builtins.ts";
import { engine } from "../graph/engine.ts";
import { createPathHandler } from "../logic/factory.ts";
import { ROUTES } from "../routes.ts";

const bodySchema = v.object({
  path: v.array(v.string()),
  args: v.any(),
});

/**
 * Accept both a superjson envelope (`{ json, meta }`, produced by
 * `SuperJSON.stringify` on the client) and plain JSON bodies (`{ path, args }`).
 * superjson's `parse` only understands its own envelope and returns `undefined`
 * for a plain object, so detect it first.
 */
function parseBody(text: string): unknown {
  const value = JSON.parse(text);
  if (
    typeof value === "object" && value !== null && !Array.isArray(value) &&
    "json" in value
  ) {
    return SuperJSON.parse(text);
  }
  return value;
}

export const apiGraph = createPathHandler(ROUTES.apiGraph.path)(async (c) => {
  const body = await c.req.text();
  const bodyAny = parseBody(body);
  const { path, args } = v.parse(bodySchema, bodyAny);
  const result = await engine.run({ path, args });
  return new Response(SuperJSON.stringify(result), {
    headers: { "content-type": "application/json" },
  });
});
