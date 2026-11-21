import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  collectModuleSpecifiers,
  createSdkManifest,
  toPackageName,
  type RootPackageManifest,
} from "./sdk-package.ts";

const rootDir = process.cwd();
const sdkDistDir = join(rootDir, "dist/sdk");
const publishDir = join(rootDir, "build/npm");

const packageNames = new Set<string>();

for (const file of await listFiles(sdkDistDir)) {
  if (!/\.(?:mjs|cjs|d\.ts|d\.mts|d\.cts)$/.test(file)) continue;

  const source = await readFile(file, "utf8");
  for (const specifier of collectModuleSpecifiers(file, source)) {
    const name = toPackageName(specifier);
    if (name) packageNames.add(name);
  }
}

const rootManifest = JSON.parse(
  await readFile(join(rootDir, "package.json"), "utf8"),
) as RootPackageManifest;

const manifest = createSdkManifest(rootManifest, packageNames);

await rm(publishDir, { recursive: true, force: true });
await mkdir(publishDir, { recursive: true });
await cp(sdkDistDir, join(publishDir, "dist"), { recursive: true });

// The SDK is types-only, so the packer may not emit a runtime entry at all.
// Keep one so `exports.default` resolves for tooling; it exports nothing.
try {
  await stat(join(publishDir, "dist/index.mjs"));
} catch {
  await writeFile(join(publishDir, "dist/index.mjs"), "export {};\n");
}

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
console.log(
  `dependencies: ${
    Object.keys((manifest.dependencies as Record<string, string>) ?? {}).join(", ") || "(none)"
  }`,
);

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(path);
      return entry.isFile() ? [path] : [];
    }),
  );

  return nested.flat();
}
