import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

describe("loadConfig", () => {
  it("refuses to start without a public token", () => {
    expect(() => loadConfig({})).toThrow("DEPLOYER_TOKEN");
  });

  it("parses the port and defaults the host", () => {
    expect(loadConfig({ DEPLOYER_TOKEN: "secret", PORT: "9000" })).toEqual({
      publicToken: "secret",
      port: 9000,
      host: "0.0.0.0",
    });
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ DEPLOYER_TOKEN: "secret", PORT: "nope" })).toThrow("Invalid PORT");
  });
});
