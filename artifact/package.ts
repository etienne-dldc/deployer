import { isBuiltin } from "node:module";
import { gunzipSync } from "node:zlib";
import { InvalidPackageError } from "./errors.ts";
import { extractEntries, parseTar, type ArchiveEntry } from "./tar.ts";

/** The runtime contract the artifact targets. Bump only on a breaking change. */
export const DEPLOY_API_VERSION = 1;

const PREFIX = "package/";
const GZIP_MAGIC = [0x1f, 0x8b] as const;

/** Compressed and decompressed caps, checked before anything is written. */
export const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
export const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;

export interface DeployManifest {
  name: string;
  version: string;
  type?: string;
  main?: string;
  exports?: unknown;
  files?: string[];
  deployer?: { api?: number };
  dependencies?: Record<string, string>;
  bundledDependencies?: string[] | boolean;
  [key: string]: unknown;
}

export interface PackageFile {
  /** Package-relative, `/`-separated. */
  path: string;
  mode: number;
  data: Uint8Array;
}

export interface DeployPackage {
  manifest: DeployManifest;
  /** Entry module, package-relative. */
  entry: string;
  files: PackageFile[];
  /** Decompressed archive size, for logging. */
  unpackedBytes: number;
}

/**
 * Read and validate a deploy package: the gzipped tarball produced by
 * `npm pack` (or `pnpm pack`).
 *
 * Everything is checked here, before the controller commits anything, so a bad
 * package is a 400 with an actionable message instead of a failed run. The same
 * function is used by the CLI, so a local check and the server agree.
 */
export function readDeployPackage(data: Uint8Array): DeployPackage {
  if (data.byteLength === 0) {
    throw new InvalidPackageError("package is empty");
  }
  if (data.byteLength > MAX_PACKAGE_BYTES) {
    throw new InvalidPackageError(
      `package is ${String(data.byteLength)} bytes; the limit is ${String(MAX_PACKAGE_BYTES)}`,
    );
  }

  const unpacked = gunzip(data);
  const entries = parseTar(unpacked);

  const files: PackageFile[] = [];
  const directories: ArchiveEntry[] = [];

  for (const entry of entries) {
    const relative = stripPrefix(entry.path);
    if (relative === null) continue;

    if (entry.type === "directory") {
      directories.push({ ...entry, path: relative });
    } else {
      files.push({ path: relative, mode: entry.mode, data: entry.data });
    }
  }

  const manifest = readManifest(files);
  validateManifest(manifest, files);

  return {
    manifest,
    entry: resolveEntry(manifest, files),
    files,
    unpackedBytes: unpacked.byteLength,
  };
}

/** Write the package below `destination`, with modes the run container can read. */
export async function extractDeployPackage(pkg: DeployPackage, destination: string): Promise<void> {
  await extractEntries(
    pkg.files.map((file) => ({ type: "file" as const, ...file })),
    destination,
  );
}

/** One line for logs and CLI output. */
export function describePackage(pkg: DeployPackage): string {
  const name = `${pkg.manifest.name}@${pkg.manifest.version}`;
  const bytes = pkg.files.reduce((total, file) => total + file.data.byteLength, 0);
  return `${name} (${String(pkg.files.length)} files, ${String(bytes)} bytes)`;
}

