import { execFile } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;

/**
 * The single deploy repository.
 *
 * `git log` is the deployment history and the debugging UI: every apply becomes
 * a commit, and the image is built from `git archive <commit>` so what runs is
 * exactly what is recorded.
 */
export class DeployRepository {
  constructor(readonly directory: string) {}

  async ensure(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    if (!(await this.hasGitDirectory())) {
      await this.git(["init", "-q"]);
    }
    await this.git(["config", "user.name", "deployer"]);
    await this.git(["config", "user.email", "deployer@localhost"]);
    await this.git(["config", "commit.gpgsign", "false"]);
    await this.git(["config", "core.autocrlf", "false"]);
  }

  /**
   * Replace the worktree with the extracted archive, commit it (even when
   * nothing changed) and return the commit sha.
   */
  async commitWorktree(
    extract: (directory: string) => Promise<void>,
    message: string,
  ): Promise<string> {
    await this.ensure();
    await this.clearWorktree();
    await extract(this.directory);

    await this.git(["add", "-A"]);
    await this.git(["commit", "-q", "--allow-empty", "-m", message]);

    return (await this.git(["rev-parse", "HEAD"])).trim();
  }

  /** The build context: the repository exactly as of `commit`. */
  async archive(commit: string): Promise<Buffer> {
    const { stdout } = await exec("git", ["archive", "--format=tar", commit], {
      cwd: this.directory,
      encoding: "buffer",
      maxBuffer: MAX_ARCHIVE_BYTES,
    });

    return Buffer.from(stdout);
  }

  private async hasGitDirectory(): Promise<boolean> {
    try {
      await readdir(join(this.directory, ".git"));
      return true;
    } catch {
      return false;
    }
  }

  private async clearWorktree(): Promise<void> {
    const entries = await readdir(this.directory, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.name !== ".git")
        .map((entry) => rm(join(this.directory, entry.name), { recursive: true, force: true })),
    );
  }

  private async git(args: string[]): Promise<string> {
    const { stdout } = await exec("git", args, {
      cwd: this.directory,
      maxBuffer: 16 * 1024 * 1024,
    });

    return stdout;
  }
}
