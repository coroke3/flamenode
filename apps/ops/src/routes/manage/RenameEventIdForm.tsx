// MIG-0721 U02d: CURRENT SA-021 rename confirmation form with injected ports.
// No default write client or route registration; the protected host remains unmounted.
import * as React from "react";
import type { EventFormProps } from "../../components/event/EventForm.js";
import { Icon } from "../../components/shared/Icon.js";

export function RenameEventIdForm({
  eventId,
  renameEvent,
  onReplace,
  onRefresh,
}: {
  eventId: string;
  renameEvent: EventFormProps["updateEvent"];
  onReplace: (href: string) => void;
  onRefresh: () => void;
}): React.ReactElement {
  const [newId, setNewId] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await renameEvent(formData);
      if (!result.ok || !result.eventId) {
        setError(result.message ?? "イベントIDの変更に失敗しました。");
        return;
      }
      onReplace("/manage/events/" + encodeURIComponent(result.eventId) + "/edit");
      onRefresh();
    });
  };

  const normalizedNewId = newId.trim();
  const canSubmit =
    !busy &&
    normalizedNewId.length > 0 &&
    normalizedNewId !== eventId &&
    confirm === eventId;

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12, marginTop: 16 }}>
      <input type="hidden" name="old_event_id" value={eventId} />

      <div>
        <label className="fn-label" htmlFor="admin-new-event-id">
          新しいイベントID
        </label>
        <input
          id="admin-new-event-id"
          name="new_event_id"
          className="fn-input"
          value={newId}
          onChange={(event) => setNewId(event.target.value)}
          pattern="[A-Za-z0-9_-]{1,64}"
          maxLength={64}
          autoComplete="off"
          placeholder="例: pvsf-2026"
          required
        />
        <p className="fn-muted fn-text-sm" style={{ marginTop: 6 }}>
          URL・枠・運営・作品・YouTube同期などのイベント参照をまとめて新IDへ移行します。
        </p>
      </div>

      <div>
        <label className="fn-label" htmlFor="admin-event-id-confirm">
          確認のため現在のID「{eventId}」を入力
        </label>
        <input
          id="admin-event-id-confirm"
          name="confirm"
          className="fn-input"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          autoComplete="off"
          required
        />
      </div>

      {error ? (
        <p role="alert" className="fn-alert fn-alert--danger">
          <Icon name="warning" size={12} /> {error}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          className="fn-btn fn-btn-danger"
          disabled={!canSubmit}
        >
          {busy ? "変更中…" : "イベントIDを変更"}
        </button>
      </div>
    </form>
  );
}
