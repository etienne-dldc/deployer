import type { TFlatAppConfig } from "./types.ts";

const ALL_ENVS_VARS = {
  PORT: null,
  DATABASE_PATH: null,
  TRIGGER_TOKEN: null,
};

export type EnvVarName = keyof typeof ALL_ENVS_VARS;

export function configFromEnv(): TFlatAppConfig {
  return {
    port: parseIntEnv("PORT", 1, 65535),
    databasePath: getEnv("DATABASE_PATH"),
    triggerToken: getEnv("TRIGGER_TOKEN"),
  };
}

function getEnv(name: EnvVarName): string | undefined {
  return Deno.env.get(name);
}

function parseIntEnv(
  name: EnvVarName,
  min?: number,
  max?: number,
): number | undefined {
  const raw = Deno.env.get(name);
  if (!raw) {
    return undefined;
  }
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    console.error(
      `[env] Invalid ${name}=${JSON.stringify(raw)}, ignoring CLI value`,
    );
    return undefined;
  }
  if (min !== undefined && parsed < min) {
    console.error(
      `[env] Invalid ${name}=${parsed}, must be >= ${min}, ignoring CLI value`,
    );
    return undefined;
  }
  if (max !== undefined && parsed > max) {
    console.error(
      `[env] Invalid ${name}=${parsed}, must be <= ${max}, ignoring CLI value`,
    );
    return undefined;
  }
  return parsed;
}
