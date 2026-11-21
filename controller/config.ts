import { resolve } from "node:path";

export interface Config {
  port: number;
  host: string;
  publicToken: string;
  /** Path of the internal Unix socket used by deploy-code runs. */
  socketPath: string;
  /** Docker socket the controller connects to. */
  dockerSocket: string;
}

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_SOCKET_PATH = ".deployer/run/deployer.sock";
const DEFAULT_DOCKER_SOCKET = "/var/run/docker.sock";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicToken = env.DEPLOYER_TOKEN;
  if (!publicToken || publicToken.trim() === "") {
    throw new Error("DEPLOYER_TOKEN is required; refusing to start without it");
  }

  return {
    port: parsePort(env.PORT),
    host: env.HOST?.trim() || DEFAULT_HOST,
    publicToken,
    socketPath: absolutePath(env.DEPLOYER_SOCKET_PATH, DEFAULT_SOCKET_PATH),
    dockerSocket: env.DOCKER_SOCKET?.trim() || DEFAULT_DOCKER_SOCKET,
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
