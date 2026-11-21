import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

describe("loadConfig", () => {
  it("refuses to start without a public token", () => {
    expect(() => loadConfig({})).toThrow("DEPLOYER_TOKEN");
  });

  it("parses the port and defaults the host, socket and Docker socket", () => {
    expect(loadConfig({ DEPLOYER_TOKEN: "secret", PORT: "9000" })).toEqual({
      publicToken: "secret",
      port: 9000,
      host: "0.0.0.0",
      socketPath: resolve(".deployer/run/deployer.sock"),
      dockerSocket: "/var/run/docker.sock",
    });
  });

  it("honours socket overrides", () => {
    const config = loadConfig({
      DEPLOYER_TOKEN: "secret",
      DEPLOYER_SOCKET_PATH: "/run/deployer/deployer.sock",
      DOCKER_SOCKET: "/run/docker.sock",
    });

    expect(config.socketPath).toBe("/run/deployer/deployer.sock");
    expect(config.dockerSocket).toBe("/run/docker.sock");
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ DEPLOYER_TOKEN: "secret", PORT: "nope" })).toThrow("Invalid PORT");
  });
});
