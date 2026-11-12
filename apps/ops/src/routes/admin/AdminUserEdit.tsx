import * as React from "react";
import { useParams } from "react-router-dom";
import type { AdminUserEditResponse } from "@flamenode/contracts";
import { createAdminUsersApi } from "../../api/adminUsers.js";
import { createAdminUserEditMutations, type UserEditResult } from "../../api/adminUserEdits.js";
import { useApiResult } from "../useApiResult.js";
import { NotFoundView } from "../NotFoundView.js";
import { ConfirmDialog } from "../../components/shared/ConfirmDialog.js";

const readApi = createAdminUsersApi();
const writes = createAdminUserEditMutations();

/** A reason change, stale user state, or pending write invalidates BAN confirmation. */
export function canConfirmUserBan(reason: string, confirmedReason: string | null, busy: boolean, alreadyBanned: boolean): boolean {
  return !busy && !alreadyBanned && Boolean(confirmedReason) && reason.trim() === confirmedReason;
}

/** Prevent multiple in-flight role/BAN/notification writes before React commits state. */
export function acquireAdminUserWriteLock(lock: { current: boolean }): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

/** CURRENT UserAdminForm parity candidate. Writes stay protected by Hono admin guard and atomic D1 audit. */
export function AdminUserEditContent({ data, onSaved, onAccessRevoked }: {
  data: AdminUserEditResponse;
  onSaved: () => void;
  onAccessRevoked: () => void;
}): React.ReactElement {
  const { user, xUserIds, truncated } = data;
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [banReason, setBanReason] = React.useState("");
  const [banConfirmReason, setBanConfirmReason] = React.useState<string | null>(null);
  React.useEffect(() => { setBanConfirmReason(null); }, [user.id, user.is_banned]);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  async function run(action: () => Promise<UserEditResult>, message: string): Promise<void> {
    if (!acquireAdminUserWriteLock(busyRef)) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await action();
      if (result.status === "anonymous") {
        window.location.assign("/entry");
        return;
      }
      if (result.status === "forbidden") {
        onAccessRevoked();
        return;
      }
      if (result.status !== "ok" || !result.data.ok) {
        setError(result.status === "ok"
          ? (result.data.message ?? "操作に失敗しました。")
          : "操作を処理できませんでした。再度お試しください。");
        return;
      }
      setSuccess(message + (result.data.pendingPublicReflection ? "（公開画面への反映は保留中です）" : ""));
      onSaved();
    } catch {
      setError("操作を処理できませんでした。再度お試しください。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const inverse = (value: number) => value === 1 ? 0 as const : 1 as const;
  return <div className="fn-public-container fn-page">
    <header className="fn-page-head">
      <a href={"/admin/users/" + encodeURIComponent(user.id)}>ユーザー詳細へ</a>
      <h1 className="fn-page-title">{user.name ?? user.id} を編集</h1>
      <p>ID: {user.id}</p>
      <nav aria-label="ユーザー管理">
        <a href={"/admin/users/" + encodeURIComponent(user.id)}>詳細</a>
        <span style={{ marginLeft: 16 }} aria-current="page">編集</span>
      </nav>
    </header>
    <div className="fn-card" style={{ padding: 20, marginTop: 16, display: "flex", flexDirection: "column", gap: 18 }}>
      {error ? <p role="alert" className="fn-text-danger">{error}</p> : null}
      {success ? <p role="status">{success}</p> : null}
      <section>
        <h2>ロール</h2>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["user", "moderator", "admin"] as const).map((role) =>
            <button key={role} type="button" disabled={busy}
              className={"fn-btn fn-btn-sm " + (user.role === role ? "fn-btn-primary" : "fn-btn-ghost")}
              onClick={() => { void run(() => writes.setRole(user.id, role), "ロールを " + role + " に変更しました。"); }}>
              {role}
            </button>)}
        </div>
      </section>
      <section>
        <h2>BAN 状態</h2>
        <p>現在: {user.is_banned === 1 ? "BAN 中" : "通常"}</p>
        {user.is_banned === 1 ?
          <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" disabled={busy}
            onClick={() => { void run(() => writes.setBanned(user.id, 0), "BAN を解除しました。"); }}>
            BAN を解除
          </button> :
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <input className="fn-input" type="text" value={banReason} maxLength={500}
              placeholder="BAN 理由 (必須)" aria-label="BAN 理由"
              onChange={(event) => {
                setBanReason(event.target.value);
                setBanConfirmReason(null);
              }} />
            <button type="button" className="fn-btn fn-btn-danger fn-btn-sm"
              disabled={busy || !banReason.trim()}
              onClick={() => { if (!busy && banReason.trim()) setBanConfirmReason(banReason.trim()); }}>BAN</button>
          </div>}
      </section>
      <section>
        <h2>開催権限</h2>
        <p>ON のユーザーは将来のイベント作成権限候補として扱います。開催申請フローは作成しません。</p>
        <button type="button" className="fn-btn fn-btn-sm" disabled={busy}
          onClick={() => { void run(
            () => writes.setCanCreateEvents(user.id, inverse(user.can_create_events)),
            "開催権限を更新しました。"); }}>
          {user.can_create_events === 1 ? "開催権限ON" : "開催権限OFF"}
        </button>
      </section>
      <section>
        <h2>通知</h2>
        <button type="button" className="fn-btn fn-btn-sm" disabled={busy}
          onClick={() => { void run(
            () => writes.setNotifications(user.id, inverse(user.is_notification_enabled)),
            "通知設定を更新しました。"); }}>
          {user.is_notification_enabled === 1 ? "通知ON" : "通知OFF"}
        </button>
      </section>
      <section>
        <h2>連携 X ID のアイコン再計算</h2>
        <p>各 X ID について、最新の対象作品アイコンから再設定します。</p>
        {truncated ? <p role="alert">連携 X ID が取得上限を超えています。一覧には一部のみ表示されます。</p> : null}
        {xUserIds.length === 0 ? <p className="fn-muted">連携済 X ID がありません。</p> :
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {xUserIds.map((id) =>
              <button key={id} type="button" className="fn-btn fn-btn-ghost fn-btn-sm" disabled={busy}
                onClick={() => { void run(() => writes.refreshXIcon(id), "@" + id + " のアイコンを再計算しました。"); }}>
                @{id}
              </button>)}
          </div>}
      </section>
      <ConfirmDialog
        open={banConfirmReason !== null}
        title="ユーザーを BAN"
        message={"このユーザーを BAN します。\n理由: " + (banConfirmReason ?? "")}
        confirmLabel="BAN する"
        cancelLabel="キャンセル"
        tone="danger"
        busy={!canConfirmUserBan(banReason, banConfirmReason, busy, user.is_banned === 1)}
        onConfirm={() => {
          if (!canConfirmUserBan(banReason, banConfirmReason, busy, user.is_banned === 1)) return;
          const reason = banConfirmReason!;
          setBanConfirmReason(null);
          void run(() => writes.setBanned(user.id, 1, reason), "BAN しました。");
        }}
        onCancel={() => setBanConfirmReason(null)}
      />
    </div>
  </div>;
}

