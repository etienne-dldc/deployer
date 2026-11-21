import type Docker from "dockerode";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LogLevel } from "../../sdk/graph.ts";
import type { RunTokenStore } from "../internal/tokens.ts";
import { buildDeployImage } from "./image.ts";
import { DeployRepository } from "./repo.ts";
import { DEFAULT_RUN_TIMEOUT_MS, runDeployContainer } from "./run.ts";
import { extractRepositoryTar } from "./tar.ts";

export interface ApplyRequest {
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
  runTimeoutMs?: number;
}

/**
 * The apply pipeline: received tar -> git commit -> image build -> isolated run.
 *
 * Runs are serialized: the deploy repository and the socket are single-tenant,
 * and two overlapping applies would race on the same history.
 *
 * A failure keeps the commit and any changes the run already applied; the run
 * log is the record, and re-running the same tar is safe because deploy code
 * reconciles against live state.
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
    const runId = randomUUID();
    const logs: string[] = [];
    const append = (text: string) => logs.push(text);
    const log = (level: LogLevel, message: string) => {
      logs.push(`[${level}] ${message}\n`);
    };

    const workDir = join(workRoot, runId);
    let commit: string | null = null;

    try {
      log("info", `apply started (${runId})`);

      commit = await options.repository.commitWorktree(
        (directory) => extractRepositoryTar(request.tar, directory),
        commitMessage(request.message, runId),
      );
      log("info", `committed ${commit}`);

      const context = await options.repository.archive(commit);
      const image = await buildDeployImage(options.docker, context, commit);
      log("info", `built ${image.tag}`);

      const token = options.tokens.mint({ id: runId, commit, log });
      try {
        const result = await runDeployContainer(options.docker, {
          image: image.tag,
          runId,
          token,
          repoDir: options.repository.directory,
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

function commitMessage(raw: string | undefined, runId: string): string {
  const text = raw
    ?.replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 200);
  return text === undefined || text === ""
    ? `deploy ${new Date().toISOString()} (${runId.slice(0, 8)})`
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
