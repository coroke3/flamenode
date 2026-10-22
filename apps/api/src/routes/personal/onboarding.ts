import { Hono } from "hono";
import type { OnboardingResponse, OnboardingRules } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { computeOnboardingState, loadPersonalContext } from "./context.ts";

// CURRENT: app/(auth)/onboarding/page.tsx.
// D1: 1 batch (terms + linked X + pending request), plus the rules text only while terms acceptance is
// pending (1 R2 GET, then 1 D1 statement only when R2 has no usable object).
//
// NOT reproduced (GET must stay read-only): maybeMarkOnboardingComplete(), CURRENT's conditional
// UPDATE user.onboarding_completed_at on every /onboarding view. It is not used for authorization.
export const RULES_OBJECT_KEY = "rules/current.json";
/** CURRENT allows 16 MiB (PUBLIC_STATIC_JSON_MAX_OBJECT_BYTES); ZERO_1102 S2 keeps JSON.parse inputs <= 64 KiB. */
export const MAX_RULES_OBJECT_BYTES = 64 * 1024;

function present(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** CURRENT normalizeStaticRules (staticRulesCore.ts), projected to the fields the page uses. */
export function normalizeRules(payload: unknown): OnboardingRules | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const bodyMarkdown = present(record.body_markdown);
  const versionLabel = present(record.version_label);
  if (!bodyMarkdown || !versionLabel) return null;
  return { versionLabel, bodyMarkdown };
}

async function readRulesObject(bucket: R2Bucket | undefined): Promise<unknown | undefined> {
  if (!bucket) return undefined;
  try {
    const object = await bucket.get(RULES_OBJECT_KEY);
    if (!object) return undefined;
    if (!Number.isSafeInteger(object.size) || object.size < 0 || object.size > MAX_RULES_OBJECT_BYTES) {
      try {
        await object.body?.cancel();
      } catch {
        // resource cleanup only
      }
      return undefined;
    }
    return await object.json<unknown>();
  } catch {
    return undefined;
  }
}

/** CURRENT publicVisibilityManifestCore.ts */
export const VISIBILITY_MANIFEST_KEY = "visibility/blocked-entities.v1.json";
export const VISIBILITY_MANIFEST_MAX_BYTES = 1024 * 1024;

/**
 * CURRENT loadPublicJson resolvePublicVisibilityGuard for the "rules" target: the "rules" target maps to no
 * fenced entity, so only the enforce-mode fail-closed rule applies: without a committed, size-bounded
 * visibility manifest in R2 nothing is served (rules = null -> the client shows the built-in default terms).
 * The manifest body is not parsed here (S2 JSON bound); a malformed manifest is a known gap.
 */
async function visibilityGuardAllows(env: AppEnv["Bindings"]): Promise<boolean> {
  if (env.PUBLIC_VISIBILITY_GUARD_MODE !== "enforce") return true;
  try {
    const head = await env.BUCKET?.head(VISIBILITY_MANIFEST_KEY);
    return Boolean(
      head?.etag?.trim() && Number.isFinite(head.size) && head.size >= 0 && head.size <= VISIBILITY_MANIFEST_MAX_BYTES,
    );
  } catch {
    return false;
  }
}

/**
 * Only published terms are ever returned: the R2 artifact is generated from published terms and the
 * D1 fallback filters status = 'published' (CURRENT fetchDegradedRulesPayload). Cache API use and the
 * miss-time rebuild enqueue of CURRENT are intentionally skipped (GET must not write): known gap.
 */
async function loadRules(env: AppEnv["Bindings"]): Promise<OnboardingRules | null> {
  if (!(await visibilityGuardAllows(env))) return null;
  const fromR2 = await readRulesObject(env.BUCKET);
  if (fromR2 !== undefined && fromR2 !== null) return normalizeRules(fromR2);
  try {
    const row = await env.DB.prepare(
      `SELECT version_label, body_markdown FROM terms_versions
       WHERE status = 'published'
       ORDER BY published_at DESC, updated_at DESC
       LIMIT 1`,
    ).first<{ version_label: string; body_markdown: string }>();
    return row ? normalizeRules(row) : null;
  } catch {
    // CURRENT's loader does not throw to the page on a degraded-read failure; the page falls back to default terms.
    return null;
  }
}

export const personalOnboardingRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) return c.json({ error: "Unauthorized" }, 401);
  const ctx = await loadPersonalContext(c.env.DB, sessionUser, { pendingRequest: true });
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const state = computeOnboardingState({
    user: ctx.user,
    linkedRows: ctx.linkedRows,
    pendingRequest: ctx.pendingRequest,
  });
  const body: OnboardingResponse = {
    user: ctx.user,
    state,
    rules: state.needsTermsAcceptance ? await loadRules(c.env) : null,
  };
  return c.json(body);
});
