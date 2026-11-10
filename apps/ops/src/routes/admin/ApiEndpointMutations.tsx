/** MIG-0727 U04: unmounted Ops controls using SA-007/008 Hono writes.
 * The parent route remains owned by MIG-0726; server validates admin role,
 * public-event visibility, audit CAS, origin and Cost Guard.
 */
import * as React from "react";
import type { AdminApiEndpointsResponse } from "@flamenode/contracts";
import type { createAdminApiEndpointWriteApi } from "../../api/adminApiEndpointWrite.js";

type Api = ReturnType<typeof createAdminApiEndpointWriteApi>;
type Props = {
  data: AdminApiEndpointsResponse;
  api: Api;
  onSuccess: () => void;
};

export function AdminApiEndpointMutations({ data, api, onSuccess }: Props): React.ReactElement {
  const [eventId, setEventId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run(task: () => ReturnType<Api["enable"]>): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await task();
      if (result.ok) {
        setMessage(result.message ?? "公開API設定を更新しました。");
        onSuccess();
      } else {
        setError(result.message ?? "公開API設定を更新できませんでした。");
      }
    } catch {
      setError("公開API設定を更新できませんでした。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const validOptions = data.eventOptions.filter(row => row.enabled === 0 && row.id.trim().length > 0);
  return <section className="fn-panel" aria-label="API発行・無効化">
    <h2>イベントAPIを有効化</h2>
    <form onSubmit={e => {
      e.preventDefault();
      if (eventId && validOptions.some(row => row.id === eventId)) {
        void run(() => api.enable(eventId));
      }
    }}>
      <label className="fn-field">公開イベント
        <select name="event_id" className="fn-select" required value={eventId}
          onChange={e => setEventId(e.currentTarget.value)} disabled={busy}>
          <option value="">公開イベントを選択</option>
          {validOptions.map(row => <option key={row.id} value={row.id}>{row.title} ({row.id})</option>)}
        </select></label>
      <button type="submit" className="fn-btn fn-btn-primary"
        disabled={busy || !eventId || !validOptions.some(row => row.id === eventId)}>
        {busy ? "処理中…" : "APIリンクを発行"}</button>
    </form>
    <h3>発行済みAPIの無効化</h3>
    {data.rows.map(row => <div key={row.id}
      style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span>{row.event_title} ({row.event_id})</span>
      <button type="button" className="fn-btn fn-btn-sm fn-btn-ghost" disabled={busy}
        onClick={() => void run(() => api.setActive(row.event_id, 0))}>無効化</button>
    </div>)}
    {data.rows.length === 0 ? <p className="fn-muted">発行済みのイベントAPIはありません。</p> : null}
    {error ? <p role="alert" className="fn-alert fn-alert-danger">{error}</p> : null}
    {message ? <p role="status" className="fn-alert fn-alert-success">{message}</p> : null}
  </section>;
}
