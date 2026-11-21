import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEPLOY_API_VERSION,
  describePackage,
  extractDeployPackage,
  findBareSpecifier,
  readDeployPackage,
} from "./package.ts";

const manifest = {
  name: "hello-deploy",
  version: "0.0.0",
  type: "module",
  main: "dist/deploy.js",
  deployer: { api: DEPLOY_API_VERSION },
};

afterEach(async () => {
  // Tests that extract create their own temp directory.
});

describe("readDeployPackage", () => {
  it("reads a valid package and resolves the entry", () => {
    const pkg = readDeployPackage(
      makePackage({ "dist/deploy.js": "export default async () => {};\n" }),
    );

    expect(pkg.manifest.name).toBe("hello-deploy");
    expect(pkg.entry).toBe("dist/deploy.js");
    expect(pkg.files.map((file) => file.path).sort()).toEqual(["dist/deploy.js", "package.json"]);
  });

  it("resolves the entry from exports", () => {
    const pkg = readDeployPackage(
      makePackage(
        { "dist/deploy.js": "export default async () => {};\n" },
        { main: undefined, exports: { ".": { import: "./dist/deploy.js" } } },
      ),
    );

    expect(pkg.entry).toBe("dist/deploy.js");
  });

  it("rejects anything that is not a gzipped package", () => {
    expect(() => readDeployPackage(new Uint8Array())).toThrow(/empty/);
    expect(() => readDeployPackage(Buffer.from("not gzip"))).toThrow(/not gzipped/);
    expect(() => readDeployPackage(Buffer.from([0x1f, 0x8b, 0, 0]))).toThrow(
      /could not be decompressed/,
    );
  });

  it("requires package.json", () => {
    expect(() => readDeployPackage(makePackage({}, manifest, { omitManifest: true }))).toThrow(
      /package\.json is missing/,
    );
  });

  it("requires an ES module entry", () => {
    expect(() => readDeployPackage(makePackage({}, { type: "commonjs" }))).toThrow(
      /"type": "module"/,
    );
  });

  it("requires the controller's API version", () => {
    expect(() =>
      readDeployPackage(makePackage({}, { deployer: { api: DEPLOY_API_VERSION + 1 } })),
    ).toThrow(/targets deployer API 2/);

    expect(() => readDeployPackage(makePackage({}, { deployer: undefined }))).toThrow(
      /targets deployer API \(none\)/,
    );
  });

  it("requires the declared entry to exist inside the package", () => {
    expect(() => readDeployPackage(makePackage({}, { main: "dist/missing.js" }))).toThrow(
      /entry "dist\/missing\.js" is not part of the package/,
    );
    expect(() => readDeployPackage(makePackage({}, { main: "../escape.js" }))).toThrow(
      /escapes the package/,
    );
    expect(() => readDeployPackage(makePackage({}, { main: undefined }))).toThrow(/needs an entry/);
  });

  it("rejects runtime dependencies without node_modules", () => {
    expect(() => readDeployPackage(makePackage({}, { dependencies: { zod: "^4.0.0" } }))).toThrow(
      /depends on zod but does not ship node_modules/,
    );
  });

  it("allows a package that ships node_modules", () => {
    const pkg = readDeployPackage(
      makePackage(
        {
          "dist/deploy.js": 'import { z } from "zod";\nexport default async () => {};\n',
          "node_modules/zod/index.js": "export const z = 1;\n",
        },
        { dependencies: { zod: "^4.0.0" }, bundledDependencies: ["zod"] },
      ),
    );

    expect(pkg.files).toHaveLength(3);
  });

  it("rejects a bare specifier left in the build", () => {
    expect(() =>
      readDeployPackage(
        makePackage({
          "dist/deploy.js":
            'import { equal } from "@dldc/deployer-sdk";\nexport default async () => {};\n',
        }),
      ),
    ).toThrow(/dist\/deploy\.js imports "@dldc\/deployer-sdk"/);
  });

  it("accepts builtins, relative imports and data imports", () => {
    const pkg = readDeployPackage(
      makePackage({
        "dist/config.js": "export const name = 'x';\n",
        "dist/deploy.js": [
          'import { readFile } from "node:fs/promises";',
          'import { name } from "./config.js";',
          'const extra = await import("data:text/javascript,export default 1");',
          "export default async () => ({ readFile, name, extra });",
          "",
        ].join("\n"),
      }),
    );

    expect(pkg.entry).toBe("dist/deploy.js");
  });

  it("ignores entries outside package/", () => {
    const pkg = readDeployPackage(
      makePackage({ "dist/deploy.js": "export default async () => {};\n" }, manifest, {
        extra: [{ name: "pax_global_header", content: "ignored" }],
      }),
    );

    expect(pkg.files.some((file) => file.path === "pax_global_header")).toBe(false);
  });
});

