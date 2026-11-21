import { isBuiltin } from "node:module";
import ts from "typescript";

export interface RootPackageManifest {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
  homepage?: string;
  bugs?: unknown;
  license?: string;
  author?: unknown;
  repository?: unknown;
  type?: string;
  sideEffects?: boolean;
  engines?: unknown;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Extract module specifiers from emitted JavaScript or declaration files.
 *
 * The input is deliberately the build output, not the source: bundling and
 * tree-shaking change which packages are actually required at runtime.
 */
export function collectModuleSpecifiers(fileName: string, source: string): string[] {
  const kind =
    fileName.endsWith(".d.ts") || fileName.endsWith(".d.mts") || fileName.endsWith(".d.cts")
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS;

  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);

  const specifiers: string[] = [];

  const add = (node: ts.Node | undefined): void => {
    if (node && ts.isStringLiteralLike(node)) {
      specifiers.push(node.text);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node.arguments[0]);
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      add(node.arguments[0]);
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument)) {
        add(argument.literal);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

/**
 * Turn a module specifier into the npm package that owns it.
 * Relative paths, local imports, built-ins, and URL-like imports return null.
 */
export function toPackageName(specifier: string): string | null {
  const value = specifier.trim();
  if (value === "") return null;
  if (value.startsWith(".") || value.startsWith("/") || value.startsWith("#")) {
    return null;
  }
  if (value.startsWith("node:") || isBuiltin(value)) return null;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) return null;

  const parts = value.split("/");
  if (value.startsWith("@")) {
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  }

  return parts[0] || null;
}

/**
 * Build the package.json that ships inside the npm tarball. Only packages
 * actually imported by the emitted SDK are copied from the root manifest.
 */
export function createSdkManifest(
  root: RootPackageManifest,
  packageNames: Iterable<string>,
): Record<string, unknown> {
  const dependencies: Record<string, string> = {};
  const peerDependencies: Record<string, string> = {};
  const optionalDependencies: Record<string, string> = {};

  for (const name of [...packageNames].sort()) {
    const dependency = root.dependencies?.[name];
    const peerDependency = root.peerDependencies?.[name];
    const optionalDependency = root.optionalDependencies?.[name];

    if (dependency !== undefined) {
      dependencies[name] = dependency;
    } else if (peerDependency !== undefined) {
      peerDependencies[name] = peerDependency;
    } else if (optionalDependency !== undefined) {
      optionalDependencies[name] = optionalDependency;
    } else {
      throw new Error(
        `SDK output imports "${name}", but it is not declared in the root package.json`,
      );
    }
  }

  const manifest: Record<string, unknown> = {
    name: root.name,
    version: root.version,
    description: root.description,
    keywords: root.keywords,
    homepage: root.homepage,
    bugs: root.bugs,
    license: root.license,
    author: root.author,
    repository: root.repository,
    type: root.type,
    sideEffects: root.sideEffects,
    types: "./dist/index.d.mts",
    engines: root.engines,
    exports: {
      ".": {
        types: "./dist/index.d.mts",
        default: "./dist/index.mjs",
      },
    },
    files: ["dist"],
    publishConfig: {
      access: "public",
      registry: "https://registry.npmjs.org",
    },
  };

  if (Object.keys(dependencies).length > 0) {
    manifest.dependencies = dependencies;
  }
  if (Object.keys(peerDependencies).length > 0) {
    manifest.peerDependencies = peerDependencies;
  }
  if (Object.keys(optionalDependencies).length > 0) {
    manifest.optionalDependencies = optionalDependencies;
  }

  return manifest;
}
