import { loadConfig } from "./config.ts";
import { createServer } from "./server.ts";

const config = loadConfig();
const server = createServer(config);

server.listen(config.port, config.host, () => {
  console.log(`deployer controller listening on http://${config.host}:${config.port}`);
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`received ${signal}, shutting down`);

  const forceExit = setTimeout(() => {
    console.error("shutdown timed out");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close((error) => {
    clearTimeout(forceExit);
    if (error) {
      console.error(error);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
