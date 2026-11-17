/**
 * MIG-0650 U03k: SA-085-only JSON body ceiling for the UNMOUNTED Hono
 * candidate. The shared admin JSON reader remains capped at 64KiB.
 *
 * The measured valid CURRENT 100 members × 30 chapters fixture is ~155KiB.
 * 256KiB is only a bounded intermediate compatibility policy, NOT proof that
 * all legal max-length labels/notes fit a Worker budget. Review before mount.
 */
import type { AdminJsonBody } from "../admin/body.ts";

export const MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_BYTES = 256 * 1024;

export async function readAdminVideoMembersJsonBody(request: Request): Promise<AdminJsonBody> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_BYTES) {
      return { kind: "too_large" };
    }
  }
  if (!request.body) return { kind: "invalid" };

  // If a middleware already owns or disturbed the request body, getReader()
  // may throw synchronously. Fail closed as invalid input rather than leaking
  // an unhandled TypeError/HTTP 500 from this privileged preflight.
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    return { kind: "invalid" };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { kind: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    // An interrupted streaming upload has not supplied a complete JSON body.
    // Do not allow it to reach a privileged write, even on a retryable network error.
    await reader.cancel().catch(() => undefined);
    return { kind: "invalid" };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    // JSON over HTTP is UTF-8. Default TextDecoder silently replaces invalid
    // bytes, which can change X IDs/names before validating or saving them.
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { kind: "ok", value: parsed as Record<string, unknown> }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}
