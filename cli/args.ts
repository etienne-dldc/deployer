/** Options parsed from the command line and environment. */
export interface DeployOptions {
  file: string;
  message?: string;
  host: string;
  user: string;
  identity?: string;
  port?: number;
  dryRun: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** `-h`/`--help`: print the usage and exit successfully. */
export class HelpRequested extends Error {
  constructor() {
    super(USAGE);
    this.name = "HelpRequested";
  }
}

export const USAGE = `usage: deployer deploy <package.tgz> [options]

The argument is the .tgz produced by \`npm pack\` (or \`pnpm pack\`) after the
package is built. Building and packing belong to the deploy repository.

options:
  --message <text>    message recorded in the deploy history
  --host <host>       host running the controller (or DEPLOY_HOST)
  --user <user>       ssh user (default: deployer, or DEPLOY_USER)
  --identity <path>   ssh private key (default: DEPLOY_KEY, else ssh config)
  --port <port>       ssh port (default: 22)
  --dry-run           validate the package and print the command, do not send
  -h, --help          show this message`;

/**
 * Parse `deploy <file> [options]`.
 *
 * `--host` also accepts `user@host`, which saves repeating `--user` in CI.
 */
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): DeployOptions {
  const [command, file, ...rest] = argv;

  if (command === "-h" || command === "--help") {
    throw new HelpRequested();
  }
  if (command === undefined) {
    throw new UsageError(USAGE);
  }
  if (command !== "deploy") {
    throw new UsageError(`unknown command: ${command}\n\n${USAGE}`);
  }
  if (file === undefined) {
    throw new UsageError(`missing <package.tgz>\n\n${USAGE}`);
  }

  let message: string | undefined;
  let host = env.DEPLOY_HOST;
  let user = env.DEPLOY_USER;
  let identity = env.DEPLOY_KEY;
  let port = parsePort(env.DEPLOY_PORT);
  let dryRun = false;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] ?? "";

    switch (arg) {
      case "--message":
        message = nextValue(rest, ++index, "--message");
        break;
      case "--host":
        host = nextValue(rest, ++index, "--host");
        break;
      case "--user":
        user = nextValue(rest, ++index, "--user");
        break;
      case "--identity":
        identity = nextValue(rest, ++index, "--identity");
        break;
      case "--port":
        port = parsePort(nextValue(rest, ++index, "--port"));
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "-h":
      case "--help":
        throw new HelpRequested();
      default:
        throw new UsageError(`unknown option: ${arg}\n\n${USAGE}`);
    }
  }

  const target = splitUser(host);
  const resolvedUser = user ?? target.user ?? "deployer";
  if (target.host === undefined || target.host === "") {
    throw new UsageError("missing host: pass --host or set DEPLOY_HOST");
  }

  return {
    file,
    ...(message === undefined ? {} : { message }),
    host: target.host,
    user: resolvedUser,
    ...(identity === undefined || identity === "" ? {} : { identity }),
    ...(port === undefined ? {} : { port }),
    dryRun,
  };
}

/**
 * The deploy message travels inside the SSH command, which the server only
 * accepts as `deploy <message>` with a conservative character set.
 */
export function sanitizeMessage(raw: string): string {
  const cleaned = raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^A-Za-z0-9 @._:/()#-]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);

  return cleaned === "" ? "manual deploy" : cleaned;
}

function nextValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError(`${flag} needs a value`);
  }

  return value;
}

function splitUser(host: string | undefined): { host?: string; user?: string } {
  if (host === undefined) return {};
  const at = host.lastIndexOf("@");
  if (at === -1) return { host };

  return { host: host.slice(at + 1), user: host.slice(0, at) };
}

function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new UsageError(`invalid ssh port: ${raw}`);
  }

  return port;
}
