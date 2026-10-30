import * as React from "react";
import type { ManageNotificationCenterResponse, ManageNotificationWithRecipient } from "@flamenode/contracts";
import { useSearchParams } from "react-router-dom";
import type { OpsFetch } from "../../api/read.js";
import { readManageNotifications } from "../../api/manageNotifications.js";
import { EmptyState } from "../../components/shared/EmptyState.js";
import { NotFoundView } from "../NotFoundView.js";
import { useApiResult } from "../useApiResult.js";

const DEFAULT_FETCH: OpsFetch = (path, init) => fetch(path, init);
const TYPE_OPTIONS = [
  ["all", "すべて"], ["video", "作品"], ["slot", "枠"],
  ["x_id", "X ID"], ["chapter", "チャプター"], ["other", "その他"],
] as const;
const STATUS_OPTIONS = [
  ["", "すべての状態"], ["pending", "配信待ち"],
  ["processing", "送信中"], ["sent", "送信済み"],
  ["failed", "最終失敗"], ["cancelled", "キャンセル"],
] as const;
const STATUS_LABELS: Record<string, string> = {
  pending: "配信待ち", processing: "送信中", sent: "送信済み",
  failed: "失敗", dead_letter: "最終失敗", cancelled: "キャンセル",
};
const TERMINAL_FAILURES = new Set(["failed", "dead_letter"]);

/** API and DB values are untrusted; inherited Object.prototype keys are not labels. */
function ownLabel(labels: Record<string, string>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : undefined;
}

const TYPE_LABELS: Record<string, string> = {
  video_submitted: "作品を受け付けました",
  video_approved: "作品が公開されました",
  video_voided: "作品について確認があります",
  video_pending: "作品が審査待ちになりました",
  video_private: "作品の公開範囲が変更されました",
  video_status_changed: "作品の状態が変更されました",
  video_edit_permission_granted: "編集権限が付与されました",
  slot_video_submitted: "枠投稿を受け付けました",
  slot_deadline_reminder: "投稿締切が近づいています",
  slot_force_released: "枠が解放されました",
  slot_submission_released: "枠の作品提出が解除されました",
  slot_voided: "枠が無効になりました",
  x_id_approved: "X ID が承認されました",
  x_id_rejected: "X ID が却下されました",
  x_id_alias_approved: "X ID エイリアスが承認されました",
  chapter_comment_added: "チャプターコメントが追加されました",
  moderation_created: "モデレーション案件が作成されました",
  announcement_broadcast: "お知らせ配信",
  terms_reaccept_required: "利用規約の再同意が必要です",
  welcome_account: "アカウント作成のお知らせ",
  discord_webhook: "運営チャンネル（Webhook）",
  ops_youtube_playlist_sync_failed: "YouTube再生リスト同期の失敗",
  ops_youtube_playlist_sync_recovered: "YouTube再生リスト同期の復旧",
  ops_youtube_quota_deferred: "YouTube再生リスト同期のquota延期",
};

/** A payload can contain user-generated content. Never render it as HTML. */
function previewPayload(payloadJson: string): string | null {
  try {
    const payload: unknown = JSON.parse(payloadJson);
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
    const content = (payload as Record<string, unknown>).content;
    if (typeof content !== "string") return null;
    const firstLine = content.split("\n").find((line) => line.trim())?.trim() ?? "";
    return firstLine.length > 80 ? firstLine.slice(0, 80) + "…" : firstLine || null;
  } catch {
    return null;
  }
}

/** Mirrors CURRENT formatUnix/formatRelative without importing the Next.js-only UI. */
function NotificationDate({ unixSeconds }: { unixSeconds: number }): React.ReactElement {
  const date = new Date(unixSeconds * 1000);
  // Hono's current DTO accepts numbers without a Date range bound; a malformed
  // outbox timestamp must not throw RangeError and take down the whole Ops view.
  if (!Number.isFinite(unixSeconds) || !Number.isFinite(date.getTime())) return <span>—</span>;
  const secondsAgo = Date.now() / 1000 - unixSeconds;
  const relative = secondsAgo < 60 ? "今"
    : secondsAgo < 3600 ? `${Math.floor(secondsAgo / 60)}分前`
    : secondsAgo < 86400 ? `${Math.floor(secondsAgo / 3600)}時間前`
    : secondsAgo < 2592000 ? `${Math.floor(secondsAgo / 86400)}日前`
    : secondsAgo < 31536000 ? `${Math.floor(secondsAgo / 2592000)}か月前`
    : `${Math.floor(secondsAgo / 31536000)}年前`;
  const absolute = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(date);
  return <>
    <time dateTime={date.toISOString()}>{absolute}</time>
    <div className="fn-td-muted">{relative}</div>
  </>;
}

function NotificationSummary({ row }: { row: ManageNotificationWithRecipient }): React.ReactElement {
  const status = row.status ?? "";
  const category = row.type.startsWith("video_") ? "作品"
    : row.type.startsWith("slot_") ? "枠"
    : row.type.startsWith("x_id_") ? "X ID"
    : row.type.startsWith("chapter_") ? "チャプター" : "その他";
  const recipient = row.recipient;
  const destination = recipient?.userName
    ? recipient.discordId ? recipient.userName + " (" + recipient.discordId + ")" : recipient.userName
    : recipient?.discordId ?? row.recipient_user_id ?? "運営チャンネル";
  const preview = previewPayload(row.payload_json);
  return (
    <div className="manage-notification-summary">
      <div>
        <span className={"fn-badge " + (TERMINAL_FAILURES.has(status) ? "fn-badge-danger" : status === "processing" ? "fn-badge-warning" : "fn-badge-soft")}>
          {ownLabel(STATUS_LABELS, status) ?? (status || "不明")}
        </span>{" "}
        <span className="fn-badge fn-badge-soft">{category}</span>{" "}
        <strong>{ownLabel(TYPE_LABELS, row.type) ?? row.type.replaceAll("_", " ")}</strong>
      </div>
      <div className="fn-td-muted">宛先: {destination}{recipient?.notificationsEnabled === false ? "（通知OFF）" : ""}</div>
      {preview ? <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{preview}</div> : null}
      {(TERMINAL_FAILURES.has(status) || status === "cancelled") && row.last_error ? (
        <div className="fn-td-muted" style={{ overflowWrap: "anywhere" }}>{row.last_error}</div>
      ) : null}
    </div>
  );
}

