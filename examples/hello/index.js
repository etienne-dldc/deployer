// Deploy code for the `hello` service.
//
// Reconciliation lives here, not in the controller: inspect the live service,
// create it, update it when the desired config differs, and do nothing when it
// already matches. `ctx` is everything the package gets at runtime — the SDK is
// types-only, so this file needs no dependencies.
//
// @param {import("@dldc/deployer-sdk").DeployContext} ctx
export default async function deploy({ service, wait, log, equal, run }) {
  const name = "hello";

  const desired = {
    image: "traefik/whoami:v1.10",
    replicas: 1,
    env: [
      { name: "WHOAMI_NAME", value: "hello" },
      { name: "GREETING", value: "from the deploy package" },
    ],
    ports: [{ target: 80, published: 8081 }],
  };

  const live = await service.inspect(name);

  if (live === null) {
    await service.create(name, desired);
    log.info(`created ${name}`);
  } else if (!equal(live.config, desired)) {
    await service.update(name, desired, { version: live.version });
    log.info(`updated ${name}`);
  } else {
    log.info(`${name} is up to date`);
  }

  await wait.serviceConverged(name, { timeoutMs: 90_000 });
  log.info(`${name} is running`);
  log.info(`applied by run ${run.id} (${run.commit})`);
}
