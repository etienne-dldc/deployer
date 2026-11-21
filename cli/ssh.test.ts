import { describe, expect, it } from "vitest";
import { sshArgs } from "./ssh.ts";

describe("sshArgs", () => {
  it("builds a batch command with the forced-command message", () => {
    expect(
      sshArgs({
        host: "server",
        user: "deployer",
        message: "hello-deploy@0.0.0",
        batch: true,
      }),
    ).toEqual([
      "-T",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "BatchMode=yes",
      "deployer@server",
      "deploy hello-deploy@0.0.0",
    ]);
  });

  it("passes the identity, disables other keys, and sets the port", () => {
    expect(
      sshArgs({
        host: "server",
        user: "ci",
        identity: "/tmp/key",
        port: 2222,
        message: "ship",
        batch: false,
      }),
    ).toEqual([
      "-T",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-p",
      "2222",
      "-i",
      "/tmp/key",
      "-o",
      "IdentitiesOnly=yes",
      "ci@server",
      "deploy ship",
    ]);
  });
});
