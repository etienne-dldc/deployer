import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidPackageError } from "./errors.ts";
import { extractEntries, parseTar } from "./tar.ts";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "deployer-tar-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("extractEntries", () => {
  it("extracts entries into a directory", async () => {
    const target = await destination();

    await extractEntries(
      parseTar(
        makeTar([
          { name: "./", type: "5" },
          { name: "./index.js", content: "export {};\n" },
          { name: "./src/", type: "5" },
          { name: "./src/a.js", content: "a\n" },
        ]),
      ),
      target,
    );

    await expect(readFile(join(target, "src/a.js"), "utf8")).resolves.toBe("a\n");
    expect((await readdir(target)).sort()).toEqual(["index.js", "src"]);
  });

  it("makes files readable by the run user and preserves the exec bit", async () => {
    const target = await destination();

    await extractEntries(
      parseTar(
        makeTar([
          { name: "secret.js", content: "x", mode: 0o600 },
          { name: "run.sh", content: "#!/bin/sh\n", mode: 0o755 },
        ]),
      ),
      target,
    );

    expect((await stat(join(target, "secret.js"))).mode & 0o777).toBe(0o644);
    expect((await stat(join(target, "run.sh"))).mode & 0o777).toBe(0o755);
  });

  it("writes nothing when a later entry is unsafe", async () => {
    const target = await destination();

    expect(() =>
      parseTar(
        makeTar([
          { name: "safe.txt", content: "ok" },
          { name: "../evil.txt", content: "x" },
        ]),
      ),
    ).toThrow(InvalidPackageError);

    await expect(readdir(target)).resolves.toEqual([]);
  });
});

describe("parseTar", () => {
  it("normalizes paths and reports modes", () => {
    const entries = parseTar(makeTar([{ name: "./src//a.js", content: "a", mode: 0o600 }]));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: "file", path: "src/a.js", mode: 0o600 });
  });

  it("uses the ustar prefix field", () => {
    const entries = parseTar(makeTar([{ name: "a.js", prefix: "deep/dir", content: "a" }]));

    expect(entries[0]?.path).toBe("deep/dir/a.js");
  });

  it("reads the long paths a pax header carries", () => {
    const longPath = `${"a/".repeat(80)}file.js`;
    const entries = parseTar(makePaxTar(longPath, "long\n"));

    expect(entries[0]).toMatchObject({ type: "file", path: longPath });
  });

  it("rejects entries that escape the package", () => {
    expect(() => parseTar(makeTar([{ name: "../evil.txt", content: "x" }]))).toThrow(
      /escapes the package/,
    );
    expect(() => parseTar(makeTar([{ name: "/etc/evil", content: "x" }]))).toThrow(
      /escapes the package/,
    );
    expect(() => parseTar(makeTar([{ name: "src/../../evil", content: "x" }]))).toThrow(
      /escapes the package/,
    );
  });

  it("rejects links and other non-file entries", () => {
    expect(() => parseTar(makeTar([{ name: "link", content: "/etc/passwd", type: "2" }]))).toThrow(
      /unsupported archive entry type/,
    );
    expect(() => parseTar(makeTar([{ name: "hard", content: "index.js", type: "1" }]))).toThrow(
      /unsupported archive entry type/,
    );
    expect(() => parseTar(makeTar([{ name: "dev", content: "", type: "3" }]))).toThrow(
      /unsupported archive entry type/,
    );
  });

  it("rejects malformed input", () => {
    expect(() => parseTar(Buffer.from("not a tar"))).toThrow(/not a valid tar/);
    expect(() => parseTar(Buffer.alloc(0))).toThrow(/empty/);
  });

  it("rejects a corrupted header", () => {
    const archive = makeTar([{ name: "a.txt", content: "a" }]);
    archive.write("b.txt", 0, "utf8");

    expect(() => parseTar(archive)).toThrow(/corrupted/);
  });

  it("rejects a truncated entry", () => {
    const archive = makeTar([{ name: "a.txt", content: "0123456789" }]);

    expect(() => parseTar(archive.subarray(0, 512 + 5))).toThrow(/truncated/);
  });

  it("rejects duplicate entries", () => {
    expect(() =>
      parseTar(
        makeTar([
          { name: "a.txt", content: "1" },
          { name: "./a.txt", content: "2" },
        ]),
      ),
    ).toThrow(/duplicate/);
  });

  it("rejects an archive past the entry cap", () => {
    const archive = makeTar([
      { name: "a.txt", content: "1" },
      { name: "b.txt", content: "2" },
    ]);

    expect(() => parseTar(archive, { maxEntries: 1 })).toThrow(/more than 1 entries/);
  });

  it("accepts an empty archive", async () => {
    const target = await destination();

    expect(parseTar(Buffer.alloc(1024))).toEqual([]);
    await expect(extractEntries([], target)).resolves.toBeUndefined();
    await expect(readdir(target)).resolves.toEqual([]);
  });
});

