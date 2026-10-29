import { isSafeRelativePath } from "../../../../src/lib/utils/next.ts";

/**
 * Client-side last line of defence for server-selected navigation.
 * Never follow an absolute URL or a protocol-relative URL returned by an API.
 */
export function guardRedirect(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  return isSafeRelativePath(path) ? path : null;
}
