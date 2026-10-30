import React from "react";
import { createRoot } from "react-dom/client";
import { sanitizeNextPath } from "../../../../src/lib/utils/next.ts";
import { guardRedirect } from "../lib/safeApiRedirect.ts";
import { acceptLatestTerms } from "../lib/terms.ts";

const h = React.createElement;
export const RULES_RETRY_MESSAGE = "保存を完了できませんでした。再読み込み後にもう一度お試しください。同意済みの可能性があります。";
export const RULES_COMMIT_ERROR = "同意処理で問題が発生しました。再読み込みして状態を確認してください。";
export const RULES_GENERIC_ERROR = "利用規約への同意を完了できませんでした。";

/** Parity with CURRENT app/(public)/rules/page.tsx's three error-code branches. */
export function rulesErrorMessage(errorCode: string | null): string | null {
  if (!errorCode) return null;
  if (errorCode === "concurrent_update" || errorCode === "database_unavailable") return RULES_RETRY_MESSAGE;
  if (errorCode === "terms_commit_failed") return RULES_COMMIT_ERROR;
  return RULES_GENERIC_ERROR;
}

/**
 * Return an action instead of navigating directly so failure, rollback and
 * server-selected navigation can be tested without a browser or real D1.
 */
export async function submitRulesConsent(
  next: string,
  fetcher: typeof fetch = fetch,
): Promise<{ navigate: string } | { error: string }> {
  try {
    const result = await acceptLatestTerms(next, fetcher);
    if (result.ok) {
      const target = guardRedirect(result.next);
      return target ? { navigate: target } : { error: RULES_GENERIC_ERROR };
    }
    if (result.message) return { error: result.message };
    // SA-075 uses redirects for auth/commit failures; Hono MIG-0641 returns
    // exactly those server-sanitized same-origin destinations in result.next.
    const target = guardRedirect(result.next);
    return target ? { navigate: target } : { error: RULES_GENERIC_ERROR };
  } catch {
    return { error: RULES_COMMIT_ERROR };
  }
}

export function RulesConsentIsland(): React.ReactElement {
  const query = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const next = sanitizeNextPath(query.get("next"));
  const [error, setError] = React.useState<string | null>(() => rulesErrorMessage(query.get("error")));
  const [pending, setPending] = React.useState(false);
  const pendingRef = React.useRef(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const outcome = await submitRulesConsent(next);
      if ("navigate" in outcome) {
        window.location.assign(outcome.navigate);
        return;
      }
      setError(outcome.error);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return h(
    React.Fragment,
    null,
    error
      ? h("div", { className: "fn-entry-status fn-entry-status--warn", role: "alert" },
        h("h2", { className: "fn-panel-title" }, "同意処理の確認"),
        h("p", { className: "fn-panel-lead" }, error))
      : null,
    h("section", { className: "fn-surface-panel", "aria-labelledby": "rules-consent-title" },
      h("h2", { id: "rules-consent-title", className: "fn-panel-title" }, "利用規約への同意"),
      h("p", { className: "fn-panel-lead" },
        "いいね・セーブにはログインと利用規約への同意が必要です。承認済みの活動名義は不要です。イベント枠の確保には",
        " X ID の申請が、作品投稿にも承認済みの活動名義が必要です。",
        next !== "/dashboard" ? " 同意後、元のページへ戻ります。" : ""),
      h("form", { className: "fn-panel-actions", onSubmit: submit },
        h("input", { type: "hidden", name: "next", value: next }),
        h("button", { type: "submit", disabled: pending, "aria-busy": pending, className: "fn-btn fn-btn-primary" },
          pending ? "同意状態を保存中…" : "利用規約に同意して戻る"))),
  );
}

/** Static legal text remains visible with JavaScript disabled; the form does not. */
export function mountRulesConsent(scope: ParentNode = document): void {
  const host = scope.querySelector<HTMLElement>("#rules-consent-mount");
  if (!host || host.dataset.rulesConsentMounted === "1") return;
  host.dataset.rulesConsentMounted = "1";
  createRoot(host).render(h(RulesConsentIsland));
}
