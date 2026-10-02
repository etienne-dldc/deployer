import type { Flatten } from "../../utils/flatten.ts";

export interface TAppConfig {
  port: number;
  databasePath: string;
  triggerToken: string | null;
}

export type TFlatAppConfig = Flatten<{
  port: number;
  databasePath: string;
  triggerToken: string | null;
}>;
