import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  InvalidPackageError,
  describePackage,
  readDeployPackage,
  type DeployPackage,
} from "../artifact/index.ts";
import { UsageError, parseArgs, sanitizeMessage, type DeployOptions } from "./args.ts";
import { sshArgs } from "./ssh.ts";

/**
 * The deploy client.
 *
 * It does one thing: validate an already-built package and stream it to the
 * controller over SSH. Building, bundling and packing belong to the deploy
 * repository; this process never installs anything.
 */
async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  let options: DeployOptions;
  try {
    options = parseArgs(argv, env);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  let data: Uint8Array;
  try {
    data = await readFile(options.file);
  } catch (error) {
    console.error(`cannot read ${options.file}: ${errorMessage(error)}`);
    return 1;
  }

  let pkg: DeployPackage;
  try {
    pkg = readDeployPackage(data);
  } catch (error) {
    if (error instanceof InvalidPackageError) {
      console.error(`invalid package: ${error.message}`);
      return 1;
    }
    throw error;
  }

  const message = sanitizeMessage(
    options.message ?? `${pkg.manifest.name}@${pkg.manifest.version}`,
  );
  const ssh = sshArgs({
    host: options.host,
    user: options.user,
    ...(options.identity === undefined ? {} : { identity: options.identity }),
    ...(options.port === undefined ? {} : { port: options.port }),
    message,
    batch: !process.stdin.isTTY,
  });

  console.error(`package ${describePackage(pkg)}`);
  console.error(`target ${options.user}@${options.host} (${message})`);

  if (options.dryRun) {
    console.error(`ssh ${ssh.join(" ")} < ${options.file}`);
    return 0;
  }

  return ship(ssh, data);
}

function ship(args: string[], data: Uint8Array): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("ssh", args, { stdio: ["pipe", "inherit", "inherit"] });

    child.on("error", (error) => {
      console.error(`cannot run ssh: ${error.message}`);
      resolve(1);
    });

    child.on("close", (code) => {
      if (code === 255) {
        console.error(
          "ssh connection failed (host unreachable, or the key is not accepted by the server)",
        );
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });

    child.stdin.on("error", () => {
      // ssh exiting early is reported by the close handler.
    });
    child.stdin.end(data);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

process.exitCode = await main(process.argv.slice(2), process.env);
