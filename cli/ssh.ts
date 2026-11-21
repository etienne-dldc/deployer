export interface SshOptions {
  host: string;
  user: string;
  identity?: string;
  port?: number;
  message: string;
  /** Fail instead of prompting, for CI. */
  batch: boolean;
}

/**
 * Build the `ssh` argument list for a deploy.
 *
 * The remote command is always `deploy <message>`: the server's key is
 * restricted to a forced command, and the message charset is enforced by the
 * CLI (`sanitizeMessage`) to match the server's parser.
 */
export function sshArgs(options: SshOptions): string[] {
  const args = ["-T", "-o", "StrictHostKeyChecking=accept-new"];

  if (options.batch) args.push("-o", "BatchMode=yes");
  if (options.port !== undefined) args.push("-p", String(options.port));
  if (options.identity !== undefined) args.push("-i", options.identity, "-o", "IdentitiesOnly=yes");

  args.push(`${options.user}@${options.host}`, `deploy ${options.message}`);

  return args;
}
