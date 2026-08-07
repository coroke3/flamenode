const SIGN_OUT_ERROR_MESSAGE =
  "ログアウトに失敗しました。再読み込みしてもう一度お試しください。";

export type AuthSignOutResult =
  | { ok: true }
  | { ok: false; message: string };

export async function signOutViaAuthRoute(): Promise<AuthSignOutResult> {
  try {
    const csrfResponse = await fetch("/api/auth/csrf", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!csrfResponse.ok) {
      return { ok: false, message: SIGN_OUT_ERROR_MESSAGE };
    }

    const csrfData = (await csrfResponse.json()) as { csrfToken?: unknown };
    const csrfToken = csrfData.csrfToken;
    if (typeof csrfToken !== "string" || !csrfToken) {
      return { ok: false, message: SIGN_OUT_ERROR_MESSAGE };
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
      return { ok: false, message: SIGN_OUT_ERROR_MESSAGE };
    }

    return { ok: true };
  } catch {
    return { ok: false, message: SIGN_OUT_ERROR_MESSAGE };
  }
}