export function AdminUserEdit(): React.ReactElement {
  const { id } = useParams<"id">();
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [writeDenied, setWriteDenied] = React.useState(false);
  const result = useApiResult((signal) => readApi.getUserEdit(id ?? "", signal),
    "admin-user-edit:" + (id ?? ""), refreshKey);
  React.useEffect(() => {
    if (writeDenied) { window.location.assign("/dashboard"); return; }
    if (result.status === "anonymous") window.location.assign("/entry");
    if (result.status === "forbidden") window.location.assign(result.redirect || "/dashboard");
  }, [result, writeDenied]);
  // A denied admin write removes the private editor before redirect completes.
  if (writeDenied) return <section role="alert">管理権限を確認できませんでした。</section>;
  if (!id || result.status === "notFound") return <NotFoundView />;
  if (result.status === "loading" || result.status === "anonymous" || result.status === "forbidden") {
    return <div role="status" aria-busy="true">読み込み中...</div>;
  }
  if (result.status !== "ok") return <section role="alert">
    <p>ユーザー編集情報を取得できませんでした。</p>
    <button type="button" className="fn-btn" onClick={() => setRefreshKey((x) => x + 1)}>再試行</button>
  </section>;
  return <AdminUserEditContent data={result.data}
    onSaved={() => setRefreshKey((x) => x + 1)}
    onAccessRevoked={() => setWriteDenied(true)} />;
}
