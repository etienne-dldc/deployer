import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const ssh2Stub = fileURLToPath(new URL("./controller/docker/ssh2-stub.ts", import.meta.url));

export default defineConfig({
  test: {
    include: [
      "artifact/**/*.test.ts",
      "cli/**/*.test.ts",
      "sdk/**/*.test.ts",
      "controller/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    environment: "node",
  },

  fmt: {
    ignorePatterns: [
      "**/*.md",
      ".github/**",
      "build/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "pnpm-lock.yaml",
    ],
  },

  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "no-explicit-any": "off",
    },
  },

  pack: [
    {
      name: "sdk",
      entry: {
        index: "sdk/index.ts",
      },
      outDir: "dist/sdk",
      format: ["esm"],
      dts: true,
      sourcemap: true,
      clean: true,
      deps: {
        onlyImport: ["@dldc/ts-api"],
      },
    },
    {
      name: "controller",
      entry: {
        main: "controller/main.ts",
      },
      outDir: "dist/controller",
      format: ["esm"],
      dts: false,
      sourcemap: true,
      clean: true,
      deps: {
        // The controller image is self-contained: shared runtime dependencies
        // are bundled, and the emitted code must not import an external package.
        alwaysBundle: ["@dldc/ts-api", "@dldc/ts-api/server"],
        onlyBundle: false,
        onlyImport: [],
      },
      alias: {
        // docker-modem imports ssh2 (and its native binding) eagerly; the
        // controller only supports a local Unix socket.
        ssh2: ssh2Stub,
      },
    },
    {
      name: "harness",
      entry: {
        main: "controller/harness.ts",
      },
      outDir: "dist/harness",
      format: ["esm"],
      dts: false,
      sourcemap: true,
      clean: true,
      deps: {
        // Runs inside the runner image: node builtins only.
        alwaysBundle: [],
        onlyBundle: false,
        onlyImport: [],
      },
    },
    {
      name: "cli",
      entry: {
        main: "cli/main.ts",
      },
      outDir: "dist/cli",
      format: ["esm"],
      dts: false,
      sourcemap: true,
      clean: true,
      deps: {
        // The published CLI must not depend on anything but node builtins.
        alwaysBundle: [],
        onlyBundle: false,
        onlyImport: [],
      },
    },
  ],
});
