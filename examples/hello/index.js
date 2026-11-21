// Deploy code for the `hello` service.
//
// Reconciliation lives here, not in the controller: inspect the live service,
// create it, update it when the desired config differs, and do nothing when it
// already matches.
import { equal, executeQuery, q } from "@dldc/deployer-sdk";

const name = "hello";

const desired = {
  image: "traefik/whoami:v1.10",
  replicas: 1,
  env: [
    { name: "WHOAMI_NAME", value: "hello" },
    { name: "GREETING", value: "from the deploy repo" },
  ],
  ports: [{ target: 80, published: 8081 }],
};

const live = await executeQuery(q.Graph.service.inspect(name));

if (live === null) {
  await executeQuery(q.Graph.service.create(name, desired));
  await executeQuery(q.Graph.meta.log("info", `created ${name}`));
} else if (!equal(live.config, desired)) {
  await executeQuery(q.Graph.service.update(name, desired, { version: live.version }));
  await executeQuery(q.Graph.meta.log("info", `updated ${name}`));
} else {
  await executeQuery(q.Graph.meta.log("info", `${name} is up to date`));
}

await executeQuery(q.Graph.wait.serviceConverged(name, { timeoutMs: 90_000 }));
await executeQuery(q.Graph.meta.log("info", `${name} is running`));

const { id, commit } = await executeQuery(q.Graph.meta.run());
await executeQuery(q.Graph.meta.log("info", `applied by run ${id} (${commit})`));
