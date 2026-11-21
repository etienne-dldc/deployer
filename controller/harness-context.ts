import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { DeployContext, DeployLogger, DeployServiceApi } from "../sdk/context.ts";
import type {
  LogLevel,
  RunInfo,
  ServiceState,
  ServiceVersion,
  WaitServiceOptions,
} from "../sdk/graph.ts";
import { equal } from "./internal/equal.ts";

/** A single Graph call; the harness binds it to the run's socket and token. */
export type HarnessCall = <T>(path: string[], args: unknown[]) => Promise<T>;

export interface Harness {
  context: DeployContext;
  /**
   * Log calls are fire-and-forget so deploy code can write `log.info("…")`
   * without awaiting. The harness waits for the queue after the deploy
   * function returns, so the last lines still reach the apply log.
   */
  flushLogs(): Promise<void>;
}

export interface HarnessOptions {
  packageDir: string;
  call: HarnessCall;
}

/**
 * Build the `DeployContext` handed to a package's default export.
 *
 * Kept separate from the harness entry point so it can be tested without a
 * container: everything it touches is the call function and the package
 * directory.
 */
export async function createHarness(options: HarnessOptions): Promise<Harness> {
  const packageDir = resolve(options.packageDir);
  const run = await options.call<RunInfo>(["Graph", "meta", "run"], []);

  const pending: Promise<unknown>[] = [];
  const log = logger((level, message) => {
    pending.push(options.call(["Graph", "meta", "log"], [level, message]).catch(() => undefined));
  });

  const service: DeployServiceApi = {
    list: () => options.call<ServiceState[]>(["Graph", "service", "list"], []),
    inspect: (name) => options.call<ServiceState | null>(["Graph", "service", "inspect"], [name]),
    create: (name, config) =>
      options.call<ServiceVersion>(["Graph", "service", "create"], [name, config]),
    update: (name, config, version) =>
      options.call<ServiceVersion>(["Graph", "service", "update"], [name, config, version]),
    remove: (name) => options.call<null>(["Graph", "service", "remove"], [name]),
  };

  const context: DeployContext = {
    run,
    packageDir,
    log,
    service,
    wait: {
      async serviceConverged(name: string, waitOptions?: WaitServiceOptions): Promise<void> {
        await options.call<null>(["Graph", "wait", "serviceConverged"], [name, waitOptions ?? {}]);
      },
    },
    equal,
    readAsset: (path) => readFile(resolveAsset(packageDir, path)),
    readTextAsset: async (path) => readFile(resolveAsset(packageDir, path), "utf8"),
    listAssets: (path) => listAssets(packageDir, path),
  };

  return {
    context,
    flushLogs: async () => {
      await Promise.allSettled(pending.splice(0));
    },
  };
}

function logger(sink: (level: LogLevel, message: string) => void): DeployLogger {
  return {
    debug: (message) => sink("debug", message),
    info: (message) => sink("info", message),
    warn: (message) => sink("warn", message),
    error: (message) => sink("error", message),
  };
}

/**
 * Resolve a package-relative path, refusing anything that escapes the package
 * root. `..` is checked after resolution, so symlink-free traversal is enough.
 */
function resolveAsset(packageDir: string, path: string): string {
  const target = resolve(packageDir, path);
  if (target !== packageDir && !target.startsWith(`${packageDir}${sep}`)) {
    throw new Error(`asset path escapes the package: ${path}`);
  }

  return target;
}

async function listAssets(packageDir: string, path: string): Promise<string[]> {
  const root = resolveAsset(packageDir, path);
  const files: string[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        files.push(relative(root, absolute));
      }
    }
  }

  await walk(root);
  return files.sort();
}
