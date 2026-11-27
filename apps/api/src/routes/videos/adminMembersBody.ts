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
// A hostile stream can emit empty reads indefinitely without consuming any
// of the byte budget. Limit these separately while allowing normal framing.
export const MAX_ADMIN_VIDEO_MEMBERS_EMPTY_CHUNKS = 1024;
// The byte budget alone permits 262144 distinct 1-byte chunks, each requiring
// a Promise.race/read, copy and retained array entry. Keep total read work
 // bounded independently of the existing zero-byte-only guard.
export const MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_CHUNKS = 4096;

export async function readAdminVideoMembersJsonBody(request: Request): Promise<AdminJsonBody> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_BYTES) {
      return { kind: "too_large" };
    }
  }
  if (request.signal.aborted || request.bodyUsed || !request.body) return { kind: "invalid" };

  // If a middleware already owns or disturbed the request body, getReader()
  // may throw synchronously. Fail closed as invalid input rather than leaking
  // an unhandled TypeError/HTTP 500 from this privileged preflight.
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    return { kind: "invalid" };
  }
  // A cancelled upload can leave read() pending forever when the transport
  // never supplies another chunk. Race the read against the Fetch abort
  // signal without waiting for reader.cancel() (which itself may never settle).
  const aborted = Symbol("video_members_request_aborted");
  let notifyAbort: (() => void) | undefined;
  const abortPromise = new Promise<typeof aborted>((resolve) => {
    notifyAbort = () => resolve(aborted);
    request.signal.addEventListener("abort", notifyAbort, { once: true });
    if (request.signal.aborted) notifyAbort();
  });
  const chunks: Uint8Array[] = [];
  let total = 0;
  let emptyChunks = 0;
  let readChunks = 0;
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), abortPromise]);
      if (next === aborted) {
        void reader.cancel().catch(() => undefined);
        return { kind: "invalid" };
      }
      const { done, value } = next;
      if (done) break;
      // A nonempty byte stream can still deliver one byte per read and evade
      // the 256KiB byte ceiling and the empty-chunk-only CPU guard.
      // Count every delivered chunk; EOF is not a payload read.
      if (++readChunks > MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_CHUNKS) {
        void reader.cancel().catch(() => undefined);
        return { kind: "invalid" };
      }
      // Request bodies are byte streams. A malformed injected stream may yield
      // a string, typed-array element view or arbitrary object; its byteLength
      // would undercount or corrupt the buffered payload. Reject before copy.
      if (!(value instanceof Uint8Array)) {
        void reader.cancel().catch(() => undefined);
        return { kind: "invalid" };
      }
      // Empty chunks consume no bytes but still cost Worker CPU. Admit a
      // bounded amount of harmless framing and reject an infinite stream
      // without allocating or waiting for transport cancellation.
      if (value.byteLength === 0) {
        if (++emptyChunks > MAX_ADMIN_VIDEO_MEMBERS_EMPTY_CHUNKS) {
          void reader.cancel().catch(() => undefined);
          return { kind: "invalid" };
        }
        continue;
      }
      total += value.byteLength;
      if (total > MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_BYTES) {
        // Do not wait for a malicious/broken transport to finish cancelling:
        // a never-settling cancel() must not hang this privileged request.
        void reader.cancel().catch(() => undefined);
        return { kind: "too_large" };
      }
      // Own the buffered bytes before awaiting the next network read.
      // A custom Request stream can enqueue a mutable/reused Uint8Array;
      // retaining its view would let a later chunk alter already-validated
      // participant JSON after it passed the byte limit.
      chunks.push(value.slice());
    }
  } catch {
    // An interrupted streaming upload has not supplied a complete JSON body.
    // Do not allow it to reach a privileged write, even on a retryable network error.
    // A failed upload must also be rejected without waiting on cancel().
    void reader.cancel().catch(() => undefined);
    return { kind: "invalid" };
  } finally {
    if (notifyAbort) request.signal.removeEventListener("abort", notifyAbort);
  }
  if (request.signal.aborted) return { kind: "invalid" };
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
