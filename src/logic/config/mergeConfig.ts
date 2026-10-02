import type { TFlatAppConfig } from "./types.ts";

export function mergeConfig(
  base: TFlatAppConfig,
  ...overrides: Partial<TFlatAppConfig>[]
): TFlatAppConfig {
  const result: TFlatAppConfig = { ...base };
  for (const override of overrides) {
    Object.entries(override).forEach(([key, value]) => {
      if (value !== undefined) {
        // deno-lint-ignore no-explicit-any
        (result as any)[key] = value;
      }
    });
  }
  return result;
}
