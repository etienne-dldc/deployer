# Slice 12 — Service config

Add resolvers for service environment variable management.

> **Port sources (`tower-control/controller/src/`):**
>
> - `logic/envconfig/` — the whole module: `configBackend.ts`, `envFormat.ts`,
>   `extractSpecs.ts`, `generateValue.ts`, `resolveEnvPath.ts`,
>   `resolveServiceEnvConfig.ts`, `validateEnvSpecs.ts`, `validateValue.ts`,
>   `types.ts` (+ their `*.test.ts`)

## What's in

- `config.getServiceConfig(serviceName)` — resolve env config (specs + values),
  returns `ServiceEnvConfig | null`
- `config.updateVariable(serviceName, variable, value)` — update a variable in
  the env file, update the hash
- `config.generateValue(serviceName, variable)` — regenerate a value (e.g.
  random secret), returns the new value

## Working state at end

- Full service env config management available via graph API