/** U02 presentation: the Hono response has already passed schema validation. */
export function ManageNotificationsBody({ data, search, change }: {
  data: ManageNotificationCenterResponse;
  search: URLSearchParams;
  change: (name: "event" | "notif" | "status", value: string) => void;
}): React.ReactElement {
  const statusValue = search.get("status") ?? "";
  const notifValue = search.get("notif") ?? "";
  return (
    <div className="manage-notifications">
      <header className="fn-page-head">
        <a href="/manage">イベント運営トップへ</a>
        <h1 className="fn-page-title">通知センター</h1>
        <p>担当イベントに紐づくDiscord通知の配信状況です（直近50件）。最終失敗の復旧操作はサイト管理者が行います。</p>
      </header>
      {data.schemaMissing ? (
        <div role="status" className="fn-alert fn-alert--warn">
          notification_outbox の event_id 列が未適用です。<code>npm run db:local-apply</code> を実行してください。
        </div>
      ) : null}
      {data.failedCount > 0 ? (
        <div role="status" className="fn-alert fn-alert--danger">
          <strong>最終失敗 {data.failedCount} 件</strong> — 内容と案内を各行で確認してください。
          {data.isAdmin ? <a href="/admin/notifications?status=failed">管理者用ログ</a> : null}
        </div>
      ) : null}
      <form method="get" className="manage-notification-filters" onSubmit={(event) => event.preventDefault()}>
        {!data.isAdmin ? (
          <label>イベント
            <select className="fn-input fn-input-sm" name="event" value={search.get("event") ?? ""}
              onChange={(event) => change("event", event.currentTarget.value)}>
              <option value="">すべての担当イベント</option>
              {data.managedEvents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>
        ) : null}
        <label>通知
          <select className="fn-input fn-input-sm" name="notif" value={TYPE_OPTIONS.some(([key]) => key === notifValue) ? notifValue : "all"}
            onChange={(event) => change("notif", event.currentTarget.value)}>
            {TYPE_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label>状態
          <select className="fn-input fn-input-sm" name="status" value={STATUS_OPTIONS.some(([key]) => key === statusValue) ? statusValue : ""}
            onChange={(event) => change("status", event.currentTarget.value)}>
            {STATUS_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </form>
      {data.notifications.length === 0 ? (
        <EmptyState title="通知はありません" description="選択条件に一致する通知ログがありません。"
          actions={[{ href: "/manage", label: "運営トップへ", variant: "ghost" }]} />
      ) : (
        <div className="fn-table-scroll">
          <table className="fn-table manage-notifications-table">
            <thead><tr><th>通知</th><th>日時</th><th>イベント</th></tr></thead>
            <tbody>
              {data.notifications.map((row) => (
                <tr key={row.id}>
                  <td><NotificationSummary row={row} /></td>
                  <td className="manage-notification-date-cell">
                    <NotificationDate unixSeconds={row.created_at} />
                  </td>
                  <td>{row.event_id ? (
                    <a href={"/manage/events/" + encodeURIComponent(row.event_id)}>
                      {ownLabel(data.eventTitles, row.event_id)?.slice(0, 24) ?? row.event_id.slice(0, 8) + "…"}
                    </a>
                  ) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Retains CURRENT query/deep-link/back-forward semantics.
 * The existing OpsGate still guards the route; the API enforces event ownership.
 */
function ManageNotificationsForQuery({ fetchFn, search, setSearch }: {
  fetchFn: OpsFetch;
  search: URLSearchParams;
  setSearch: ReturnType<typeof useSearchParams>[1];
}): React.ReactElement {
  const result = useApiResult((signal) => readManageNotifications(fetchFn, search, signal), search.toString());
  React.useEffect(() => {
    // CURRENT session guard and manage layout redirect on lost access.
    // Use fixed local targets; never navigate to untrusted API redirect strings.
    if (result.status === "anonymous") window.location.assign("/entry");
    if (result.status === "forbidden") window.location.assign("/dashboard");
  }, [result.status]);
  if (result.status === "loading") return <div role="status" aria-busy="true">読み込み中...</div>;
  if (result.status === "notFound") return <NotFoundView />;
  if (result.status === "anonymous") return <div role="alert">セッションが切れました。<a href="/entry">ログイン</a></div>;
  if (result.status === "forbidden") return <div role="alert">この画面へのアクセス権限がありません。<a href="/dashboard">ダッシュボードへ</a></div>;
  if (result.status !== "ok") return <div role="alert">通知を取得できませんでした。再読み込みしてください。</div>;
  return (
    <ManageNotificationsBody data={result.data} search={search} change={(name, value) => {
      const next = new URLSearchParams(search);
      next.set(name, value);
      setSearch(next);
    }} />
  );
}

/** Remount on filter changes so previous-event data cannot flash before a new GET. */
export function ManageNotifications({ fetchFn = DEFAULT_FETCH }: { fetchFn?: OpsFetch }): React.ReactElement {
  const [search, setSearch] = useSearchParams();
  return <ManageNotificationsForQuery key={search.toString()} fetchFn={fetchFn} search={search} setSearch={setSearch} />;
}
