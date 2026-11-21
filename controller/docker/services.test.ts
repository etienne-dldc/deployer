import type Docker from "dockerode";
import { describe, expect, it } from "vitest";
import type { ServiceConfig } from "../../sdk/graph.ts";
import { createServiceManager, ServiceVersionConflictError } from "./services.ts";

const config: ServiceConfig = { image: "nginx", replicas: 1 };

function dockerError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode, json: { message } });
}

interface FakeOptions {
  inspect?: () => unknown;
  update?: () => unknown;
  remove?: () => unknown;
  create?: () => unknown;
  tasks?: unknown[];
}

function fakeDocker(options: FakeOptions = {}): Docker {
  const docker = {
    getService: () => ({
      inspect: async () => {
        if (options.inspect) return await options.inspect();
        return { Spec: {}, Version: { Index: 3 } };
      },
      update: async () => (options.update ? await options.update() : {}),
      remove: async () => (options.remove ? await options.remove() : {}),
    }),
    createService: async () => (options.create ? await options.create() : {}),
    listServices: async () => [],
    listTasks: async () => options.tasks ?? [],
  };

  return docker as unknown as Docker;
}

describe("createServiceManager", () => {
  it("returns null when the service is missing", async () => {
    const manager = createServiceManager(
      fakeDocker({
        inspect: () => {
          throw dockerError(404, "service web not found");
        },
      }),
    );

    await expect(manager.inspect("web")).resolves.toBeNull();
  });

  it("returns the live config and version", async () => {
    const manager = createServiceManager(
      fakeDocker({
        inspect: () => ({
          Spec: {
            TaskTemplate: { ContainerSpec: { Image: "nginx" } },
            Mode: { Replicated: { Replicas: 2 } },
          },
          Version: { Index: 12 },
        }),
      }),
    );

    await expect(manager.inspect("web")).resolves.toEqual({
      config: { image: "nginx", replicas: 2 },
      version: 12,
    });
  });

  it("re-inspects after create to return the new version", async () => {
    const manager = createServiceManager(
      fakeDocker({
        inspect: () => ({
          Spec: {
            TaskTemplate: { ContainerSpec: { Image: "nginx" } },
            Mode: { Replicated: { Replicas: 1 } },
          },
          Version: { Index: 4 },
        }),
      }),
    );

    await expect(manager.create("web", config)).resolves.toEqual({ version: 4 });
  });

  it("maps Docker's out-of-sequence error to a version conflict", async () => {
    const manager = createServiceManager(
      fakeDocker({
        update: () => {
          throw dockerError(500, "rpc error: update out of sequence");
        },
      }),
    );

    await expect(manager.update("web", config, 2)).rejects.toBeInstanceOf(
      ServiceVersionConflictError,
    );
  });

  it("treats removing a missing service as success", async () => {
    const manager = createServiceManager(
      fakeDocker({
        remove: () => {
          throw dockerError(404, "service web not found");
        },
        inspect: () => {
          throw dockerError(404, "service web not found");
        },
      }),
    );

    await expect(manager.remove("web")).resolves.toBeNull();
  });

  it("resolves convergence once every task is running", async () => {
    const manager = createServiceManager(
      fakeDocker({
        inspect: () => ({
          Spec: {
            TaskTemplate: { ContainerSpec: { Image: "nginx" } },
            Mode: { Replicated: { Replicas: 2 } },
          },
          Version: { Index: 1 },
        }),
        tasks: [{ Status: { State: "running" } }, { Status: { State: "running" } }],
      }),
    );

    await expect(manager.serviceConverged("web", 0)).resolves.toBeNull();
  });

  it("reports the surviving tasks when convergence times out", async () => {
    const manager = createServiceManager(
      fakeDocker({
        inspect: () => ({
          Spec: {
            TaskTemplate: { ContainerSpec: { Image: "nginx" } },
            Mode: { Replicated: { Replicas: 2 } },
          },
          Version: { Index: 1 },
        }),
        tasks: [{ Status: { State: "running" } }, { Status: { State: "pending" } }],
      }),
    );

    await expect(manager.serviceConverged("web", 0)).rejects.toThrow(
      /did not converge.*running 1\/2/,
    );
  });
});
