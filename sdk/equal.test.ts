import { describe, expect, it } from "vitest";
import { equal } from "./equal.ts";

describe("equal", () => {
  it("compares canonical configs structurally", () => {
    expect(
      equal(
        { image: "nginx", replicas: 1, env: { A: "1" } },
        { image: "nginx", replicas: 1, env: { A: "1" } },
      ),
    ).toBe(true);
    expect(equal({ image: "nginx", replicas: 1 }, { image: "nginx", replicas: 2 })).toBe(false);
  });
});
