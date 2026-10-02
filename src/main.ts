import denoJson from "../deno.json" with { type: "json" };
import { Config } from "./logic/config/config.ts";
import { mount } from "./mount.ts";
import { createServer } from "./server.ts";

const unmount = await mount();

const config = Config.get();

console.log(`Starting Core v${denoJson.version}`);

const app = createServer();

console.log(`Core listening on :${config.port}`);
const server = Deno.serve({ port: config.port }, app.fetch);

Deno.addSignalListener("SIGTERM", async () => {
  console.log("Received SIGTERM, shutting down...");
  await server.shutdown();
  await unmount();
  Deno.exit(0);
});
