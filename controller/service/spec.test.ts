import { describe, expect, it } from "vitest";
import type { ServiceConfig } from "../../sdk/graph.ts";
import { fromSwarm, toSwarm } from "./spec.ts";

const config: ServiceConfig = {
  image: "traefik/whoami:v1.10",
  replicas: 2,
  command: ["/bin/sh", "-c", "whoami"],
  env: [
    { name: "EMPTY", value: "" },
    { name: "EQUALS", value: "a=b" },
    { name: "WHOAMI_NAME", value: "hello" },
  ],
  ports: [{ target: 80, published: 8081 }],
  labels: [{ name: "edge.host", value: "hello.example.com" }],
};

describe("toSwarm", () => {
  it("maps the canonical config onto a Swarm spec", () => {
    expect(toSwarm(config)).toEqual({
      TaskTemplate: {
        ContainerSpec: {
          Image: "traefik/whoami:v1.10",
          Command: ["/bin/sh", "-c", "whoami"],
          Env: ["EMPTY=", "EQUALS=a=b", "WHOAMI_NAME=hello"],
        },
      },
      Mode: { Replicated: { Replicas: 2 } },
      Labels: { "edge.host": "hello.example.com" },
      EndpointSpec: { Ports: [{ Protocol: "tcp", TargetPort: 80, PublishedPort: 8081 }] },
    });
  });

  it("omits empty optional fields", () => {
    expect(toSwarm({ image: "nginx", replicas: 1 })).toEqual({
      TaskTemplate: { ContainerSpec: { Image: "nginx" } },
      Mode: { Replicated: { Replicas: 1 } },
    });
  });

  it("sorts env and labels so writes are canonical", () => {
    const spec = toSwarm({
      image: "nginx",
      replicas: 1,
      env: [
        { name: "B", value: "2" },
        { name: "A", value: "1" },
      ],
    });

    const taskSpec = spec.TaskTemplate;
    const containerSpec =
      taskSpec && "ContainerSpec" in taskSpec ? taskSpec.ContainerSpec : undefined;
    expect(containerSpec).toMatchObject({ Env: ["A=1", "B=2"] });
  });

  it("rejects reserved deployer labels", () => {
    expect(() =>
      toSwarm({
        image: "nginx",
        replicas: 1,
        labels: [{ name: "com.deployer.secret.FOO", value: "1" }],
      }),
    ).toThrow("reserved");
  });

  it("rejects duplicate env names", () => {
    expect(() =>
      toSwarm({
        image: "nginx",
        replicas: 1,
        env: [
          { name: "A", value: "1" },
          { name: "A", value: "2" },
        ],
      }),
    ).toThrow("duplicate env var");
  });
});

describe("fromSwarm", () => {
  it("round-trips a canonical config", () => {
    expect(fromSwarm(toSwarm(config))).toEqual(config);
  });

  it("absorbs Docker defaults and ordering", () => {
    const live = {
      TaskTemplate: {
        ContainerSpec: {
          Image: "nginx",
          Env: ["B=2", "A=1"],
          Labels: { "com.docker.stack.image": "nginx" },
        },
      },
      Mode: { Replicated: { Replicas: 1 } },
      Labels: { "com.deployer.internal": "x", zone: "eu" },
      EndpointSpec: {
        Ports: [
          { Protocol: "tcp" as const, TargetPort: 443, PublishedPort: 8443 },
          { Protocol: "tcp" as const, TargetPort: 80, PublishedPort: 8080 },
        ],
      },
    };

    expect(fromSwarm(live)).toEqual({
      image: "nginx",
      replicas: 1,
      env: [
        { name: "A", value: "1" },
        { name: "B", value: "2" },
      ],
      labels: [{ name: "zone", value: "eu" }],
      ports: [
        { target: 80, published: 8080 },
        { target: 443, published: 8443 },
      ],
    });
  });

  it("defaults replicas when Docker omits them", () => {
    expect(
      fromSwarm({
        TaskTemplate: { ContainerSpec: { Image: "nginx", Command: [] } },
      }),
    ).toEqual({ image: "nginx", replicas: 1 });
  });
});
