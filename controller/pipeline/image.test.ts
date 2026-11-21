import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { consumeBuild } from "./image.ts";

function streamOf(...chunks: string[]): AsyncIterable<Buffer> {
  return Readable.from(chunks.map((chunk) => Buffer.from(chunk)));
}

describe("consumeBuild", () => {
  it("returns the build stream text, platforms lines included", async () => {
    const log = await consumeBuild(
      streamOf(
        '{"stream":"#1 [internal] load build definition\\n"}\n{"stream":"#1 DONE 0.1s\\n"}\n',
        '{"aux":{"ID":"sha256:abc"}}\n',
      ),
    );

    expect(log).toBe("#1 [internal] load build definition\n#1 DONE 0.1s");
  });

  it("handles a line split across chunks", async () => {
    const log = await consumeBuild(streamOf('{"stream":"half', ' a line\\n"}\n'));

    expect(log).toBe("half a line");
  });

  it("reports each line as it arrives", async () => {
    const reported: string[] = [];

    await consumeBuild(streamOf('{"stream":"first\\n"}\n{"stream":"second\\n"}\n'), (text) =>
      reported.push(text),
    );

    expect(reported).toEqual(["first\n", "second\n"]);
  });

  it("keeps the output it saw before failing, and throws the docker error", async () => {
    const reported: string[] = [];

    await expect(
      consumeBuild(
        streamOf(
          '{"stream":"Step 1/2\\n"}\n',
          '{"errorDetail":{"message":"boom"},"error":"boom"}\n',
        ),
        (text) => reported.push(text),
      ),
    ).rejects.toThrow("image build failed: boom");

    expect(reported).toEqual(["Step 1/2\n"]);
  });

  it("passes through lines that are not JSON", async () => {
    await expect(consumeBuild(streamOf("plain output\n"))).resolves.toBe("plain output");
  });
});
