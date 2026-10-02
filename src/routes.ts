import { inject, type RouteParams } from "regexparam";

export interface LinkOptions {
  queryparams?:
    | Record<string, string | number | boolean>
    | URLSearchParams
    | undefined;
}

export interface Route<T extends string> {
  path: string;
  link(params: RouteParams<T>, options?: LinkOptions): string;
}

function createRoute<T extends string>(path: T): Route<T> {
  return {
    path,
    link(params, options = {}) {
      const { queryparams } = options;
      return inject(path, params) +
        (queryparams ? `?${toURLSearchParams(queryparams).toString()}` : "");
    },
  };
}

function toURLSearchParams(
  queryparams: Record<string, string | number | boolean> | URLSearchParams,
): URLSearchParams {
  if (queryparams instanceof URLSearchParams) {
    return queryparams;
  }
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(queryparams)) {
    searchParams.append(key, String(value));
  }
  return searchParams;
}

export const ROUTES = {
  status: createRoute("/status"),
  apiGraph: createRoute("/api/graph"),
  apiEvents: createRoute("/api/events"),
  apiTarDeploy: createRoute("/api/tar-deploy"),
};
