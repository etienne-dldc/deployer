import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { packageEntry, type DeployManifest } from "../artifact/package.ts";
import type { DeployContext } from "../sdk/context.ts";
import { createHarness } from "./harness-context.ts";
import { call } from "./internal/transport.ts";

/**
 * Entry point of a deploy run.
 *
 * The controller mounts the unpacked package at `/deploy` (read-only), passes a
 * per-run token and the internal socket, and starts this file. It imports the
 * package's default export and calls it with a `DeployContext`; the package
 * itself needs no dependencies.
 */
const DEFAULT_PACKAGE_DIR = "/deploy";

async function main(): Promise<void> {
  const packageDir = process.env.DEPLOYER_PACKAGE_DIR ?? DEFAULT_PACKAGE_DIR;
  const manifest = await readManifest(packageDir);
  const entry = join(packageDir, packageEntry(manifest));

  const module = (await import(pathToFileURL(entry).href)) as { default?: unknown };
  const deploy = module.default;
  if (typeof deploy !== "function") {
    throw new Error(
      `${packageEntry(manifest)} must export a default async function (export default async (ctx) => …)`,
    );
  }

  const harness = await createHarness({
    packageDir,
    call: (path, args) => call(path, args),
  });

  // A pending promise alone does not keep Node alive. Without this timer a
  // deploy that awaits something that never settles lets the process exit 0
  // and look successful; instead the controller's wall-clock timeout kills it
  // and the run is reported as timed out.
  const keepAlive = setInterval(() => undefined, 2 ** 30);

  try {
    await (deploy as (ctx: DeployContext) => Promise<void>)(harness.context);
  } finally {
    clearInterval(keepAlive);
    await harness.flushLogs();
  }
}

async function readManifest(packageDir: string): Promise<DeployManifest> {
  const source = await readFile(join(packageDir, "package.json"), "utf8");
  return JSON.parse(source) as DeployManifest;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