async function destination(): Promise<string> {
  const path = join(directory, "package");
  await mkdir(path, { recursive: true });
  return path;
}

interface RawEntry {
  name: string;
  content?: string;
  type?: string;
  mode?: number;
  prefix?: string;
}

/** Build a raw tar header so the tests can craft paths node-tar would sanitize. */
function makeTar(entries: RawEntry[]): Buffer {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const body = Buffer.from(entry.content ?? "");
    const header = Buffer.alloc(512);

    header.write(entry.name, 0, 100, "utf8");
    writeOctal(header, 100, 8, entry.mode ?? 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, body.length);
    writeOctal(header, 136, 12, 0);
    header.write(entry.type ?? "0", 156, 1, "utf8");
    header.write("ustar\0", 257, 6, "utf8");
    header.write("00", 263, 2, "utf8");
    if (entry.prefix !== undefined) header.write(entry.prefix, 345, 155, "utf8");

    writeChecksum(header);

    blocks.push(header);
    if (body.length > 0) {
      blocks.push(body);
      const padding = (512 - (body.length % 512)) % 512;
      if (padding !== 0) blocks.push(Buffer.alloc(padding));
    }
  }

  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

/** A pax extended header followed by the entry it describes. */
function makePaxTar(path: string, content: string): Buffer {
  const record = `path=${path}\n`;
  const body = `${paxRecordLength(record)} ${record}`;

  return Buffer.concat([
    makeTarHeader({ name: "PaxHeader", type: "x", size: Buffer.byteLength(body) }),
    Buffer.from(body),
    Buffer.alloc((512 - (Buffer.byteLength(body) % 512)) % 512),
    makeTarHeader({ name: "placeholder", type: "0", size: Buffer.byteLength(content) }),
    Buffer.from(content),
    Buffer.alloc((512 - (Buffer.byteLength(content) % 512)) % 512),
    Buffer.alloc(1024),
  ]);
}

/** The pax length prefix counts itself, so solve for the fixed point. */
function paxRecordLength(record: string): number {
  const bytes = Buffer.byteLength(record);
  let total = bytes + 2;

  while (String(total).length + 1 + bytes !== total) total += 1;

  return total;
}

function makeTarHeader(options: {
  name: string;
  type: string;
  size: number;
  mode?: number;
}): Buffer {
  const header = Buffer.alloc(512);

  header.write(options.name, 0, 100, "utf8");
  writeOctal(header, 100, 8, options.mode ?? 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, options.size);
  writeOctal(header, 136, 12, 0);
  header.write(options.type, 156, 1, "utf8");
  header.write("ustar\0", 257, 6, "utf8");
  header.write("00", 263, 2, "utf8");

  writeChecksum(header);
  return header;
}

function writeChecksum(header: Buffer): void {
  header.write("        ", 148, 8, "utf8");

  let checksum = 0;
  for (const byte of header) checksum += byte;

  writeOctal(header, 148, 7, checksum);
  header.write(" ", 155, 1, "utf8");
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  buffer.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "utf8");
}
