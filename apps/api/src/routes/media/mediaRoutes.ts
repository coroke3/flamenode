/**
 * MIG-0646: RH-024/025 must be more specific than RH-023's public wildcard.
 * Only GET exists in CURRENT. Public media cache is checked before bindings;
 * the slot icon's D1 visibility probe is checked before optional session.
 */
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../env.ts";
import {
  getCachedPublicMediaResponse,
  isValidPublicMediaKey,
  servePublicMedia,
} from "./publicMedia.ts";
import { serveManageXIcon } from "./manageXIcon.ts";
import {
  isValidSlotSubmissionIconSlotId,
  probeSlotSubmissionIcon,
  serveSlotSubmissionIconRow,
} from "./slotSubmissionIcon.ts";
import {
  extractSessionToken,
  resolveSessionUser,
  SessionUnavailableError,
} from "../../auth/session.ts";

const UNAVAILABLE_HEADERS = {
  "cache-control": "no-store",
  "retry-after": "30",
};
const NOT_FOUND_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function unavailable(message: string): Response {
  return new Response(message, { status: 503, headers: UNAVAILABLE_HEADERS });
}
function notFound(withPrivateHeaders = false): Response {
  return new Response("Not found", {
    status: 404,
    ...(withPrivateHeaders ? { headers: NOT_FOUND_HEADERS } : {}),
  });
}

function pathValue(c: Context<AppEnv>, prefix: string): string {
  const pathname = new URL(c.req.url).pathname;
  if (!pathname.startsWith(prefix)) return "";
  const raw = pathname.slice(prefix.length);
  if (raw.length > 4096) return "";
  try {
    // Next's catch-all params decode each URL path component exactly once.
    return raw.split("/").map((segment) => decodeURIComponent(segment)).join("/");
  } catch {
    return "";
  }
}

function executionWaitUntil(c: Context<AppEnv>): ((promise: Promise<unknown>) => void) | undefined {
  try {
    return c.executionCtx.waitUntil.bind(c.executionCtx);
  } catch {
    // Local test/runtime without Workers executionCtx.
    return undefined;
  }
}

export const mediaRoutes = new Hono<AppEnv>();

// RH-024 — 404 for bad/expired/tampered signature, not 403 (CURRENT policy).
mediaRoutes.get("/manage-x-icon/*", async (c) => {
  const key = pathValue(c, "/api/media/manage-x-icon/");
  if (!c.env?.BUCKET || !c.env.AUTH_SECRET) return notFound();
  return serveManageXIcon(
    { BUCKET: c.env.BUCKET, AUTH_SECRET: c.env.AUTH_SECRET },
    key,
    c.req.raw,
  );
});

// RH-025 — unauthorized private images remain indistinguishable from missing ones.
mediaRoutes.get("/slot-submission-icon/:slotId", async (c) => {
  const slotId = pathValue(c, "/api/media/slot-submission-icon/");
  if (!isValidSlotSubmissionIconSlotId(slotId)) return notFound(true);
  if (!c.env?.DB || !c.env.BUCKET) return unavailable("Media access check unavailable");

  try {
    const probe = await probeSlotSubmissionIcon({ DB: c.env.DB }, slotId);
    if (probe.kind === "unavailable") return unavailable("Media access check unavailable");
    if (probe.kind === "not_found") return notFound(true);
    const options = { waitUntil: executionWaitUntil(c) };
    if (probe.kind === "public") {
      return serveSlotSubmissionIconRow({ BUCKET: c.env.BUCKET }, probe.row, null, c.req.raw, options);
    }

    // Auth.js is loaded only when D1 says the submitted slot needs a viewer.
    const token = extractSessionToken(c.req.header("cookie"), {
      secure: new URL(c.req.url).protocol === "https:",
    });
    let viewer: { id: string; active_x_user_id: string | null } | null = null;
    if (token) {
      try {
        const user = await resolveSessionUser(c.env.DB, token);
        if (user && user.is_banned !== 1) {
          viewer = { id: user.id, active_x_user_id: user.active_x_user_id };
        }
      } catch (error) {
        if (error instanceof SessionUnavailableError) {
          return unavailable("Media access check unavailable");
        }
        throw error;
      }
    }
    return serveSlotSubmissionIconRow({ BUCKET: c.env.BUCKET }, probe.row, viewer, c.req.raw, options);
  } catch {
    console.error("[slot-submission-icon] media read failed");
    return unavailable("Media temporarily unavailable");
  }
});

// RH-023 — invalid keys are rejected before any cache/D1/R2 I/O.
mediaRoutes.get("/*", async (c) => {
  const key = pathValue(c, "/api/media/");
  if (!isValidPublicMediaKey(key)) return notFound();

  const cached = await getCachedPublicMediaResponse(c.req.raw, key);
  if (cached) return cached;
  if (!c.env?.DB || !c.env.BUCKET) return unavailable("Storage temporarily unavailable");

  return servePublicMedia(
    { DB: c.env.DB, BUCKET: c.env.BUCKET },
    key,
    c.req.raw,
    { skipEdgeCacheLookup: true, waitUntil: executionWaitUntil(c) },
  );
});
