import { entryLoginRedirectTo } from "../next.js";

/** CURRENT Server Action signIn("discord") is replaced with Auth.js same-origin HTTP form. */
export const discordAuthNavigation = {
  assign(to: string): void {
    window.location.assign(to);
  },
};

export async function startDiscordSignIn(next: string): Promise<void> {
  let form: HTMLFormElement | null = null;
  try {
    const response = await fetch("/api/auth/csrf", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("csrf_unavailable");

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("csrfToken" in payload)) {
      throw new Error("csrf_invalid");
    }
    const token = (payload as { csrfToken: unknown }).csrfToken;
    if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
      throw new Error("csrf_invalid");
    }

    form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/auth/signin/discord";
    form.hidden = true;
    for (const [name, value] of [
      ["csrfToken", token],
      ["callbackUrl", entryLoginRedirectTo(next)],
    ]) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  } catch {
    form?.remove();
    discordAuthNavigation.assign("/entry?error=auth_temporarily_unavailable");
  }
}
