import { chmod, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { RootPackageManifest } from "./sdk-package.ts";

const rootDir = process.cwd();
const cliDistDir = join(rootDir, "dist/cli");
const publishDir = join(rootDir, "build/cli");
const binName = "deployer";
const binFile = join(publishDir, "dist/main.mjs");

/**
 * Stage the CLI for npm.
 *
 * The CLI has no runtime dependencies: it validates a `.tgz` and drives the
 * system `ssh`. That is what lets CI run it with `npx` and nothing else.
 */
const rootManifest = JSON.parse(
  await readFile(join(rootDir, "package.json"), "utf8"),
) as RootPackageManifest;

const manifest: Record<string, unknown> = {
  name: "@dldc/deployer-cli",
  version: rootManifest.version,
  description:
    "Deploy a package to @dldc/deployer — the code-as-deployment engine for Docker Swarm",
  keywords: ["deployer", "deployment", "docker", "swarm", "cli"],
  homepage: rootManifest.homepage,
  bugs: rootManifest.bugs,
  license: rootManifest.license,
  author: rootManifest.author,
  repository: rootManifest.repository,
  type: "module",
  engines: rootManifest.engines,
  bin: { [binName]: "./dist/main.mjs" },
  files: ["dist"],
  publishConfig: {
    access: "public",
    registry: "https://registry.npmjs.org",
  },
};

await rm(publishDir, { recursive: true, force: true });
await mkdir(publishDir, { recursive: true });
await cp(cliDistDir, join(publishDir, "dist"), { recursive: true });

await addShebang(binFile);

for (const file of ["README.md", "LICENSE", "LICENSE.md"]) {
  try {
    await stat(join(rootDir, file));
    await cp(join(rootDir, file), join(publishDir, file));
  } catch {
    // Optional documentation/license file.
  }
}

await writeFile(join(publishDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `staged ${String(manifest.name)}@${String(manifest.version)} in ${relative(rootDir, publishDir)}`,
);
console.log(`bin: ${binName} -> ./dist/main.mjs`);

async function addShebang(file: string): Promise<void> {
  const source = await readFile(file, "utf8");
  const withShebang = source.startsWith("#!") ? source : `#!/usr/bin/env node\n${source}`;

  await writeFile(file, withShebang);
  await chmod(file, 0o755);
}
