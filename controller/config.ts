import { join, resolve } from "node:path";

export interface Config {
  port: number;
  host: string;
  publicToken: string;
  /**
   * Controller root holding `repo/` (the deploy git repository) and `run/`
   * (socket, scratch space). It must be a host path mounted at the same
   * location in the controller and in deploy run containers, so the bind mounts
   * the controller passes to Swarm resolve on the host.
   */
  rootDir: string;
  /** Path of the internal Unix socket used by deploy-code runs. */
  socketPath: string;
  /** Docker socket the controller connects to. */
  dockerSocket: string;
  /**
   * Image that runs deploy packages. It only needs Node and the harness; the
   * artifact is mounted read-only, so no per-deploy image is built.
   */
  runnerImage: string;
}

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_ROOT_DIR = ".deployer";
const DEFAULT_DOCKER_SOCKET = "/var/run/docker.sock";
const DEFAULT_RUNNER_IMAGE = "deployer-runner-base:dev";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicToken = env.DEPLOYER_TOKEN;
  if (!publicToken || publicToken.trim() === "") {
    throw new Error("DEPLOYER_TOKEN is required; refusing to start without it");
  }

  const rootDir = absolutePath(env.DEPLOYER_DATA_DIR, DEFAULT_ROOT_DIR);

  return {
    port: parsePort(env.PORT),
    host: env.HOST?.trim() || DEFAULT_HOST,
    publicToken,
    rootDir,
    socketPath: absolutePath(env.DEPLOYER_SOCKET_PATH, join(rootDir, "run", "deployer.sock")),
    dockerSocket: env.DOCKER_SOCKET?.trim() || DEFAULT_DOCKER_SOCKET,
    runnerImage: env.DEPLOYER_RUNNER_IMAGE?.trim() || DEFAULT_RUNNER_IMAGE,
  };
}

function absolutePath(raw: string | undefined, fallback: string): string {
  const value = raw?.trim();
  return resolve(value === undefined || value === "" ? fallback : value);
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_PORT;
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT=${JSON.stringify(raw)}`);
  }

  return port;
}
