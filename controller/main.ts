import { rm } from "node:fs/promises";
import { loadConfig } from "./config.ts";
import { createDockerClient } from "./docker/client.ts";
import { createServiceManager } from "./docker/services.ts";
import { createDeployerEngine } from "./internal/engine.ts";
import { createInternalServer } from "./internal/server.ts";
import { RunTokenStore } from "./internal/tokens.ts";
import { createServer } from "./server.ts";

const config = loadConfig();

const docker = createDockerClient(config.dockerSocket);
const services = createServiceManager(docker);
const { engine } = createDeployerEngine(services);
const tokens = new RunTokenStore();
const internal = await createInternalServer({
  socketPath: config.socketPath,
  tokens,
  engine,
});

const server = createServer(config);

server.listen(config.port, config.host, () => {
  console.log(`deployer controller listening on http://${config.host}:${config.port}`);
  console.log(`deployer internal socket at ${config.socketPath}`);
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

  void closeAll()
    .then(() => {
      clearTimeout(forceExit);
      process.exit(0);
    })
    .catch((error: unknown) => {
      clearTimeout(forceExit);
      console.error(error);
      process.exit(1);
    });
}

async function closeAll(): Promise<void> {
  await Promise.all([closeHttp(), closeInternal()]);
}

function closeHttp(): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    server.closeAllConnections?.();
  });
}

function closeInternal(): Promise<void> {
  const closed = new Promise<void>((resolve) => {
    if (!internal.listening) {
      resolve();
      return;
    }
    internal.close(() => resolve());
  });

  return closed.then(() => rm(config.socketPath, { force: true }));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