describe("describePackage", () => {
  it("summarizes the artifact", () => {
    const pkg = readDeployPackage(
      makePackage({ "dist/deploy.js": "export default async () => {};\n" }),
    );

    expect(describePackage(pkg)).toMatch(/^hello-deploy@0\.0\.0 \(2 files, \d+ bytes\)$/);
  });
});

describe("extractDeployPackage", () => {
  it("writes the package with modes the run user can read", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deployer-package-"));
    try {
      const pkg = readDeployPackage(
        makePackage({ "dist/deploy.js": "export default async () => {};\n" }),
      );

      await extractDeployPackage(pkg, directory);

      await expect(readFile(join(directory, "dist/deploy.js"), "utf8")).resolves.toContain(
        "export default",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("findBareSpecifier", () => {
  it("reports the first unresolvable import", () => {
    const found = findBareSpecifier([
      {
        path: "index.js",
        data: Buffer.from('import { x } from "left-pad";\n'),
      },
    ]);

    expect(found).toEqual({ file: "index.js", specifier: "left-pad" });
  });

  it("ignores non-script files", () => {
    const found = findBareSpecifier([
      { path: "README.md", data: Buffer.from('import x from "left-pad";\n') },
    ]);

    expect(found).toBeNull();
  });

  it("ignores imports that only appear in comments or JSDoc", () => {
    const found = findBareSpecifier([
      {
        path: "index.js",
        data: Buffer.from(
          [
            "// import x from 'left-pad';",
            "/* export * from 'right-pad'; */",
            "/**",
            ' * @param {import("@dldc/deployer-sdk").DeployContext} ctx',
            " */",
            "export default async (ctx) => ctx;",
            "",
          ].join("\n"),
        ),
      },
    ]);

    expect(found).toBeNull();
  });
});

interface PackageOptions {
  omitManifest?: boolean;
  extra?: { name: string; content: string }[];
}

function makePackage(
  files: Record<string, string>,
  overrides: Record<string, unknown> = {},
  options: PackageOptions = {},
): Buffer {
  const value: Record<string, unknown> = { ...manifest, ...overrides };
  for (const key of Object.keys(overrides)) {
    if (overrides[key] === undefined) delete value[key];
  }

  const entries: { name: string; content: string }[] = [];

  if (options.omitManifest !== true) {
    entries.push({ name: "package/package.json", content: `${JSON.stringify(value, null, 2)}\n` });
  }
  for (const [path, content] of Object.entries(files)) {
    entries.push({ name: `package/${path}`, content });
  }
  entries.push(...(options.extra ?? []));

  return gzipSync(makeTar(entries));
}

function makeTar(entries: { name: string; content: string }[]): Buffer {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const body = Buffer.from(entry.content);
    const header = Buffer.alloc(512);

    header.write(entry.name, 0, 100, "utf8");
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, body.length);
    writeOctal(header, 136, 12, 0);
    header.write("0", 156, 1, "utf8");
    header.write("ustar\0", 257, 6, "utf8");
    header.write("00", 263, 2, "utf8");
    writeChecksum(header);

    blocks.push(header, body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding !== 0) blocks.push(Buffer.alloc(padding));
  }

  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function writeChecksum(header: Buffer): void {
  header.write("        ", 148, 8, "utf8");

  let checksum = 0;
  for (const byte of header) checksum += byte;

  writeOctal(header, 148, 7, checksum);
  header.write(" ", 155, 1, "utf8");
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  buffer.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "utf8");
}
