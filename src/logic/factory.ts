import type { Context, Next } from "@hono/hono";
import {
  createFactory,
  type CreateHandlersInterface,
} from "@hono/hono/factory";
import { routePath } from "@hono/hono/route";

export const { createApp, createHandlers, createMiddleware } = createFactory<
  { Variables: never }
>();

export function createPathHandler<P extends string>(
  path: P,
): CreateHandlersInterface<{ Variables: never }, P> {
  return (...handlers: any[]) =>
    (createHandlers as any)(
      (c: Context, next: Next) => {
        const currentPath = routePath(c);
        if (currentPath !== path) {
          throw new Error(
            `Invalid path: expected ${path}, got ${currentPath}`,
          );
        }
        return next();
      },
      ...handlers,
    );
}
