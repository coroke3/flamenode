import * as React from "react";
import type { TermsApi } from "../api/terms.js";

/** CURRENT app/(auth)/onboarding/OnboardingTermsForm.tsx, MIG-0710 U02. */
export function OnboardingTermsForm({
  versionLabel,
  termsBody,
  api,
  onAccepted,
}: {
  versionLabel: string;
  termsBody: React.ReactNode;
  api: TermsApi;
  onAccepted: () => void;
}): React.ReactElement {
  const [pending, setPending] = React.useState(false);
  const inFlight = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [agreed, setAgreed] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    if (!agreed) {
      setError("利用規約に同意するにはチェックボックスをオンにしてください。");
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await api.accept();
      if (result.status === "ok" && result.data.ok) {
        setStatus("利用規約への同意が完了しました。");
        onAccepted();
      } else {
        setError(
          result.status === "ok" && typeof result.data.message === "string"
            ? result.data.message
            : "同意の保存に失敗しました。時間をおいて再試行してください。",
        );
      }
    } catch {
      setError("同意の保存に失敗しました。時間をおいて再試行してください。");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <form className="onb-termsForm" onSubmit={(event) => { void onSubmit(event); }}>
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm onb-termsToggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "利用規約全文を閉じる" : "利用規約全文を表示"}
      </button>

      {expanded ? (
        <article className="onb-termsBody" aria-label="利用規約全文">
          {termsBody}
        </article>
      ) : null}

      <p className="onb-termsVersion" role="status">
        同意対象バージョン: {versionLabel}
      </p>

      <label className="onb-termsCheckRow" htmlFor="ob-terms-agree">
        <input
          id="ob-terms-agree"
          type="checkbox"
          className="onb-termsCheckbox"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
          disabled={pending}
          required
        />
        <span className="onb-termsLabel">利用規約 バージョン{versionLabel}に同意します</span>
      </label>

      {error ? <p className="onb-formError" role="alert">{error}</p> : null}
      {status ? (
        <p className="onb-formStatus" role="status" aria-live="polite">{status}</p>
      ) : null}
      <button
        type="submit"
        className="fn-btn fn-btn-primary"
        disabled={pending || !agreed}
        aria-busy={pending}
      >
        {pending ? "同意中…" : "同意して続ける"}
      </button>
    </form>
  );
}
