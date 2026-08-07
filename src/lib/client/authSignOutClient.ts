const SIGN_OUT_ERROR_MESSAGE =
  "ログアウトに失敗しました。再読み込みしてもう一度お試しください。";

export type AuthSignOutResult =
  | { ok: true }
  | { ok: false; message: string };

function createClientTraceId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function logClientFlowTrace(event: {
  phase: string;
  trace_id: string;
  result: "started" | "succeeded" | "failed";
  error_code?: string;
}): void {
  try {
    console.info(
      JSON.stringify({
        kind: "flow_trace",
        flow: "discord_auth",
        phase: event.phase,
        trace_id: event.trace_id,
        result: event.result,
        ...(event.error_code ? { error_code: event.error_code } : {}),
      }),
    );
  } catch {
    // 観測失敗で主処理を落とさない
  }
}

function signOutFailed(traceId: string): AuthSignOutResult {
  logClientFlowTrace({
    phase: "signout_completed",
    trace_id: traceId,
    result: "failed",
    error_code: "AUTH_SIGNOUT_FAILED",
  });
  return { ok: false, message: SIGN_OUT_ERROR_MESSAGE };
}

export async function signOutViaAuthRoute(): Promise<AuthSignOutResult> {
  const traceId = createClientTraceId();
  logClientFlowTrace({
    phase: "signout_started",
    trace_id: traceId,
    result: "started",
  });

  try {
    const csrfResponse = await fetch("/api/auth/csrf", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!csrfResponse.ok) {
      return signOutFailed(traceId);
    }

    const csrfData = (await csrfResponse.json()) as { csrfToken?: unknown };
    const csrfToken = csrfData.csrfToken;
    if (typeof csrfToken !== "string" || !csrfToken) {
      return signOutFailed(traceId);
    }

    const body = new URLSearchParams({
      csrfToken,
      callbackUrl: "/",
    });
    const signOutResponse = await fetch("/api/auth/signout", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Auth-Return-Redirect": "1",
      },
      body: body.toString(),
      credentials: "same-origin",
    });
    if (!signOutResponse.ok) {
      return signOutFailed(traceId);
    }

    logClientFlowTrace({
      phase: "signout_completed",
      trace_id: traceId,
      result: "succeeded",
    });
    return { ok: true };
  } catch {
    return signOutFailed(traceId);
  }
}
