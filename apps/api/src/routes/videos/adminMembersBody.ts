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

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
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
