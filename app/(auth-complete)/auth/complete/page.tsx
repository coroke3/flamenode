import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getAuthSession } from "@/lib/auth/session";
import { getDatabaseAsync } from "@/lib/cloudflare";
import { users } from "@/lib/db/schema";
import {
  sanitizeAuthCompleteNext,
} from "@/lib/auth/authComplete";
import {
  createTraceId,
  logFlowTrace,
} from "@/lib/observability/flowTrace";
import { firstSearchParamValue } from "@/lib/utils/next";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Discord OAuth callback直後の軽量ランディング。
 * session確認 → D1 user存在確認 → 安全なnextへ303相当のredirectのみ。
 */
export default async function AuthCompletePage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string | string[] }>;
}): Promise<never> {
  const started = Date.now();
  const traceId = createTraceId();
  logFlowTrace({
    flow: "discord_auth",
    phase: "auth_complete_rendered",
    trace_id: traceId,
    result: "started",
  });

  const params = await searchParams;
  const next = sanitizeAuthCompleteNext(
    firstSearchParamValue(params?.next),
    "/onboarding",
  );

  let session;
  try {
    session = await getAuthSession();
  } catch {
    logFlowTrace({
      flow: "discord_auth",
      phase: "auth_complete_rendered",
      trace_id: traceId,
      result: "failed",
      error_code: "auth_temporarily_unavailable",
      duration_ms: Date.now() - started,
    });
    redirect("/entry?error=auth_temporarily_unavailable");
  }

  const userId = session?.user
    ? (session.user as { id?: string | null }).id
    : null;
  if (!userId) {
    logFlowTrace({
      flow: "discord_auth",
      phase: "auth_complete_rendered",
      trace_id: traceId,
      result: "failed",
      error_code: "AccessDenied",
      duration_ms: Date.now() - started,
    });
    redirect("/entry?error=AccessDenied");
  }

  const db = await getDatabaseAsync();
  if (!db) {
    logFlowTrace({
      flow: "discord_auth",
      phase: "destination_render_started",
      trace_id: traceId,
      result: "failed",
      error_code: "database_unavailable",
      duration_ms: Date.now() - started,
    });
    redirect("/entry?error=auth_temporarily_unavailable");
  }

  const userRow = (
    await db
      .select({
        id: users.id,
        is_banned: users.is_banned,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];

  if (!userRow) {
    logFlowTrace({
      flow: "discord_auth",
      phase: "auth_user_resolved",
      trace_id: traceId,
      result: "failed",
      error_code: "user_missing",
      duration_ms: Date.now() - started,
    });
    redirect("/entry?error=Configuration");
  }

  if (userRow.is_banned === 1) {
    redirect("/entry?error=AccessDenied");
  }

  logFlowTrace({
    flow: "discord_auth",
    phase: "auth_redirect_started",
    trace_id: traceId,
    result: "succeeded",
    duration_ms: Date.now() - started,
    committed: true,
  });

  redirect(next);
}
