import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractEntries, parseTar } from "../../artifact/tar.ts";
import { DeployRepository } from "./repo.ts";

let directory: string;
let repository: DeployRepository;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "deployer-repo-"));
  repository = new DeployRepository(join(directory, "repo"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function readCommit(commit: string): Promise<Record<string, string>> {
  const destination = join(directory, `archive-${commit.slice(0, 7)}`);
  await mkdir(destination, { recursive: true });
  await extractEntries(parseTar(await repository.archive(commit)), destination);

  const files: Record<string, string> = {};
  for (const name of await readdir(destination)) {
    files[name] = await readFile(join(destination, name), "utf8");
  }
  return files;
}

describe("DeployRepository", () => {
  it("commits the extracted worktree", async () => {
    const sha = await repository.commitWorktree(async (target) => {
      await writeFile(join(target, "index.js"), "first\n");
    }, "first deploy");

    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    await expect(readCommit(sha)).resolves.toEqual({ "index.js": "first\n" });
  });

  it("replaces the worktree instead of merging it", async () => {
    await repository.commitWorktree(async (target) => {
      await writeFile(join(target, "old.js"), "old\n");
    }, "first");

    const sha = await repository.commitWorktree(async (target) => {
      await writeFile(join(target, "new.js"), "new\n");
    }, "second");

    await expect(readCommit(sha)).resolves.toEqual({ "new.js": "new\n" });
  });

  it("records a commit even when nothing changed", async () => {
    const first = await repository.commitWorktree(async (target) => {
      await writeFile(join(target, "index.js"), "same\n");
    }, "first");

    const second = await repository.commitWorktree(async (target) => {
      await writeFile(join(target, "index.js"), "same\n");
    }, "second");

    expect(second).not.toBe(first);
    await expect(readCommit(second)).resolves.toEqual({ "index.js": "same\n" });
  });

  it("archives the committed tree, not the worktree", async () => {
    const sha = await repository.commitWorktree(async (target) => {
      await writeFile(join(target, "index.js"), "committed\n");
    }, "first");

    await writeFile(join(repository.directory, "index.js"), "dirty\n");

    await expect(readCommit(sha)).resolves.toEqual({ "index.js": "committed\n" });
  });
});
