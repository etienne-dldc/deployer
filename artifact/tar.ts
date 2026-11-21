import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { InvalidPackageError } from "./errors.ts";

const BLOCK_BYTES = 512;
const DEFAULT_MAX_ENTRIES = 20_000;
const MAX_PATH_LENGTH = 1_024;

export interface ArchiveFile {
  type: "file";
  /** Normalized, archive-relative, `/`-separated. */
  path: string;
  mode: number;
  data: Uint8Array;
}

export interface ArchiveDirectory {
  type: "directory";
  path: string;
  mode: number;
}

export type ArchiveEntry = ArchiveFile | ArchiveDirectory;

interface Header {
  header: Buffer;
  rawSize: number;
  typeflag: string;
}

interface PaxFields {
  path?: string;
  size?: number;
}

export interface ParseTarOptions {
  maxEntries?: number;
}

/**
 * Parse a tar archive into validated entries.
 *
 * Hand-rolled rather than delegated to a library because the checks that
 * matter here are exactly the entry paths and types, and a parser that yields
 * them directly is easier to reason about than a streaming filter. Supports
 * ustar (prefix field), pax extended headers and GNU long names, which are what
 * `npm pack`, `git archive` and `tar` emit in practice.
 *
 * The whole archive is parsed and validated before anything is written, so a
 * bad archive never leaves a half-updated directory.
 */
export function parseTar(data: Uint8Array, options: ParseTarOptions = {}): ArchiveEntry[] {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const view = Buffer.isBuffer(data)
    ? data
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (view.length === 0) {
    throw new InvalidPackageError("archive is empty");
  }

  const entries: ArchiveEntry[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let sawHeader = false;
  let ended = false;
  let pax: PaxFields | undefined;

  while (offset + BLOCK_BYTES <= view.length) {
    const header = view.subarray(offset, offset + BLOCK_BYTES);

    if (isZeroBlock(header)) {
      ended = true;
      break;
    }

    sawHeader = true;
    verifyChecksum(header, offset);

    const { rawSize, typeflag } = readHeader(header, offset);
    const bodyStart = offset + BLOCK_BYTES;
    const bodyEnd = bodyStart + rawSize;
    if (bodyEnd > view.length) {
      throw new InvalidPackageError(`archive entry is truncated at byte ${String(offset)}`);
    }
    const body = view.subarray(bodyStart, bodyEnd);
    offset = bodyStart + Math.ceil(rawSize / BLOCK_BYTES) * BLOCK_BYTES;

    // Metadata entries describe the next real entry instead of being one.
    if (typeflag === "x" || typeflag === "g") {
      pax = { ...pax, ...parsePax(body) };
      continue;
    }
    if (typeflag === "L") {
      pax = { ...pax, path: readCString(body) };
      continue;
    }
    if (typeflag === "K") {
      // Long link target; the link entry itself is rejected below.
      continue;
    }

    const declaredSize = pax?.size;
    if (declaredSize !== undefined && declaredSize !== rawSize) {
      throw new InvalidPackageError("archive entries larger than 8 GiB are not supported");
    }

    const path = normalizePath(pax?.path ?? headerPath(header));
    pax = undefined;

    // Archives of `.` carry the target directory itself; it already exists.
    if (path === "") {
      if (typeflag !== "5") {
        throw new InvalidPackageError("archive entry has an empty path");
      }
      continue;
    }

    if (seen.size >= maxEntries) {
      throw new InvalidPackageError(`archive has more than ${String(maxEntries)} entries`);
    }
    if (seen.has(path)) {
      throw new InvalidPackageError(`archive has a duplicate entry: ${path}`);
    }
    seen.add(path);

    const mode = readNumber(header, 100, 8) & 0o777;

    if (typeflag === "0" || typeflag === "\0") {
      entries.push({ type: "file", path, mode, data: body });
    } else if (typeflag === "5") {
      entries.push({ type: "directory", path, mode });
    } else {
      throw new InvalidPackageError(
        `unsupported archive entry type ${JSON.stringify(typeflag)}: ${path}`,
      );
    }
  }

  if (!sawHeader && !ended) {
    throw new InvalidPackageError("archive is not a valid tar");
  }

  return entries;
}

export interface ExtractOptions {
  /** Mode for files; defaults to owner rw plus world read. */
  fileMode?: number;
  /** Mode for directories; defaults to owner rwx plus world rx. */
  dirMode?: number;
}

/**
 * Write parsed entries below `destination`.
 *
 * Defaults are world-readable on purpose: the run container executes as uid
 * 1000 while the controller extracts as root, so package files must not depend
 * on the owner bits of whatever produced the archive.
 */
export async function extractEntries(
  entries: ArchiveEntry[],
  destination: string,
  options: ExtractOptions = {},
): Promise<void> {
  const fileMode = options.fileMode ?? 0o644;
  const dirMode = options.dirMode ?? 0o755;

  for (const entry of entries) {
    const target = join(destination, entry.path);

    if (entry.type === "directory") {
      await mkdir(target, { recursive: true, mode: dirMode });
    } else {
      await mkdir(dirname(target), { recursive: true, mode: dirMode });
      // Owner rw is always granted: the controller must be able to replace the
      // file on the next apply whatever mode the package declared.
      await writeFile(target, entry.data, { mode: (entry.mode & 0o111) | fileMode });
    }
  }
}

function readHeader(header: Buffer, offset: number): Header {
  const sizeField = header[124];
  if (sizeField !== undefined && (sizeField & 0x80) !== 0) {
    // base-256 encoding: only used for sizes that cannot fit in octal.
    throw new InvalidPackageError(`unsupported archive encoding at byte ${String(offset)}`);
  }

  return {
    header,
    rawSize: readNumber(header, 124, 12),
    typeflag: String.fromCharCode(header[156] ?? 0),
  };
}

function headerPath(header: Buffer): string {
  const name = readCString(header.subarray(0, 100));
  const isUstar = header.subarray(257, 262).toString("latin1") === "ustar";
  const prefix = isUstar ? readCString(header.subarray(345, 500)) : "";

  return prefix === "" ? name : `${prefix}/${name}`;
}

/** Returns the archive-relative path, or `""` for the archive root (`./`). */
function normalizePath(raw: string): string {
  if (raw.length > MAX_PATH_LENGTH) {
    throw new InvalidPackageError("archive entry path is too long");
  }
  if (posix.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw)) {
    throw new InvalidPackageError(`archive entry escapes the package: ${raw}`);
  }

  const segments = raw.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) {
    throw new InvalidPackageError(`archive entry escapes the package: ${raw}`);
  }

  return segments.join("/");
}

