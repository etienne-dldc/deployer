import { mountable, type TMountResult } from "../../utils/mountable.ts";
import { configFromEnv, type EnvVarName } from "./configFromEnv.ts";
import { DEFAULT_CONFIG } from "./defaultConfig.ts";
import { mergeConfig } from "./mergeConfig.ts";
import type { TAppConfig, TFlatAppConfig } from "./types.ts";

export const Config = mountable(
  (
    configOverride: Partial<TFlatAppConfig> = {},
  ): TMountResult<TAppConfig> => {
    const flatConfig = mergeConfig(
      DEFAULT_CONFIG,
      configFromEnv(),
      configOverride,
    );

    const config: TAppConfig = {
      port: definedOrFail(flatConfig, "port", "PORT"),
      databasePath: definedOrFail(flatConfig, "databasePath", "DATABASE_PATH"),
      triggerToken: flatConfig.triggerToken ?? null,
    };

    return {
      value: config,
    };
  },
);

function definedOrFail<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  key: K,
  envVar: EnvVarName,
): NonNullable<T[K]> {
  const value = obj[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(
      `Missing required config value: ${String(key)} (set ${envVar} env var)`,
    );
  }
  return value;
}
