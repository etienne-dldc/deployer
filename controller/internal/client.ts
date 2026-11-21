import { query, queryToObject, type TQuery } from "@dldc/ts-api/client";
import type { Graph } from "../../sdk/graph.ts";
import { call, type CallOptions } from "./transport.ts";

/**
 * The typed ts-api query builder for the deployer Graph.
 *
 * Tests and the controller use it to drive the internal socket directly. Deploy
 * code does not: it receives a `DeployContext` from the harness.
 */
export const q = query<{ Graph: Graph }>();

export type ExecuteQueryOptions = CallOptions;

/** Execute a ts-api query against the controller's internal Unix socket. */
export async function executeQuery<T>(
  builtQuery: TQuery<T>,
  options: ExecuteQueryOptions = {},
): Promise<T> {
  const { path, args } = queryToObject(builtQuery);
  return call<T>(path, args, options);
}
