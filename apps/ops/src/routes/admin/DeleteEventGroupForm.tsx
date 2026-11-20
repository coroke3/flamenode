/**
 * MIG-0728 U01: CURRENT DeleteEventGroupForm (SA-028) with ConfirmDialog and
 * single-flight lock.
 */
import * as React from "react";
import {
  createAdminEventGroupsApi,
  type AdminEventGroupsApi,
} from "../../api/adminEventGroups.js";
import { ConfirmDialog } from "../../components/shared/ConfirmDialog.js";

export function DeleteEventGroupForm({
  id,
  name,
  api,
  onDeleted,
}: {
  id: string;
  name: string;
  api?: AdminEventGroupsApi;
  onDeleted?: () => void;
}): React.ReactElement {
  const client = React.useMemo(() => api ?? createAdminEventGroupsApi(), [api]);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  async function handleDelete(): Promise<void> {
    if (busyRef.current || !id) return;
    busyRef.current = true;
    setBusy(true);
    setConfirmOpen(false);
    setError(null);
    try {
      const result = await client.deleteGroup(id);
      if (result.anonymous) {
        window.location.assign("/entry");
        return;
      }
      if (!result.ok) {
        setError(result.message ?? "削除に失敗しました。");
        return;
      }
      onDeleted?.();
    } catch {
      setError("削除に失敗しました。再読み込みして、もう一度お試しください。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <p
        style={{
          margin: "0 0 10px",
          color: "var(--text-secondary)",
          fontSize: 12,
        }}
      >
        削除するとグループ本体とイベント紐付けが完全に消えます。
      </p>

      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 13 }}>
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="fn-btn fn-btn-danger fn-btn-sm"
        onClick={() => setConfirmOpen(true)}
        disabled={busy || !id}
      >
        {busy ? "削除中…" : "グループを削除"}
      </button>

      <ConfirmDialog
        open={confirmOpen}
        title="イベントグループを削除"
        message={
          <>
            「{name}」を削除します。
            <br />
            所属イベントとの紐付けも解除されます。
          </>
        }
        confirmLabel="削除する"
        tone="danger"
        busy={busy}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
