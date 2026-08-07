const SIGN_OUT_ERROR_MESSAGE =
  "ログアウトに失敗しました。再読み込みしてもう一度お試しください。";

export type AuthSignOutResult =
  | { ok: true }
  | { ok: false; message: string };

type SessionVerifyOutcome =
  | { status: "cleared" }
  | { status: "cookie_remained" }
  | { status: "inconclusive"; verifyResult: "skipped" | "failed" };

function createClientTraceId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function logClientFlowTrace(event: {
  phase: string;
  trace_id: string;
  result: "started" | "succeeded" | "failed";
  error_code?: string;
  verify_result?: "skipped" | "failed";
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
        ...(event.verify_result ? { verify_result: event.verify_result } : {}),
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

async function checkSessionUserPresent(): Promise<
  "cleared" | "cookie_remained" | "failed"
> {
  try {
    const sessionResponse = await fetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!sessionResponse.ok) return "failed";
    const sessionData = (await sessionResponse.json()) as {
      user?: { id?: unknown };
    };
    if (
      sessionData.user &&
      typeof sessionData.user.id === "string" &&
      sessionData.user.id
    ) {
      return "cookie_remained";
    }
    return "cleared";
  } catch {
    return "failed";
  }
}

async function verifySessionCleared(traceId: string): Promise<SessionVerifyOutcome> {
  void traceId;
  const first = await checkSessionUserPresent();
  if (first === "cleared") return { status: "cleared" };

  // cookie 残存も network 失敗も、削除反映待ちのため1回リトライする
  await new Promise((r) => setTimeout(r, 50));

  const second = await checkSessionUserPresent();
  if (second === "cleared") return { status: "cleared" };
  if (second === "cookie_remained") return { status: "cookie_remained" };

  const verifyResult: "skipped" | "failed" =
    first === "failed" || second === "failed" ? "failed" : "skipped";
  return { status: "inconclusive", verifyResult };
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

    const sessionVerify = await verifySessionCleared(traceId);
    if (sessionVerify.status === "cookie_remained") {
      logClientFlowTrace({
        phase: "signout_completed",
        trace_id: traceId,
        result: "failed",
        error_code: "AUTH_SIGNOUT_COOKIE_REMAINED",
      });
      return { ok: false, message: SIGN_OUT_ERROR_MESSAGE };
    }

    if (sessionVerify.status === "inconclusive") {
      logClientFlowTrace({
        phase: "signout_completed",
        trace_id: traceId,
        result: "succeeded",
        error_code: "AUTH_SIGNOUT_SESSION_VERIFY_INCONCLUSIVE",
        verify_result: sessionVerify.verifyResult,
      });
      return { ok: true };
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
