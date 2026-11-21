import { basename, resolve } from "node:path";
import { c as createTarStream } from "tar";

/** Must match the controller's `MAX_APPLY_BYTES`. */
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;

const EXCLUDED = new Set([
  ".git",
  "node_modules",
  ".deployer",
  "dist",
  "build",
  "coverage",
  ".DS_Store",
]);

interface DeployResult {
  runId: string;
  commit: string | null;
  status: "success" | "failed";
  logs: string;
}

async function main(argv: string[]): Promise<number> {
  const [command, directory, ...rest] = argv;

  if (command !== "deploy" || directory === undefined) {
    console.error("usage: deployer deploy <directory> [--message <text>]");
    return 2;
  }

  const message = parseMessage(rest);
  if (message === null) return 2;

  const token = process.env.DEPLOYER_TOKEN;
  if (!token || token.trim() === "") {
    console.error("DEPLOYER_TOKEN is required");
    return 2;
  }

  const url = (process.env.DEPLOYER_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
  const source = resolve(directory);
  const archive = await createArchive(source);

  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    console.error(
      `archive is ${String(archive.byteLength)} bytes; the limit is ${String(MAX_ARCHIVE_BYTES)}`,
    );
    return 1;
  }

  console.error(`deploying ${basename(source)} (${String(archive.byteLength)} bytes) to ${url}`);

  const query = message === undefined ? "" : `?message=${encodeURIComponent(message)}`;
  const response = await fetch(`${url}/api/apply${query}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-tar",
    },
    body: archive,
  });

  const text = await response.text();
  if (!response.ok) {
    console.error(`apply failed (${String(response.status)}): ${text}`);
    return 1;
  }

  const result = JSON.parse(text) as DeployResult;
  console.log(
    `run ${result.runId}: ${result.status}${result.commit ? ` (commit ${result.commit})` : ""}`,
  );
  if (result.logs !== "")
    process.stdout.write(result.logs.endsWith("\n") ? result.logs : `${result.logs}\n`);

  return result.status === "success" ? 0 : 1;
}

function parseMessage(args: string[]): string | undefined | null {
  if (args.length === 0) return undefined;
  if (args.length === 2 && args[0] === "--message") return args[1];
  console.error(`unknown arguments: ${args.join(" ")}`);
  return null;
}

async function createArchive(directory: string): Promise<Buffer> {
  // node-tar's async pack is a Minipass stream: async-iterable, but not a
  // node:stream Readable, and its overloads hide that behind a union type.
  const stream = createTarStream(
    {
      cwd: directory,
      portable: true,
      filter: (path) => !path.split("/").some((part) => EXCLUDED.has(part)),
    },
    ["."],
  ) as unknown as AsyncIterable<Uint8Array>;

  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);

  return Buffer.concat(chunks);
}

process.exitCode = await main(process.argv.slice(2));
