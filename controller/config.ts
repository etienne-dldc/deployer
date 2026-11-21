export interface Config {
  port: number;
  host: string;
  publicToken: string;
}

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "0.0.0.0";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicToken = env.DEPLOYER_TOKEN;
  if (!publicToken || publicToken.trim() === "") {
    throw new Error("DEPLOYER_TOKEN is required; refusing to start without it");
  }

  return {
    port: parsePort(env.PORT),
    host: env.HOST?.trim() || DEFAULT_HOST,
    publicToken,
  };
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
