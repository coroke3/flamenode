import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import { requireAuth, sessionMiddleware } from "../../auth/session.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { personalDashboardRoutes } from "./dashboard.ts";
import { personalEditRoutes } from "./edit/index.ts";
import { personalEntryRoutes } from "./entry/index.ts";
import { personalLibraryRoutes } from "./library.ts";
import { personalOnboardingRoutes } from "./onboarding.ts";
import { personalSessionRoutes } from "./session.ts";
import { personalSettingsRoutes } from "./settings.ts";
import { createIsolatedTermsWriteRoutes } from "./termsRoutes.ts";

// MIG-0611: authenticated, read-only Personal screens API. Every response (success, 401, 403, 503)
// is `Cache-Control: private, no-store`; nothing here writes to D1, R2, KV or cookies.
const NO_STORE = "private, no-store";

export const personalRoutes = new Hono<AppEnv>();

personalRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", NO_STORE);
});
// MIG-0641 (SA-075/076 + onboarding complete): POST-only writes. Registered BEFORE the read-only session
// middleware below so Origin is checked before any session D1 read; the factory scopes its own guards to its
// three POST paths (ToS-pending users must pass; no writeGuard TOS check). CostGuard: personal_terms_accept.
personalRoutes.route("/", createIsolatedTermsWriteRoutes({ operationGuard: costGuardMiddleware("personal_terms_accept") }));
personalRoutes.use("*", sessionMiddleware());
personalRoutes.use("*", requireAuth());

personalRoutes.route("/session", personalSessionRoutes);
personalRoutes.route("/dashboard", personalDashboardRoutes);
personalRoutes.route("/library", personalLibraryRoutes);
personalRoutes.route("/settings", personalSettingsRoutes);
personalRoutes.route("/onboarding", personalOnboardingRoutes);
personalRoutes.route("/entry", personalEntryRoutes); // MIG-0623
personalRoutes.route("/edit", personalEditRoutes); // MIG-0630

// D1/R2 failures: fixed code only (errors may carry bound values); the SPA shows its "unavailable" state.
personalRoutes.onError((_error, c) => {
  console.error("[personal] READ_FAILED");
  return c.json({ error: "unavailable" }, 503, { "Cache-Control": NO_STORE });
});
