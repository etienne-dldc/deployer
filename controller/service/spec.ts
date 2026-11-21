import type { ContainerSpec, PortConfig, ServiceSpec } from "dockerode";
import type { EnvVar, Label, ServiceConfig, ServicePort } from "../../sdk/graph.ts";

/**
 * Labels under this prefix are deployer metadata. They are written by the
 * controller (secret references, logical config names, ...) and stripped from
 * `fromSwarm`, so deploy code never sees or sets them.
 */
export const RESERVED_LABEL_PREFIX = "com.deployer.";

/**
 * Convert the deployer's canonical config into a Swarm service spec.
 *
 * Every managed field is written from the config: `update` is a full
 * replacement of the managed subset, not a merge. Optional fields that are
 * absent stay absent so an inspect and the desired config compare cleanly.
 */
export function toSwarm(config: ServiceConfig): ServiceSpec {
  const env = toMap(config.env, "env var");
  const labels = toMap(config.labels, "label");

  for (const name of Object.keys(labels)) {
    if (name.startsWith(RESERVED_LABEL_PREFIX)) {
      throw new Error(
        `labels starting with "${RESERVED_LABEL_PREFIX}" are reserved for the deployer (got "${name}")`,
      );
    }
  }

  const containerSpec: ContainerSpec = { Image: config.image };

  if (config.command !== undefined && config.command.length > 0) {
    containerSpec.Command = [...config.command];
  }
  if (Object.keys(env).length > 0) {
    containerSpec.Env = Object.keys(env)
      .sort()
      .map((name) => `${name}=${env[name]}`);
  }

  const spec: ServiceSpec = {
    TaskTemplate: { ContainerSpec: containerSpec },
    Mode: { Replicated: { Replicas: config.replicas } },
  };

  if (Object.keys(labels).length > 0) {
    spec.Labels = labels;
  }
  if (config.ports !== undefined && config.ports.length > 0) {
    spec.EndpointSpec = {
      Ports: config.ports
        .map(toPortConfig)
        .sort((a, b) => (a.TargetPort ?? 0) - (b.TargetPort ?? 0)),
    };
  }

  return spec;
}

/**
 * Convert a live Swarm spec back into the deployer's canonical config.
 *
 * Docker defaults, empty arrays and ordering are absorbed here so deploy code
 * compares its own type with its own type. Deployer metadata is removed.
 */
export function fromSwarm(spec: ServiceSpec): ServiceConfig {
  const taskSpec = spec.TaskTemplate;
  const containerSpec =
    taskSpec && "ContainerSpec" in taskSpec ? taskSpec.ContainerSpec : undefined;
  if (!containerSpec) {
    throw new Error("service spec has no TaskTemplate.ContainerSpec");
  }

  const config: ServiceConfig = {
    image: containerSpec.Image ?? "",
    replicas: spec.Mode?.Replicated?.Replicas ?? 1,
  };

  const command = containerSpec.Command;
  if (command !== undefined && command.length > 0) {
    config.command = [...command];
  }

  const env = fromMap(containerSpec.Env, "env var");
  if (Object.keys(env).length > 0) {
    config.env = sortedEnv(env);
  }

  const labels = spec.Labels ?? {};
  const userLabels: Label[] = Object.entries(labels)
    .filter(([name]) => !name.startsWith(RESERVED_LABEL_PREFIX))
    .map(([name, value]) => ({ name, value }));
  if (userLabels.length > 0) {
    config.labels = userLabels.sort(byName);
  }

  const ports = spec.EndpointSpec?.Ports;
  if (ports !== undefined && ports.length > 0) {
    config.ports = ports
      .map((port) => ({ target: port.TargetPort ?? 0, published: port.PublishedPort ?? 0 }))
      .sort((a, b) => a.target - b.target || a.published - b.published);
  }

  return config;
}

function toPortConfig(port: ServicePort): PortConfig {
  const config: PortConfig = {
    Protocol: "tcp",
    TargetPort: port.target,
    PublishedPort: port.published,
  };
  return config;
}

function toMap(entries: (EnvVar | Label)[] | undefined, kind: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of entries ?? []) {
    if (entry.name === "") {
      throw new Error(`${kind} name must not be empty`);
    }
    if (Object.hasOwn(map, entry.name)) {
      throw new Error(`duplicate ${kind} name "${entry.name}"`);
    }
    map[entry.name] = entry.value;
  }
  return map;
}

function fromMap(entries: string[] | undefined, kind: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of entries ?? []) {
    const separator = entry.indexOf("=");
    if (separator === -1) {
      throw new Error(`invalid ${kind} entry ${JSON.stringify(entry)}; expected NAME=VALUE`);
    }
    map[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return map;
}

function sortedEnv(map: Record<string, string>): EnvVar[] {
  return Object.entries(map)
    .map(([name, value]) => ({ name, value }))
    .sort(byName);
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