function verifyChecksum(header: Buffer, offset: number): void {
  const stored = readNumber(header, 148, 8);

  let unsigned = 0;
  let signed = 0;
  for (let index = 0; index < BLOCK_BYTES; index += 1) {
    // The checksum field itself is summed as spaces.
    const byte = index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
    unsigned += byte;
    signed += byte > 0x7f ? byte - 0x100 : byte;
  }

  if (stored !== unsigned && stored !== signed) {
    throw new InvalidPackageError(`archive header is corrupted at byte ${String(offset)}`);
  }
}

function readNumber(header: Buffer, offset: number, length: number): number {
  const text = readCString(header.subarray(offset, offset + length)).trim();
  if (text === "") {
    return 0;
  }
  if (!/^[0-7]+$/.test(text)) {
    throw new InvalidPackageError("archive header has a malformed number");
  }

  return Number.parseInt(text, 8);
}

function readCString(field: Buffer): string {
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

function isZeroBlock(block: Buffer): boolean {
  for (const byte of block) {
    if (byte !== 0) return false;
  }

  return true;
}

/**
 * pax records are `<byte length> <key>=<value>\n`, repeated. Offsets are byte
 * offsets, so the length prefix is parsed on bytes, not on decoded characters.
 */
function parsePax(body: Uint8Array): PaxFields {
  const fields: PaxFields = {};
  let offset = 0;

  while (offset < body.length) {
    let space = offset;
    while (space < body.length && body[space] !== 0x20) space += 1;
    if (space >= body.length) {
      throw new InvalidPackageError("archive has a malformed pax header");
    }

    const length = Number.parseInt(
      Buffer.from(body.subarray(offset, space)).toString("latin1"),
      10,
    );
    const end = offset + length;
    if (!Number.isInteger(length) || length <= 0 || end > body.length || end <= space + 1) {
      throw new InvalidPackageError("archive has a malformed pax header");
    }

    const record = Buffer.from(body.subarray(space + 1, end - 1)).toString("utf8");
    const equals = record.indexOf("=");
    if (equals !== -1) {
      const key = record.slice(0, equals);
      const value = record.slice(equals + 1);

      if (key === "path") {
        fields.path = value;
      } else if (key === "size") {
        const size = Number(value);
        if (!Number.isInteger(size) || size < 0) {
          throw new InvalidPackageError("archive has a malformed pax size");
        }
        fields.size = size;
      }
    }

    offset = end;
  }

  return fields;
}
