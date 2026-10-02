import { createSubscription } from "@dldc/pubsub";
import { mountable } from "../utils/mountable.ts";

export type SubscriptionEvent =
  | { kind: "todo1" }
  | { kind: "todo2" };

export const Subscription = mountable(() => {
  const sub = createSubscription<SubscriptionEvent>();

  return {
    value: sub,
    unmount: () => {
      sub.destroy();
    },
  };
});
