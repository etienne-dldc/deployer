import { Config } from "../logic/config/config.ts";
import { createPathHandler } from "../logic/factory.ts";
import { ROUTES } from "../routes.ts";
import { timingSafeEqual } from "../utils/crypto.ts";

export const apiTarDeploy = createPathHandler(ROUTES.apiTarDeploy.path)((c) => {
  const token = Config.get().triggerToken;
  if (!token) {
    return c.text("Deploy endpoint is not configured", 404);
  }

  const auth = c.req.header("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return c.text("Missing or invalid authorization header", 401);
  }

  const provided = auth.slice("Bearer ".length);
  if (!timingSafeEqual(provided, token)) {
    return c.text("Invalid token", 401);
  }

  // TODO: Implement tar deploy logic here
  return c.json({ id: "TODO" }, 202);
});
