import { redirect } from "next/navigation";
import { loadAuthSessionUncached } from "@/lib/auth/session";
import {
  resolveAuthCompleteSession,
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
 * sessionを短時間再確認 → 安全なnextへ303相当のredirectのみ。
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
    "/dashboard",
  );

  const resolution = await resolveAuthCompleteSession(
    loadAuthSessionUncached,
  );
  if (resolution.kind === "unavailable") {
    logFlowTrace({
      flow: "discord_auth",
      phase: "auth_complete_rendered",
      trace_id: traceId,
      result: "failed",
      error_code: "session_read_failed_after_retry",
      duration_ms: Date.now() - started,
      retryable: true,
    });
    redirect("/entry?error=auth_temporarily_unavailable");
  }

  if (resolution.kind === "missing") {
    logFlowTrace({
      flow: "discord_auth",
      phase: "auth_complete_rendered",
      trace_id: traceId,
      result: "skipped",
      error_code: "session_missing_after_retry",
      duration_ms: Date.now() - started,
    });
    redirect("/entry?error=OAuthCallback");
  }

  if (resolution.kind !== "authenticated") {
    redirect("/entry");
  }

  if (resolution.attempts > 1) {
    logFlowTrace({
      flow: "discord_auth",
      phase: "auth_session_retry_recovered",
      trace_id: traceId,
      result: "succeeded",
      duration_ms: Date.now() - started,
      retryable: true,
    });
  }

  const sessionUser = resolution.session.user as {
    is_banned?: number | null;
  };
  if (sessionUser.is_banned === 1) {
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
