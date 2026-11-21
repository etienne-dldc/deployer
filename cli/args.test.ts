import { describe, expect, it } from "vitest";
import { HelpRequested, UsageError, parseArgs, sanitizeMessage } from "./args.ts";

const base = { DEPLOY_HOST: "deploy.example.com" };

describe("parseArgs", () => {
  it("reads the package path and environment defaults", () => {
    expect(parseArgs(["deploy", "hello.tgz"], base)).toEqual({
      file: "hello.tgz",
      host: "deploy.example.com",
      user: "deployer",
      dryRun: false,
    });
  });

  it("accepts user@host, flags and a port", () => {
    expect(
      parseArgs(
        [
          "deploy",
          "hello.tgz",
          "--host",
          "ci@server",
          "--identity",
          "/tmp/key",
          "--port",
          "2222",
          "--message",
          "ship it",
          "--dry-run",
        ],
        {},
      ),
    ).toEqual({
      file: "hello.tgz",
      message: "ship it",
      host: "server",
      user: "ci",
      identity: "/tmp/key",
      port: 2222,
      dryRun: true,
    });
  });

  it("prefers explicit flags over the environment", () => {
    const options = parseArgs(["deploy", "a.tgz", "--host", "flag-host", "--user", "flag-user"], {
      DEPLOY_HOST: "env-host",
      DEPLOY_USER: "env-user",
      DEPLOY_KEY: "/env/key",
    });

    expect(options.host).toBe("flag-host");
    expect(options.user).toBe("flag-user");
    expect(options.identity).toBe("/env/key");
  });

  it("requires a host", () => {
    expect(() => parseArgs(["deploy", "a.tgz"], {})).toThrow(/missing host/);
  });

  it("rejects usage mistakes", () => {
    expect(() => parseArgs([], base)).toThrow(UsageError);
    expect(() => parseArgs(["push", "a.tgz"], base)).toThrow(/unknown command/);
    expect(() => parseArgs(["deploy"], base)).toThrow(/missing <package.tgz>/);
    expect(() => parseArgs(["deploy", "a.tgz", "--nope"], base)).toThrow(/unknown option/);
    expect(() => parseArgs(["deploy", "a.tgz", "--message"], base)).toThrow(/needs a value/);
    expect(() => parseArgs(["deploy", "a.tgz", "--port", "0"], base)).toThrow(/invalid ssh port/);
  });

  it("treats help as a request, not an error", () => {
    expect(() => parseArgs(["--help"], base)).toThrow(HelpRequested);
    expect(() => parseArgs(["-h"], base)).toThrow(HelpRequested);
    expect(() => parseArgs(["deploy", "a.tgz", "--help"], base)).toThrow(HelpRequested);
  });
});

describe("sanitizeMessage", () => {
  it("keeps the characters the server accepts", () => {
    expect(sanitizeMessage("feat: deploy hello (v2) #12")).toBe("feat: deploy hello (v2) #12");
  });

  it("strips newlines, quotes and shell characters", () => {
    expect(sanitizeMessage("line1\nline2; rm -rf / `whoami` $(id) '\"")).toBe(
      "line1 line2 rm -rf / whoami (id)",
    );
  });

  it("falls back and truncates", () => {
    expect(sanitizeMessage("\n\t")).toBe("manual deploy");
    expect(sanitizeMessage("a".repeat(200))).toHaveLength(140);
  });
});
