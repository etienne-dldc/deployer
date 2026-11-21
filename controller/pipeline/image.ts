import type Docker from "dockerode";
import { Readable } from "node:stream";

export interface DeployImage {
  tag: string;
  log: string;
}

/**
 * Build the deploy-code image from the commit's tar, through the Docker API.
 *
 * The tag carries the commit, so an image can always be traced back to the
 * history entry that produced it.
 *
 * `onOutput` receives the build output as it arrives (one call per line), so a
 * failed build is debuggable from the run log instead of only reporting an exit
 * code.
 */
export async function buildDeployImage(
  docker: Docker,
  context: Buffer,
  commit: string,
  onOutput?: (text: string) => void,
): Promise<DeployImage> {
  const tag = `deployer-run:${commit}`;
  const stream = (await docker.buildImage(Readable.from([context]), {
    t: tag,
    rm: true,
    forcerm: true,
  })) as AsyncIterable<Buffer> & NodeJS.ReadableStream;

  return { tag, log: await consumeBuild(stream, onOutput) };
}

/**
 * Docker streams the build as newline-delimited JSON. The stream still ends
 * with HTTP 200 when the build fails, so an `error` line is the only signal
 * that the image does not exist.
 */
export async function consumeBuild(
  stream: AsyncIterable<Buffer>,
  onOutput?: (text: string) => void,
): Promise<string> {
  const lines: string[] = [];
  let pending = "";

  const handle = (line: string): void => {
    const text = decodeLine(line);
    if (text === null || text === "") return;

    lines.push(text);
    onOutput?.(`${text}\n`);
  };

  for await (const chunk of stream) {
    pending += chunk.toString("utf8");

    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (line !== "") handle(line);
      newline = pending.indexOf("\n");
    }
  }

  if (pending.trim() !== "") handle(pending.trim());

  return lines.join("\n");
}

function decodeLine(line: string): string | null {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return line;
  }

  const record = message as {
    error?: unknown;
    errorDetail?: { message?: unknown };
    stream?: unknown;
  };

  if (typeof record.error === "string" && record.error !== "") {
    throw new Error(`image build failed: ${record.error}`);
  }
  if (typeof record.stream === "string") {
    return record.stream.trimEnd();
  }

  return null;
}
