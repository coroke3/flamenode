import type { PreloadedAuditContext } from "../../audit/mutateWithAudit.ts";

/**
 * ZERO_1102 section 4-3: request JSON is parsed only up to 64KB. The limit is
 * enforced on Content-Length and on the bytes actually read (a missing or lying
 * Content-Length cannot bypass it).
 */
export const MAX_ADMIN_JSON_BODY_BYTES = 65536;

/**
 * Audit reads the guards already did (settings: CostGuard's system_settings
 * row; actor snapshot: writeGuard's user row). Skips those D1 reads in
 * mutateWithAudit so a route stays within 3 pre-reads + 1 batch.
 */
export function auditPreloaded(c: {
  get(key: "auditSettings"): PreloadedAuditContext["settings"];
  get(key: "actorSnapshotJsonById"): PreloadedAuditContext["actorSnapshotJsonById"];
}): PreloadedAuditContext {
  return {
    settings: c.get("auditSettings"),
    actorSnapshotJsonById: c.get("actorSnapshotJsonById"),
  };
}

export const BODY_TOO_LARGE_MESSAGE = "リクエストが大きすぎます。";

export type AdminJsonBody =
  | { kind: "ok"; value: Record<string, unknown> }
  | { kind: "invalid" }
  | { kind: "too_large" };

export async function readAdminJsonBody(request: Request): Promise<AdminJsonBody> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > MAX_ADMIN_JSON_BODY_BYTES) {
      return { kind: "too_large" };
    }
  }
  if (!request.body) return { kind: "invalid" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ADMIN_JSON_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { kind: "too_large" };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { kind: "ok", value: parsed as Record<string, unknown> }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}
