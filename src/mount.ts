import { Db } from "./database/db.ts";
import { Config } from "./logic/config/config.ts";
import { Subscription } from "./logic/subscription.ts";
import type { Unmount } from "./utils/mountable.ts";

export async function mount(): Promise<Unmount> {
  const unmountConfig = await Config.mount();
  const unmountSubscription = await Subscription.mount();
  const unmountDatabase = await Db.mount();

  return async function unmount() {
    await unmountDatabase();
    await unmountSubscription();
    await unmountConfig();
  };
}