function gunzip(data: Uint8Array): Uint8Array {
  if (data[0] !== GZIP_MAGIC[0] || data[1] !== GZIP_MAGIC[1]) {
    throw new InvalidPackageError("package is not gzipped; ship the .tgz produced by `npm pack`");
  }

  try {
    return gunzipSync(data, { maxOutputLength: MAX_UNPACKED_BYTES });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ERR_BUFFER_TOO_LARGE") {
      throw new InvalidPackageError(`package expands past ${String(MAX_UNPACKED_BYTES)} bytes`);
    }
    throw new InvalidPackageError(
      `package could not be decompressed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * npm tarballs store everything under `package/`. Entries outside it are not
 * part of a package and are ignored (some packers add `pax_global_header`).
 */
function stripPrefix(path: string): string | null {
  if (path === "package") return "";
  if (!path.startsWith(PREFIX)) return null;

  const relative = path.slice(PREFIX.length);
  return relative === "" ? "" : relative;
}

function readManifest(files: PackageFile[]): DeployManifest {
  const file = files.find((candidate) => candidate.path === "package.json");
  if (!file) {
    throw new InvalidPackageError("package.json is missing; is this an npm tarball?");
  }

  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(file.data).toString("utf8"));
  } catch {
    throw new InvalidPackageError("package.json is not valid JSON");
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidPackageError("package.json must contain an object");
  }

  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.trim() === "") {
    throw new InvalidPackageError('package.json must have a "name"');
  }
  if (typeof record.version !== "string" || record.version.trim() === "") {
    throw new InvalidPackageError('package.json must have a "version"');
  }

  return record as DeployManifest;
}

function validateManifest(manifest: DeployManifest, files: PackageFile[]): void {
  if (manifest.type !== "module") {
    throw new InvalidPackageError(
      'package.json must set "type": "module"; the deploy entry is an ES module',
    );
  }

  const api = manifest.deployer?.api;
  if (api !== DEPLOY_API_VERSION) {
    throw new InvalidPackageError(
      `package targets deployer API ${api === undefined ? "(none)" : JSON.stringify(api)}; this controller expects ${String(DEPLOY_API_VERSION)}`,
    );
  }

  const dependencies = Object.keys(manifest.dependencies ?? {});
  const shipsNodeModules = files.some((file) => file.path.startsWith("node_modules/"));

  if (dependencies.length > 0 && !shipsNodeModules) {
    throw new InvalidPackageError(
      `package depends on ${dependencies.join(", ")} but does not ship node_modules; ` +
        "bundle the dependencies, or list them in `bundledDependencies` and pack node_modules",
    );
  }

  if (!shipsNodeModules) {
    const bare = findBareSpecifier(files);
    if (bare !== null) {
      throw new InvalidPackageError(
        `${bare.file} imports "${bare.specifier}"; the runner cannot install packages. ` +
          "Bundle it, import it as `import type`, or ship node_modules via `bundledDependencies`",
      );
    }
  }
}

/**
 * The entry module declared by a manifest, package-relative.
 *
 * Shared with the runner harness so the validation and the import always agree
 * on which file runs.
 */
export function packageEntry(manifest: DeployManifest): string {
  const candidate = entryFromExports(manifest.exports) ?? manifest.main;
  if (candidate === undefined) {
    throw new InvalidPackageError(
      'package.json needs an entry: "exports": "." or "main" (usually "dist/deploy.js")',
    );
  }

  return normalizeEntry(candidate);
}

function resolveEntry(manifest: DeployManifest, files: PackageFile[]): string {
  const entry = packageEntry(manifest);
  if (!files.some((file) => file.path === entry)) {
    throw new InvalidPackageError(`entry ${JSON.stringify(entry)} is not part of the package`);
  }

  return entry;
}

function entryFromExports(exports: unknown): string | undefined {
  if (typeof exports === "string") return exports;
  if (typeof exports !== "object" || exports === null) return undefined;

  const root = (exports as Record<string, unknown>)["."] ?? exports;
  if (typeof root === "string") return root;
  if (typeof root !== "object" || root === null) return undefined;

  const record = root as Record<string, unknown>;
  for (const condition of ["import", "module", "default"]) {
    const value = record[condition];
    if (typeof value === "string") return value;
  }

  return undefined;
}

function normalizeEntry(raw: string): string {
  const value = raw.startsWith("./") ? raw.slice(2) : raw;
  if (value === "" || value.startsWith("/") || value.split("/").includes("..")) {
    throw new InvalidPackageError(`entry ${JSON.stringify(raw)} escapes the package`);
  }

  return value;
}

const SCRIPT_EXTENSIONS = [".js", ".mjs", ".cjs"];

const STATIC_SPECIFIER = /\b(?:import|export)\s+(?:[^;"'`]*?\s+from\s+)?["']([^"'\n]+)["']/g;
const DYNAMIC_SPECIFIER = /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g;
const REQUIRE_SPECIFIER = /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g;

/**
 * Find a module specifier the runner cannot resolve.
 *
 * A bundle has none; a `tsc` build has none as long as packages are imported
 * with `import type`. This is a guardrail, not a full parser: it errs towards
 * reporting, because the fix (bundle, or import types) is always the same.
 */
export function findBareSpecifier(
  files: { path: string; data: Uint8Array }[],
): { file: string; specifier: string } | null {
  for (const file of files) {
    if (!SCRIPT_EXTENSIONS.some((extension) => file.path.endsWith(extension))) continue;

    const source = stripComments(Buffer.from(file.data).toString("utf8"));
    for (const specifier of collectSpecifiers(source)) {
      if (isResolvableByNode(specifier)) continue;
      return { file: file.path, specifier };
    }
  }

  return null;
}

/**
 * Blank out comments before scanning.
 *
 * JSDoc types (`@param {import("@dldc/deployer-sdk").DeployContext}`) and
 * commented-out imports are common in hand-written deploy entries; without this
 * they would be reported as unresolved runtime imports. Strings are kept, so
 * `from "./x.js"` survives; the scanner is not a parser, and a regex literal
 * containing `//` can hide the rest of its line, which only ever affects this
 * guardrail.
 */
function stripComments(source: string): string {
  let out = "";
  let quote: string | null = null;
  let index = 0;

  while (index < source.length) {
    const char = source[index] ?? "";
    const next = source[index + 1];

    if (quote !== null) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      out += char;
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      out += " ";
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

function collectSpecifiers(source: string): string[] {
  const specifiers: string[] = [];

  for (const pattern of [STATIC_SPECIFIER, DYNAMIC_SPECIFIER, REQUIRE_SPECIFIER]) {
    // `matchAll` needs a fresh lastIndex for global expressions.
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.push(specifier);
    }
  }

  return specifiers;
}

function isResolvableByNode(specifier: string): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) {
    return true;
  }
  if (specifier.startsWith("node:")) return true;
  if (isBuiltin(specifier)) return true;
  // URL imports: data: is self-contained; anything else needs a network the
  // run container does not have.
  return specifier.startsWith("data:");
}
