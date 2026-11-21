import { timingSafeEqual } from "node:crypto";

export function isAuthorized(authorization: string | undefined, expectedToken: string): boolean {
  if (!authorization) return false;

  const [scheme, value] = authorization.split(" ");
  if (scheme !== "Bearer" || !value) return false;

  const actual = Buffer.from(value);
  const expected = Buffer.from(expectedToken);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
