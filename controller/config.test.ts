import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

describe("loadConfig", () => {
  it("refuses to start without a public token", () => {
    expect(() => loadConfig({})).toThrow("DEPLOYER_TOKEN");
  });

  it("parses the port and defaults the host, root and sockets", () => {
    expect(loadConfig({ DEPLOYER_TOKEN: "secret", PORT: "9000" })).toEqual({
      publicToken: "secret",
      port: 9000,
      host: "0.0.0.0",
      rootDir: resolve(".deployer"),
      socketPath: resolve(".deployer/run/deployer.sock"),
      dockerSocket: "/var/run/docker.sock",
    });
  });

  it("derives the socket from the data directory", () => {
    const config = loadConfig({
      DEPLOYER_TOKEN: "secret",
      DEPLOYER_DATA_DIR: "/root/deployer-data",
      DOCKER_SOCKET: "/run/docker.sock",
    });

    expect(config.rootDir).toBe("/root/deployer-data");
    expect(config.socketPath).toBe("/root/deployer-data/run/deployer.sock");
    expect(config.dockerSocket).toBe("/run/docker.sock");
  });

  it("honours an explicit socket path", () => {
    const config = loadConfig({
      DEPLOYER_TOKEN: "secret",
      DEPLOYER_DATA_DIR: "/data",
      DEPLOYER_SOCKET_PATH: "/run/deployer/deployer.sock",
    });

    expect(config.rootDir).toBe("/data");
    expect(config.socketPath).toBe("/run/deployer/deployer.sock");
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ DEPLOYER_TOKEN: "secret", PORT: "nope" })).toThrow("Invalid PORT");
  });
});
