import { createHash, randomBytes } from "node:crypto";
import type { LogLevel } from "../../sdk/graph.ts";
import type { RunIdentity } from "./run-context.ts";

export interface MintRunOptions {
  /** Run id, as recorded in the run log. */
  id: string;
  /** Commit the run executes, as recorded in git. */
  commit: string;
  /** Sink for `meta.log()`; the apply pipeline attaches the run's log buffer. */
  log?: (level: LogLevel, message: string) => void;
  /** The token stops resolving after this delay. */
  ttlMs?: number;
}

interface RegisteredRun {
  identity: RunIdentity;
  expiresAt: number | null;
}

const NOOP_LOG = (): void => {};

/**
 * Per-run tokens for the internal socket.
 *
 * Tokens are minted when an apply starts and revoked when it ends or times out.
 * Only their SHA-256 hash is kept, so a memory dump does not hand out live
 * tokens, and lookup by hash avoids comparing secrets byte by byte.
 */
export class RunTokenStore {
  readonly #runs = new Map<string, RegisteredRun>();

  get size(): number {
    return this.#runs.size;
  }

  mint(options: MintRunOptions): string {
    const token = randomBytes(32).toString("hex");
    this.#runs.set(hashToken(token), {
      identity: { id: options.id, commit: options.commit, log: options.log ?? NOOP_LOG },
      expiresAt: options.ttlMs === undefined ? null : Date.now() + options.ttlMs,
    });
    return token;
  }

  resolve(token: string): RunIdentity | null {
    const key = hashToken(token);
    const run = this.#runs.get(key);
    if (!run) return null;

    if (run.expiresAt !== null && run.expiresAt <= Date.now()) {
      this.#runs.delete(key);
      return null;
    }

    return run.identity;
  }

  revoke(token: string): boolean {
    return this.#runs.delete(hashToken(token));
  }

  /** Drop expired entries; call on a timer or after a run batch. */
  prune(): void {
    const now = Date.now();
    for (const [key, run] of this.#runs) {
      if (run.expiresAt !== null && run.expiresAt <= now) {
        this.#runs.delete(key);
      }
    }
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
