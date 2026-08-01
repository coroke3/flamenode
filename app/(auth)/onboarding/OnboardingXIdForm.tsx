"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { requestXIdLink } from "@/lib/actions/xid";
import { parseXIdentityInput } from "@/lib/utils/xid";
import styles from "./page.module.css";

export function OnboardingXIdForm({
  initialValue = "",
}: {
  initialValue?: string;
}): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [rawInput, setRawInput] = React.useState(initialValue);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);

  const preview = parseXIdentityInput(rawInput);

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const normalized = parseXIdentityInput(rawInput);
    if (!normalized) {
      setError(
        "@username、username、または x.com / twitter.com のプロフィール URL を入力してください。",
      );
      return;
    }
    setError(null);
    setStatus(null);
    const fd = new FormData();
    fd.set("request_type", "link");
    fd.set("x_id", rawInput);
    startTransition(async () => {
      try {
        const result = await requestXIdLink(fd);
        if (result.ok) {
          setStatus("X ID 連携を申請しました。");
          router.refresh();
          return;
        }
        setError(result.message ?? "申請に失敗しました。");
      } catch {
        setError("申請の保存に失敗しました。時間をおいて再試行してください。");
      }
    });
  };

  return (
    <form
      className={styles.xIdForm}
      onSubmit={onSubmit}
      aria-labelledby="ob-xid-form-label"
    >
      <span id="ob-xid-form-label" className="fn-sr-only">
        X ID を申請する
      </span>

      <label className={styles.compactLabel} htmlFor="ob-xid-input">
        X ID
      </label>
      <div className={styles.xIdInputRow}>
        <span className={styles.xIdAt} aria-hidden>
          @
        </span>
        <input
          id="ob-xid-input"
          type="text"
          autoComplete="username"
          placeholder="username または https://x.com/username"
          className={styles.xIdInput}
          value={rawInput}
          onChange={(e) => {
            setRawInput(e.target.value);
            setError(null);
          }}
          disabled={pending}
          required
        />
      </div>

      <p className={styles.inputHint}>
        入力例: username / @username / https://x.com/username
      </p>

      {rawInput && preview ? (
        <p className={styles.xIdPreview} role="status" aria-live="polite">
          申請する X ID：<strong>@{preview}</strong>
        </p>
      ) : rawInput && !preview ? (
        <p className={styles.xIdPreviewWarn} role="status" aria-live="polite">
          入力を認識できません
        </p>
      ) : null}

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
        disabled={pending || !preview}
        aria-busy={pending}
      >
        {pending ? "申請中…" : "この X ID で申請する"}
      </button>
    </form>
  );
}
