/**
 * MIG-0641 U01h/U02/U03b: isolated write route factory.
 *
 * Do not mount it into personal/index.ts until the owner approves a dedicated
 * terms acceptance CostGuard feature. The caller MUST supply the operation
 * guard; no default allow/no-op feature mapping exists. Cross-origin requests
 * are rejected before the session D1 lookup. Unaccepted users can agree,
 * while anonymous and banned accounts are rejected before the mutation.
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import {
  AcceptLatestTermsBodySchema,
  type AcceptLatestTermsResponse,
} from "@flamenode/contracts";
import { requireAuth, sessionMiddleware } from "../../auth/session.ts";
import type { AppEnv } from "../../env.ts";
import { originGuardMiddleware } from "../../middleware/writeOrigin.ts";
import { dbMiddleware } from "../../middleware/db.ts";
import { computeOnboardingState, loadPersonalContext } from "./context.ts";
import { markOnboardingComplete, type CompletionStatus } from "./termsCompletion.ts";
import { commitLatestTermsForUser, createTermsCommitPort } from "./termsCommit.ts";
import { projectLatestTerms, projectOnboardingTerms, type TermsCommitOutcome } from "./termsDecision.ts";

const NO_STORE = "private, no-store";
const MAX_TERMS_REQUEST_BYTES = 2048;

type TermsContext = Context<AppEnv>;
type TermsCommit = (c: TermsContext, userId: string) => Promise<TermsCommitOutcome>;

export type TermsWriteRouteOptions = {
  /** Must be a reviewed CostGuard policy middleware, NOT a no-op. */
  operationGuard: MiddlewareHandler<AppEnv>;
  /** Test-only seam; production callers use sessionMiddleware. */
  session?: MiddlewareHandler<AppEnv>;
  /** Test-only seam; production calls createTermsCommitPort with a real D1. */
  commit?: TermsCommit;
  /** Test-only seam; production resolves X state from authoritative D1. */
  resolveCompletionStatus?: (c: TermsContext, userId: string) => Promise<CompletionStatus>;
};

async function readTermsBody(request: Request): Promise<
  { kind: "ok"; value: unknown } | { kind: "invalid" } | { kind: "too_large" }
> {
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > MAX_TERMS_REQUEST_BYTES) {
    return { kind: "too_large" };
  }
  if (!request.body) return { kind: "invalid" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let lengthRead = 0;
  for (;;) {
    let read: ReadableStreamReadResult<Uint8Array>;
    try {
      read = await reader.read();
    } catch {
      return { kind: "invalid" };
    }
    if (read.done) break;
    lengthRead += read.value.byteLength;
    if (lengthRead > MAX_TERMS_REQUEST_BYTES) {
      await reader.cancel().catch(() => {});
      return { kind: "too_large" };
    }
    chunks.push(read.value);
  }
  try {
    const data = new Uint8Array(lengthRead);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    return { kind: "ok", value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)) };
  } catch {
    return { kind: "invalid" };
  }
}

const originOptions = (c: TermsContext) => ({
  loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
  allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
});

async function defaultCommit(c: TermsContext, userId: string): Promise<TermsCommitOutcome> {
  // Session 1 + reviewed CostGuard 1 + terms snapshot 1 = 3 D1 reads.
  // Audit prepare may perform further reads; real Worker CPU must be measured.
  const port = createTermsCommitPort(c.env.DB, c.get("db"), {
    callerQueryCount: 3,
    preloaded: {
      settings: c.get("auditSettings"),
      actorSnapshotJsonById: c.get("actorSnapshotJsonById"),
    },
  });
  return commitLatestTermsForUser(port, userId);
}

async function defaultCompletionStatus(
  c: TermsContext, userId: string,
): Promise<CompletionStatus> {
  const user = c.get("user");
  if (!user || user.id !== userId) return "none";
  const ctx = await loadPersonalContext(c.env.DB, user, { pendingRequest: true });
  if (!ctx) return "none";
  return computeOnboardingState({
    user: ctx.user, linkedRows: ctx.linkedRows, pendingRequest: ctx.pendingRequest,
  }).xIdentityStatus;
}

export function createIsolatedTermsWriteRoutes(options: TermsWriteRouteOptions): Hono<AppEnv> {
  // A cost policy must be supplied explicitly before routes may be constructed.
  if (typeof options?.operationGuard !== "function") {
    throw new Error("MIG-0641: approved CostGuard middleware is required");
  }
  const routes = new Hono<AppEnv>();
  routes.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", NO_STORE);
  });
  routes.use("*", (c, next) => originGuardMiddleware(originOptions(c))(c, next));
  routes.use("*", options.session ?? (sessionMiddleware() as MiddlewareHandler<AppEnv>));
  routes.use("*", requireAuth());
  routes.use("*", options.operationGuard);
  routes.use("*", dbMiddleware);

  const commit: TermsCommit = options.commit ?? defaultCommit;

  routes.post("/terms/accept", async (c) => {
    const body = await readTermsBody(c.req.raw);
    if (body.kind === "too_large") return c.json({ ok: false, message: "リクエストが大きすぎます。" }, 413);
    const input = body.kind === "ok" ? AcceptLatestTermsBodySchema.safeParse(body.value) : null;
    if (!input?.success) return c.json({ ok: false, message: "入力内容を確認してください。" }, 400);
    const result = await commit(c, c.get("user")!.id);
    const response: AcceptLatestTermsResponse = projectLatestTerms(result, input.data.next);
    const status = result.kind === "database_unavailable" ? 503 :
      result.kind === "concurrent_update" ? 409 :
      result.kind === "commit_failed" ? 500 :
      result.kind === "terms_unavailable" ? 404 :
      result.kind === "user_missing" ? 404 : 200;
    return c.json(response, status);
  });

  routes.post("/onboarding/terms", async (c) => {
    const body = await readTermsBody(c.req.raw);
    if (body.kind === "too_large") return c.json({ ok: false, message: "リクエストが大きすぎます。" }, 413);
    if (body.kind !== "ok" || !body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
      return c.json({ ok: false, message: "入力内容を確認してください。" }, 400);
    }
    const result = await commit(c, c.get("user")!.id);
    const response = projectOnboardingTerms(result);
    const status = result.kind === "database_unavailable" ? 503 :
      result.kind === "concurrent_update" ? 409 :
      result.kind === "commit_failed" ? 500 :
      result.kind === "terms_unavailable" ? 404 :
      result.kind === "user_missing" ? 404 : 200;
    return c.json(response, status);
  });

  routes.post("/onboarding/complete", async (c) => {
    // Completion is an auxiliary marker. Its failure never authorizes/denies
    // another request. X status comes from server D1, never the request body.
    const userId = c.get("user")!.id;
    try {
      const status = await (options.resolveCompletionStatus ?? defaultCompletionStatus)(c, userId);
      await markOnboardingComplete(c.env.DB, userId, status);
    } catch {
      // CURRENT maybeMarkOnboardingComplete intentionally ignores failures.
    }
    return c.json({ ok: true }, 200);
  });

  routes.onError((_error, c) => {
    // Do not echo SQL parameters, cookies, audit snapshots or error messages.
    return c.json({ ok: false, message: "処理に失敗しました。時間をおいて再試行してください。" }, 503, {
      "Cache-Control": NO_STORE,
    });
  });
  return routes;
}
