/**
 * Pre-generated R2 HTML fallback loader (MIG-0406 / Recipe R-BUILD & R-GATEWAY / Runtime N & S1).
 * Serves pre-built HTML from R2 storage when static assets quota is exceeded (D-06).
 * Guarantee: Strictly fails closed for revoked, missing, corrupt, or stale generation items.
 */

export type R2ObjectRecord = {
  body: ReadableStream | string;
  size?: number;
  customMetadata?: Record<string, string>;
  httpMetadata?: {
    contentType?: string;
  };
};

export type R2StorageClient = {
  get: (key: string) => Promise<R2ObjectRecord | null>;
};

export type R2FallbackOptions = {
  r2: R2StorageClient;
  expectedGeneration: string;
  isRevoked: (key: string) => boolean | Promise<boolean>;
};

export type R2FallbackResult =
  | Readonly<{
      action: "serve";
      status: 200;
      body: ReadableStream | string;
      contentType: string;
      headers: Readonly<Record<string, string>>;
    }>
  | Readonly<{
      action: "deny";
      status: 404;
      reason: "revoked" | "not_found";
      headers: Readonly<Record<string, string>>;
    }>
  | Readonly<{
      action: "unavailable";
      status: 503;
      reason: "r2_read_failed" | "stale_generation" | "corrupt_data" | "missing_safety_guard";
      headers: Readonly<Record<string, string>>;
    }>;

const DENY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Type": "text/plain; charset=utf-8",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store, private",
});

const UNAVAILABLE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store, private",
});

/**
 * Loads pre-generated HTML from R2 with strict visibility and generation gates.
 */
export async function loadR2PrebuiltHtml(
  key: string,
  options: R2FallbackOptions,
): Promise<R2FallbackResult> {
  const normalizedKey = key.replace(/^\//, "");
  // Runtime validation too: JavaScript callers must not be able to omit fences.
  if (!options || typeof options.isRevoked !== "function" ||
      typeof options.expectedGeneration !== "string" ||
      !options.expectedGeneration.trim()) {
    return { action: "unavailable", status: 503,
      reason: "missing_safety_guard", headers: UNAVAILABLE_HEADERS };
  }
  if (!normalizedKey || normalizedKey.includes("..") || normalizedKey.includes("\\") ||
      normalizedKey.startsWith("/") || /%2f|%2e|%5c/i.test(normalizedKey)) {
    return { action: "unavailable", status: 503,
      reason: "corrupt_data", headers: UNAVAILABLE_HEADERS };
  }

  // 1. T04: Post-build revocation check (fail-closed 404)
  try {
    if (await options.isRevoked(normalizedKey)) {
      return { action: "deny", status: 404, reason: "revoked", headers: DENY_HEADERS };
    }
  } catch {
    return { action: "unavailable", status: 503,
      reason: "r2_read_failed", headers: UNAVAILABLE_HEADERS };
  }

  // 2. Fetch object from R2
  let objectRecord: R2ObjectRecord | null = null;
  try {
    objectRecord = await options.r2.get(normalizedKey);
  } catch {
    // T03: Storage failure fails closed with 503
    return {
      action: "unavailable",
      status: 503,
      reason: "r2_read_failed",
      headers: UNAVAILABLE_HEADERS,
    };
  }

  if (!objectRecord) {
    return {
      action: "deny",
      status: 404,
      reason: "not_found",
      headers: DENY_HEADERS,
    };
  }

  // 3. T02: Verify generation metadata if required
  if (objectRecord.customMetadata?.generation !== options.expectedGeneration) {
    return { action: "unavailable", status: 503,
      reason: "stale_generation", headers: UNAVAILABLE_HEADERS };
  }

  // 4. Return pre-generated HTML with content-type
  const contentType = objectRecord.httpMetadata?.contentType;
  if (typeof contentType !== "string" || !/^text\/html(?:\s*;|$)/i.test(contentType) ||
      !objectRecord.body ||
      (typeof objectRecord.body === "string" && !objectRecord.body.trim()) ||
      (typeof objectRecord.body !== "string" &&
        (!Number.isFinite(objectRecord.size) || (objectRecord.size ?? 0) <= 0))) {
    return { action: "unavailable", status: 503,
      reason: "corrupt_data", headers: UNAVAILABLE_HEADERS };
  }

  return {
    action: "serve",
    status: 200,
    body: objectRecord.body,
    contentType,
    headers: Object.freeze({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=0, must-revalidate",
    }),
  };
}
