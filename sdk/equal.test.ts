import { describe, expect, it } from "vitest";
import { equal } from "./equal.ts";

const base = {
  image: "traefik/whoami:v1.10",
  replicas: 1,
  command: ["--port", "80"],
  env: [
    { name: "B", value: "2" },
    { name: "A", value: "1" },
  ],
  labels: [
    { name: "zone", value: "eu" },
    { name: "edge.host", value: "hello.example.com" },
  ],
  ports: [
    { target: 443, published: 8443 },
    { target: 80, published: 8080 },
  ],
};

describe("equal", () => {
  it("compares plain values deeply", () => {
    expect(equal({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(equal({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });

  it("ignores the order of env, labels and ports", () => {
    const reordered = {
      ...base,
      env: [...base.env].reverse(),
      labels: [...base.labels].reverse(),
      ports: [...base.ports].reverse(),
    };

    expect(equal(base, reordered)).toBe(true);
  });

  it("treats empty and absent optional lists as the same", () => {
    expect(equal({ image: "nginx", replicas: 1 }, { image: "nginx", replicas: 1, env: [] })).toBe(
      true,
    );
    expect(
      equal({ image: "nginx", replicas: 1, command: [] }, { image: "nginx", replicas: 1 }),
    ).toBe(true);
  });

  it("keeps command order significant", () => {
    expect(equal(base, { ...base, command: ["80", "--port"] })).toBe(false);
  });

  it("detects real differences", () => {
    expect(equal(base, { ...base, replicas: 2 })).toBe(false);
    expect(equal(base, { ...base, image: "nginx" })).toBe(false);
    expect(equal(base, { ...base, env: [{ name: "A", value: "changed" }, base.env[0]] })).toBe(
      false,
    );
    expect(equal(base, { ...base, labels: [...base.labels, { name: "extra", value: "1" }] })).toBe(
      false,
    );
  });
});
