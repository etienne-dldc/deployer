import Docker from "dockerode";

/**
 * The controller is the only process that talks to Docker. Deploy code reaches
 * it through the internal socket; it never gets a Docker socket of its own.
 */
export function createDockerClient(socketPath: string): Docker {
  return new Docker({ socketPath });
}
