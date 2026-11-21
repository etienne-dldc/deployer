/**
 * Wire protocol between the controller and deploy-code runs.
 *
 * One newline-delimited JSON request per connection:
 *
 *   -> { "token": "...", "path": ["Graph", "service", "inspect"], "args": ["web"] }
 *   <- { "ok": true, "result": ... }
 *   <- { "ok": false, "error": { "kind": "Unauthorized", "message": "..." } }
 *
 * The envelope keeps success values and transport/validation failures apart, so
 * the SDK can reject instead of returning an error object as a result.
 */
export const PROTOCOL_VERSION = "1";

export interface InternalError {
  kind: string;
  message: string;
}

export type InternalResponse<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: InternalError };

export function isInternalResponse(value: unknown): value is InternalResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.ok === true) return "result" in record;
  if (record.ok !== false) return false;

  const error = record.error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as Record<string, unknown>).kind === "string" &&
    typeof (error as Record<string, unknown>).message === "string"
  );
}
