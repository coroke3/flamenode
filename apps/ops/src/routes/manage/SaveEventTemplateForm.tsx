// Port of CURRENT src/components/admin/SaveEventTemplateForm.tsx (MIG-0720 U03, SA-035).
import * as React from "react";
import { saveEventAsTemplate } from "../../api/eventTemplates.js";
import type { OpsFetch } from "../../api/read.js";

export interface SaveEventTemplateFormProps {
  eventId: string;
  eventTitle: string;
  fetchFn?: OpsFetch;
  onSaved?: () => void;
  assign?: (url: string) => void;
}

export function SaveEventTemplateForm({
  eventId,
  eventTitle,
  fetchFn = (path, init) => fetch(path, init),
  onSaved,
  assign = (url) => window.location.assign(url),
}: SaveEventTemplateFormProps): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const inFlightRef = React.useRef(false);

  // Clear stale feedback when switching between events.
  React.useEffect(() => {
    setError(null);
    setSuccess(null);
  }, [eventId]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (inFlightRef.current || busy) return;
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const fd = new FormData(e.currentTarget);
      const outcome = await saveEventAsTemplate(fetchFn, {
        event_id: String(fd.get("event_id") ?? eventId),
        name: String(fd.get("name") ?? ""),
        description: typeof fd.get("description") === "string" ? (fd.get("description") as string) : null,
      });
      if (outcome.status === "anonymous") {
        assign("/entry");
        return;
      }
      if (outcome.status === "unavailable") {
        setError("保存に失敗しました。");
        return;
      }
      if (!outcome.data.ok) {
        setError(outcome.data.message ?? "保存に失敗しました。");
        return;
      }
      setSuccess(outcome.data.message ?? "保存しました。");
      onSaved?.();
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
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
          key={eventId}
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
          key={`desc:${eventId}`}
          name="description"
          type="text"
          className="fn-input"
          maxLength={500}
          placeholder="用途や差分のメモ"
        />
      </div>
      {error ? (
        <p role="alert" className="fn-text-sm" style={{ color: "var(--accent-danger)", margin: 0 }}>
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="fn-text-sm" style={{ color: "var(--ok)", margin: 0 }}>
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
