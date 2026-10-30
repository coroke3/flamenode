/**
 * MIG-0636 G21: byte limits for the Personal X write API.
 * The clone is consumed in bounded chunks; Hono handlers can still read the
 * original request body after this preflight has accepted it.
 */
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.ts";

export const DEFAULT_XID_WRITE_LIMIT_BYTES = 64 * 1024;
export const XID_ICON_UPLOAD_LIMIT_BYTES = 8 * 1024 * 1024;

export const XID_ACTION_BODY_LIMITS = {
  "SA-098": DEFAULT_XID_WRITE_LIMIT_BYTES,
  "SA-099": DEFAULT_XID_WRITE_LIMIT_BYTES,
  "SA-100": DEFAULT_XID_WRITE_LIMIT_BYTES,
  "SA-101": DEFAULT_XID_WRITE_LIMIT_BYTES,
  "SA-102": DEFAULT_XID_WRITE_LIMIT_BYTES,
  "SA-103": DEFAULT_XID_WRITE_LIMIT_BYTES,
  "SA-104": DEFAULT_XID_WRITE_LIMIT_BYTES,
  "SA-105": XID_ICON_UPLOAD_LIMIT_BYTES,
} as const;

export type XIdWriteAction = keyof typeof XID_ACTION_BODY_LIMITS;

export function limitXIdActionBody(action: XIdWriteAction): MiddlewareHandler<AppEnv> {
  const maxBytes = XID_ACTION_BODY_LIMITS[action];
  return async (c, next) => {
    const deny = (reason: "body_too_large" | "invalid_body_length" | "body_unreadable", status: 400 | 413) => {
      c.header("Cache-Control", "private, no-store");
      return c.json({ ok: false, reason }, status);
    };

    // Content-Length is advisory: a missing or forged value never skips the
    // actual stream check. Reject malformed values rather than silently trusting them.
    const declaredLength = c.req.header("content-length");
    if (declaredLength !== undefined) {
      if (!/^(0|[1-9][0-9]*)$/.test(declaredLength)) {
        return deny("invalid_body_length", 400);
      }
      if (Number(declaredLength) > maxBytes) {
        return deny("body_too_large", 413);
      }
    }

    let readBytes = 0;
    const reader = c.req.raw.clone().body?.getReader();
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          readBytes += value.byteLength;
          if (readBytes > maxBytes) {
            // Do not await cancellation of one tee branch: the other branch
            // remains unread until middleware returns.
            void reader.cancel().catch(() => undefined);
            return deny("body_too_large", 413);
          }
        }
      } catch {
        void reader.cancel().catch(() => undefined);
        return deny("body_unreadable", 400);
      } finally {
        reader.releaseLock();
      }
    } else if (declaredLength !== undefined && declaredLength !== "0") {
      return deny("invalid_body_length", 400);
    }

    await next();
  };
}
