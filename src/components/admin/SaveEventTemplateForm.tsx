"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { saveEventAsTemplate } from "@/lib/actions/event-template-admin";

interface SaveEventTemplateFormProps {
  eventId: string;
  eventTitle: string;
}

export function SaveEventTemplateForm({
  eventId,
  eventTitle,
}: SaveEventTemplateFormProps): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const r = await saveEventAsTemplate(fd);
          if (!r.ok) {
            setError(r.message ?? "保存に失敗しました。");
            return;
          }
          setSuccess(r.message ?? "保存しました。");
          router.refresh();
        });
      }}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <input type="hidden" name="event_id" value={eventId} />
      <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
        「{eventTitle}」の設定（枠種別・公開範囲・フォーム・部・権限・審査など）をテンプレートとして保存します。
        開催日時・枠・作品・スタッフ承認は含みません。
      </p>
      <div>
        <label className="fn-label">テンプレート名 *</label>
        <input
          name="name"
          type="text"
          className="fn-input"
          required
          maxLength={120}
          placeholder="例: PVSF 標準セット"
          defaultValue={`${eventTitle} テンプレート`}
        />
      </div>
      <div>
        <label className="fn-label">メモ（任意）</label>
        <input
          name="description"
          type="text"
          className="fn-input"
          maxLength={500}
          placeholder="用途や差分のメモ"
        />
      </div>
      {error ? (
        <p className="fn-text-sm" style={{ color: "var(--accent-danger)", margin: 0 }}>
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="fn-text-sm" style={{ color: "var(--ok)", margin: 0 }}>
          {success}
        </p>
      ) : null}
      <div>
        <button
          type="submit"
          className="fn-btn fn-btn-primary"
          disabled={busy}
        >
          {busy ? "保存中…" : "この設定をテンプレート化"}
        </button>
      </div>
    </form>
  );
}
