/**
 * Stand-in for `ssh2`, which `docker-modem` imports eagerly even when the
 * controller only talks to a local Unix socket.
 *
 * Bundling the real package pulls in `cpu-features` and a native binding that
 * has no place in the controller image. Connecting to a Docker host over SSH is
 * not a deployment mode the controller supports, so the stub fails loudly if
 * one is ever requested.
 */
export class Client {
  constructor() {
    throw new Error(
      "ssh:// Docker hosts are not supported: the controller connects to a local Docker socket only",
    );
  }
}
