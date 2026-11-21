import type Docker from "dockerode";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describePackage, extractDeployPackage, readDeployPackage } from "../../artifact/index.ts";
import type { LogLevel } from "../../sdk/graph.ts";
import type { RunTokenStore } from "../internal/tokens.ts";
import { DeployRepository } from "./repo.ts";
import { DEFAULT_RUN_TIMEOUT_MS, runDeployContainer } from "./run.ts";

export interface ApplyRequest {
  /** Gzipped npm package tarball. */
  tar: Uint8Array;
  message?: string;
}

export type ApplyStatus = "success" | "failed";

export interface ApplyResult {
  runId: string;
  commit: string | null;
  status: ApplyStatus;
  logs: string;
}

export interface ApplyService {
  apply(request: ApplyRequest): Promise<ApplyResult>;
}

export interface ApplyServiceOptions {
  docker: Docker;
  rootDir: string;
  repository: DeployRepository;
  tokens: RunTokenStore;
  socketPath: string;
  /** Image that runs deploy packages. */
  runnerImage: string;
  runTimeoutMs?: number;
}

/**
 * The apply pipeline: package -> validate -> git commit -> isolated run.
 *
 * The package is validated before anything is committed, so an invalid
 * artifact is a 400 and never enters the history. Dependencies are resolved in
 * CI: the runner mounts the unpacked package and imports its entry, it never
 * installs anything.
 *
 * Runs are serialized: the deploy repository and the socket are single-tenant,
 * and two overlapping applies would race on the same history.
 *
 * A failure keeps the commit and any changes the run already applied; the run
 * log is the record, and re-running the same package is safe because deploy
 * code reconciles against live state.
 */
export function createApplyService(options: ApplyServiceOptions): ApplyService {
  const queue = new SerialQueue();
  const workRoot = join(options.rootDir, "run", "work");

  return {
    apply(request) {
      return queue.run(() => applyOnce(request));
    },
  };

  async function applyOnce(request: ApplyRequest): Promise<ApplyResult> {
    // InvalidPackageError propagates to the HTTP layer as a 400.
    const pkg = readDeployPackage(request.tar);

    const runId = randomUUID();
    const logs: string[] = [];
    const append = (text: string) => logs.push(text);
    const log = (level: LogLevel, message: string) => {
      logs.push(`[${level}] ${message}\n`);
    };

    const workDir = join(workRoot, runId);
    const packageDir = join(workDir, "deploy");
    let commit: string | null = null;

    try {
      log("info", `apply started (${runId})`);
      log("info", `package ${describePackage(pkg)}`);

      commit = await options.repository.commitWorktree(
        (directory) => extractDeployPackage(pkg, directory),
        commitMessage(request.message, pkg.manifest, runId),
      );
      log("info", `committed ${commit}`);

      await extractDeployPackage(pkg, packageDir);

      const token = options.tokens.mint({ id: runId, commit, log });
      try {
        const result = await runDeployContainer(options.docker, {
          image: options.runnerImage,
          runId,
          token,
          packageDir,
          workDir,
          socketDir: dirname(options.socketPath),
          timeoutMs: options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
          onOutput: append,
        });

        if (result.timedOut) {
          throw new Error(
            `deploy run timed out after ${String(options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS)}ms`,
          );
        }
        if (result.exitCode !== 0) {
          throw new Error(`deploy run exited with code ${String(result.exitCode)}`);
        }
      } finally {
        options.tokens.revoke(token);
      }

      log("info", "apply succeeded");
      return { runId, commit, status: "success", logs: logs.join("") };
    } catch (error) {
      log("error", errorMessage(error));
      return { runId, commit, status: "failed", logs: logs.join("") };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function commitMessage(
  raw: string | undefined,
  manifest: { name: string; version: string },
  runId: string,
): string {
  const text = raw
    ?.replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 200);
  return text === undefined || text === ""
    ? `${manifest.name}@${manifest.version} (${runId.slice(0, 8)})`
    : text;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class SerialQueue {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(task, task);
    this.#tail = result.catch(() => undefined);
    return result;
  }
}
