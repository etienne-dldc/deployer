import { builtin, createBuiltins, DEFAULT_BUILTINS } from "@dldc/ts-api/server";
import * as v from "@valibot/valibot";
import SuperJSON from "superjson";

export const InstantBuiltin = builtin<Temporal.Instant>({
  getSchema: () => v.instance(Temporal.Instant),
});

SuperJSON.registerCustom<Temporal.Instant, string>(
  {
    isApplicable: (value): value is Temporal.Instant =>
      value instanceof Temporal.Instant,
    serialize: (value) => value.toString(),
    deserialize: (data) => Temporal.Instant.from(data),
  },
  "Temporal.Instant",
);

export const builtins = createBuiltins({
  ...DEFAULT_BUILTINS,
  "Temporal.Instant": InstantBuiltin,
});

export { SuperJSON };
