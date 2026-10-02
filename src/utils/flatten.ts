import type { Get, Paths, Simplify, UnionToIntersection } from "type-fest";

export type Flatten<T extends object> = Simplify<
  UnionToIntersection<
    {
      [P in Paths<T>]: P extends string
        ? Get<T, P> extends (string | number | boolean | null | undefined)
          ? { [K in P]?: Get<T, P> }
        : never
        : never;
    }[Paths<T>]
  >
>;
