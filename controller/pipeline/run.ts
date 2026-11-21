import type Docker from "dockerode";
import { chmod, mkdir } from "node:fs/promises";

export const RUN_LABEL = "com.deployer.run";
export const RUN_CONTAINER_PREFIX = "deployer-run-";
export const DEFAULT_RUN_TIMEOUT_MS = 120_000;

const MEMORY_LIMIT_BYTES = 512 * 1024 * 1024;
const NANO_CPUS = 1_000_000_000;

export interface RunDeployContainerOptions {
  image: string;
  runId: string;
  /** Per-run token, revoked by the caller when the run ends. */
  token: string;
  /** Host path of the deploy repository, mounted read-only at `/repo`. */
  repoDir: string;
  /** Host path of the run's scratch folder, mounted at `/work`. */
  workDir: string;
  /** Host path of the socket directory, mounted at `/run/deployer`. */
  socketDir: string;
  timeoutMs?: number;
  onOutput?: (text: string) => void;
}

export interface RunDeployContainerResult {
  exitCode: number | null;
  timedOut: boolean;
}

/**
 * Run the deploy code once, isolated.
 *
 * The run is an ephemeral container, not a Swarm service: no network, no Docker
 * socket, read-only root, a non-root user, and a wall-clock cap. Its only way
 * to act on the system is the internal socket, which reaches the controller.
 *
 * stdout/stderr and `meta.log` are both routed into the run log; ordering is
 * preserved because they share one sink.
 */
export async function runDeployContainer(
  docker: Docker,
  options: RunDeployContainerOptions,
): Promise<RunDeployContainerResult> {
  await mkdir(options.workDir, { recursive: true });
  // The run user (1000:1000) writes into /work; the controller owns the folder.
  await chmod(options.workDir, 0o777);

  const container = await docker.createContainer({
    name: `${RUN_CONTAINER_PREFIX}${options.runId}`,
    Image: options.image,
    Labels: { [RUN_LABEL]: options.runId },
    Env: ["DEPLOYER_SOCKET=/run/deployer/deployer.sock", `DEPLOYER_RUN_TOKEN=${options.token}`],
    Tty: false,
    User: "1000:1000",
    HostConfig: {
      NetworkMode: "none",
      ReadonlyRootfs: true,
      Tmpfs: { "/tmp": "rw,noexec,nosuid,size=64m" },
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      Memory: MEMORY_LIMIT_BYTES,
      NanoCpus: NANO_CPUS,
      Binds: [
        `${options.repoDir}:/repo:ro`,
        `${options.workDir}:/work`,
        `${options.socketDir}:/run/deployer`,
      ],
    },
  });

  let stream: NodeJS.ReadableStream | undefined;

  try {
    stream = await container.attach({ stream: true, stdout: true, stderr: true });
    const decoder = new MultiplexedDecoder(options.onOutput);
    stream.on("data", (chunk: Buffer) => decoder.push(chunk));
    stream.on("error", () => {
      // The container dying mid-stream is reported by the exit code below.
    });

    await container.start();

    const timeoutMs = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    const finished = await waitWithTimeout(container, timeoutMs);
    if (finished.timedOut) {
      await container.kill().catch(() => undefined);
      return { exitCode: finished.exitCode, timedOut: true };
    }

    return { exitCode: finished.exitCode, timedOut: false };
  } finally {
    if (stream && "destroy" in stream) {
      (stream as { destroy: () => void }).destroy();
    }
    await container.remove({ force: true }).catch(() => undefined);
  }
}

/** Remove containers left behind by a controller crash. */
export async function removeOrphanRuns(docker: Docker): Promise<number> {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: [RUN_LABEL] },
  });

  await Promise.all(
    containers.map((container) =>
      docker
        .getContainer(container.Id)
        .remove({ force: true })
        .catch(() => undefined),
    ),
  );

  return containers.length;
}

async function waitWithTimeout(
  container: { wait: () => Promise<{ StatusCode?: number }> },
  timeoutMs: number,
): Promise<{ exitCode: number | null; timedOut: boolean }> {
  const wait = container
    .wait()
    .then((result) => result.StatusCode ?? null)
    .catch(() => null);

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  try {
    const outcome = await Promise.race([wait, timeout]);
    if (outcome === "timeout") {
      return { exitCode: null, timedOut: true };
    }
    return { exitCode: outcome, timedOut: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Docker multiplexes stdout and stderr into frames when a container has no TTY:
 * an 8-byte header (stream type, 3 zero bytes, big-endian size) then the payload.
 */
class MultiplexedDecoder {
  readonly #onOutput: ((text: string) => void) | undefined;
  #pending: Buffer = Buffer.alloc(0);

  constructor(onOutput: ((text: string) => void) | undefined) {
    this.#onOutput = onOutput;
  }

  push(chunk: Buffer): void {
    this.#pending = this.#pending.length === 0 ? chunk : Buffer.concat([this.#pending, chunk]);

    for (;;) {
      if (this.#pending.length < 8) return;

      const type = this.#pending[0];
      if (type !== 0 && type !== 1 && type !== 2) {
        // Not a multiplexed frame: emit as-is rather than losing output.
        this.emit(this.#pending.toString("utf8"));
        this.#pending = Buffer.alloc(0);
        return;
      }

      const size = this.#pending.readUInt32BE(4);
      if (this.#pending.length < 8 + size) return;

      const payload = this.#pending.subarray(8, 8 + size);
      this.#pending = this.#pending.subarray(8 + size);
      this.emit(payload.toString("utf8"));
    }
  }

  private emit(text: string): void {
    if (text !== "") this.#onOutput?.(text);
  }
}
