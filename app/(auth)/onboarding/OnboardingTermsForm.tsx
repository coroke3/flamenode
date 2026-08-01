"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { acceptOnboardingTerms } from "@/lib/actions/terms";
import styles from "./page.module.css";

export function OnboardingTermsForm({
  versionLabel,
  termsBody,
}: {
  versionLabel: string;
  termsBody: React.ReactNode;
}): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [agreed, setAgreed] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!agreed) {
      setError("利用規約に同意するにはチェックボックスをオンにしてください。");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await acceptOnboardingTerms();
        if (result.ok) {
          setStatus("利用規約への同意が完了しました。");
          router.refresh();
          return;
        }
        setError(result.message);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("NEXT_REDIRECT") || msg.includes("NEXT_NOT_FOUND")) {
          throw err;
        }
        setError("同意の保存に失敗しました。時間をおいて再試行してください。");
      }
    });
  };

  return (
    <form className={styles.termsForm} onSubmit={onSubmit}>
      <button
        type="button"
        className={`fn-btn fn-btn-ghost fn-btn-sm ${styles.termsToggle}`}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "利用規約全文を閉じる" : "利用規約全文を表示"}
      </button>

      {expanded ? (
        <article className={styles.termsBody} aria-label="利用規約全文">
          {termsBody}
        </article>
      ) : null}

      <p className={styles.termsVersion} role="status">
        同意対象バージョン: {versionLabel}
      </p>

      <label className={styles.termsCheckRow} htmlFor="ob-terms-agree">
        <input
          id="ob-terms-agree"
          type="checkbox"
          className={styles.termsCheckbox}
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          disabled={pending}
          required
        />
        <span className={styles.termsLabel}>
          利用規約 バージョン{versionLabel}に同意します
        </span>
      </label>

      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className={styles.formStatus} role="status" aria-live="polite">
          {status}
        </p>
      ) : null}

      <button
        type="submit"
        className="fn-btn fn-btn-primary"
        disabled={pending || !agreed}
        aria-busy={pending}
      >
        {pending ? "同意中…" : "同意して X ID 登録へ"}
      </button>
    </form>
  );
}
