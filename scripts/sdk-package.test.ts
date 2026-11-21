import { describe, expect, it } from "vitest";
import { collectModuleSpecifiers, createSdkManifest, toPackageName } from "./sdk-package.ts";

describe("collectModuleSpecifiers", () => {
  it("finds static, dynamic, type, and require imports", () => {
    const source = `
      import { value } from "@scope/pkg/subpath";
      import type { Type } from "types-only";
      export { reexported } from "reexported";
      const dynamic = import("dynamic-pkg");
      const required = require("cjs-pkg");
      import fs from "node:fs";
      import local from "./local.js";

      type Imported = import("type-pkg").Type;
    `;

    expect(new Set(collectModuleSpecifiers("index.mjs", source))).toEqual(
      new Set([
        "@scope/pkg/subpath",
        "types-only",
        "reexported",
        "dynamic-pkg",
        "cjs-pkg",
        "node:fs",
        "./local.js",
        "type-pkg",
      ]),
    );
  });
});

describe("toPackageName", () => {
  it("maps specifiers to package names", () => {
    expect(toPackageName("@scope/pkg/subpath")).toBe("@scope/pkg");
    expect(toPackageName("lodash/fp")).toBe("lodash");
    expect(toPackageName("node:fs")).toBeNull();
    expect(toPackageName("fs")).toBeNull();
    expect(toPackageName("./local.js")).toBeNull();
    expect(toPackageName("#internal")).toBeNull();
    expect(toPackageName("https://example.com/mod.js")).toBeNull();
  });
});

describe("createSdkManifest", () => {
  it("keeps only deps used by the emitted SDK", () => {
    const manifest = createSdkManifest(
      {
        name: "@dldc/deployer-sdk",
        version: "1.2.3",
        description: "test",
        type: "module",
        sideEffects: false,
        dependencies: {
          used: "^1.0.0",
          unused: "^2.0.0",
        },
        peerDependencies: {
          peer: "^3.0.0",
        },
        optionalDependencies: {
          optional: "^4.0.0",
        },
      },
      ["optional", "used", "peer", "used"],
    );

    expect(manifest).toMatchObject({
      name: "@dldc/deployer-sdk",
      version: "1.2.3",
      types: "./dist/index.d.mts",
      dependencies: { used: "^1.0.0" },
      peerDependencies: { peer: "^3.0.0" },
      optionalDependencies: { optional: "^4.0.0" },
      exports: {
        ".": {
          types: "./dist/index.d.mts",
          default: "./dist/index.mjs",
        },
      },
      files: ["dist"],
    });
    expect(manifest).not.toHaveProperty("devDependencies");
  });

  it("fails when the SDK output needs an undeclared package", () => {
    expect(() =>
      createSdkManifest(
        {
          name: "@dldc/deployer-sdk",
          version: "1.2.3",
        },
        ["missing"],
      ),
    ).toThrow('SDK output imports "missing"');
  });
});
