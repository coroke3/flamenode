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

/** MIG-0725 U02: pure CURRENT notification error guidance until MIG-0719 shared UI merges. */
interface NotificationFailureGuidance {
  summary: string;
  nextSteps: string[];
}

/** 運営者向け: 失敗・滞留・運用キャンセル時の次アクション。 */
function getNotificationFailureGuidance(input: {
  status: string | null | undefined;
  lastError: string | null | undefined;
  attemptCount: number | null | undefined;
}): NotificationFailureGuidance | null {
  const status = input.status ?? "";
  const err = (input.lastError ?? "").toLowerCase();
  const attempts = input.attemptCount ?? 0;

  if (status === "pending") {
    return {
      summary: "次の dispatcher 実行を待っています。",
      nextSteps: [
        "Queue wake で即時起動する。未処理なら毎時0分の fast-jobs Recovery Cron を待つ",
        "長時間 pending の場合は Worker cron と D1 接続を確認する",
      ],
    };
  }

  if (status === "processing") {
    return {
      summary: "送信処理中です。配送リースは5分で失効します。",
      nextSteps: [
        "配送リース（5分）超過後は毎時0分の fast-jobs Recovery Cron で自動回収される",
        "1時間以上 processing のままなら Worker と D1 を確認する",
      ],
    };
  }

  if (status === "cancelled") {
    if (err.includes("notification disabled")) {
      return {
        summary: "宛先の通知設定がOFFになったため、配送前に停止しました。",
        nextSteps: ["再送が必要な場合だけ通知設定を確認して強制再送する"],
      };
    }
    return {
      summary: "手動または運用ルールでキャンセル済みです。",
      nextSteps: ["再送が必要なら管理者画面から強制再送する"],
    };
  }

  if (!TERMINAL_FAILURES.has(status)) return null;

  if (err.includes("delivery lease expired") || err.includes("processing timeout")) {
    return {
      summary: "送信処理のリースが期限切れになりました。",
      nextSteps: [
        "Worker の実行履歴とD1接続を確認する",
        "原因解消後に通知を再試行する",
      ],
    };
  }

  if (err.includes("forum_webhook_unconfigured")) {
    const raw = input.lastError ?? "";
    const targetMatch = raw.match(
      /forum_webhook_unconfigured:(account|event|system)/i,
    );
    const forumSecretByTarget: Record<string, string> = {
      account: "DISCORD_WEBHOOK_URL_FORUM_ACCOUNT",
      event: "DISCORD_WEBHOOK_URL_FORUM_EVENT",
      system: "DISCORD_WEBHOOK_URL_FORUM_SYSTEM",
    };
    const targetKey = targetMatch?.[1]?.toLowerCase();
    const forumSecret = targetKey ? forumSecretByTarget[targetKey] : null;
    return {
      summary: "Forum 配信用 Discord Webhook URL が未設定です。",
      nextSteps: [
        forumSecret
          ? `${forumSecret} を確認する`
          : "DISCORD_WEBHOOK_URL_FORUM_ACCOUNT / DISCORD_WEBHOOK_URL_FORUM_EVENT / DISCORD_WEBHOOK_URL_FORUM_SYSTEM を確認する",
        "legacy の DISCORD_WEBHOOK_URL は webhook_target 無しの旧通知行のみに適用される",
        "設定修正後に失敗通知を再試行する",
      ],
    };
  }

  if (err.includes("webhook_unconfigured")) {
    return {
      summary: "Discord Webhook URL が未設定です。",
      nextSteps: [
        "DISCORD_WEBHOOK_URL_FORUM_ACCOUNT / DISCORD_WEBHOOK_URL_FORUM_EVENT / DISCORD_WEBHOOK_URL_FORUM_SYSTEM、または移行用 legacy DISCORD_WEBHOOK_URL を確認する",
        "設定修正後に失敗通知を再試行する",
      ],
    };
  }

  if (
    err.includes("bot_token_unconfigured") ||
    err.includes("401") ||
    err.includes("unauthorized")
  ) {
    return {
      summary: "Discord Bot の認証設定に問題があります。",
      nextSteps: [
        "DISCORD_BOT_TOKEN を確認する",
        "設定修正後に失敗通知を再試行する",
      ],
    };
  }

  if (err.includes("403") || err.includes("cannot send")) {
    return {
      summary: "宛先がBotのDMを受け取れない可能性があります。",
      nextSteps: [
        "宛先がBotとサーバーを共有し、DMを許可しているか確認する",
        "必要ならサイト内または運営Discordで別途連絡する",
      ],
    };
  }

  if (err.includes("recipient_missing") || err.includes("404")) {
    return {
      summary: "有効なDiscord宛先を解決できませんでした。",
      nextSteps: [
        "ユーザーのDiscord連携状態を確認する",
        "連携解除済みなら再送せずキャンセルする",
      ],
    };
  }

  if (
    err.includes("rate") ||
    err.includes("429") ||
    err.includes("cooldown")
  ) {
    return {
      summary: "Discordのレート制限に達した可能性があります。",
      nextSteps: [
        "Discord指定の待機時間を空ける",
        "短時間に通知が集中していないか確認する",
      ],
    };
  }

  if (
    err.includes("timeout") ||
    err.includes("network") ||
    err.includes("request_budget")
  ) {
    return {
      summary: "Discord通信または無料枠内の実行予算で失敗しました。",
      nextSteps: [
        "一時障害なら時間を空けて再試行する",
        "繰り返す場合はWorkerログと外部通信件数を確認する",
      ],
    };
  }

  return {
    summary: `配送を完了できませんでした（試行 ${attempts} 回）。`,
    nextSteps: [
      "payloadと宛先のDiscord連携状態を確認する",
      "原因解消後に再試行する",
      "繰り返す場合はDiscord側の応答とWorkerログを確認する",
    ],
  };
}


/** 運営画面向け: last_error を日本語要約へ変換する。 */
function translateNotificationError(
  lastError: string | null | undefined,
): string | null {
  const err = (lastError ?? "").trim();
  if (!err) return null;
  const lower = err.toLowerCase();
  if (lower.includes("discord_channel_webhook_unconfigured")) {
    return "運営チャンネル用 Webhook URL (DISCORD_WEBHOOK_URL) が未設定です。";
  }
  if (lower.includes("discord_dm_bot_token_unconfigured")) {
    return "利用者 DM 用 Bot Token (DISCORD_BOT_TOKEN) が未設定です。";
  }
  if (lower.includes("discord_recipient_missing")) {
    return "宛先ユーザーの Discord ID が未連携のため、DM を配送できません。";
  }
  if (lower.includes("discord_payload_invalid")) {
    return "通知 payload が Discord API 形式として不正です。";
  }
  return err;
}


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
    : row.type.startsWith("chapter_") ? "チャプター"
    : row.type.startsWith("moderation_") ? "モデレーション"
    : row.type.startsWith("announcement_") ? "お知らせ"
    : row.type.startsWith("event_") ? "イベント"
    : row.type.startsWith("ops_") || row.type === "discord_webhook" || row.type === "welcome_account"
      ? "システム" : "その他";
  // Match CURRENT's high-severity notification categories, not a generic soft badge.
  const critical = row.type === "video_voided" || row.type === "ops_youtube_playlist_sync_failed";
  const warning = new Set([
    "slot_force_released", "slot_submission_released", "x_id_rejected",
    "moderation_created", "slot_deadline_reminder", "ops_youtube_quota_deferred",
  ]).has(row.type);
  const recipient = row.recipient;
  const destination = recipient?.userName
    ? recipient.discordId ? recipient.userName + " (" + recipient.discordId + ")" : recipient.userName
    : recipient?.discordId ?? row.recipient_user_id ?? "運営チャンネル";
  const preview = previewPayload(row.payload_json);
  const guidance = getNotificationFailureGuidance({
    status: row.status, lastError: row.last_error, attemptCount: row.attempt_count,
  });
  const showGuidance = guidance !== null &&
    (TERMINAL_FAILURES.has(status) || status === "processing" || status === "cancelled");
  return (
    <div className="manage-notification-summary">
      <div>
        <span className={"fn-badge " + (TERMINAL_FAILURES.has(status) ? "fn-badge-danger" : status === "processing" ? "fn-badge-warning" : status === "sent" ? "fn-badge-accent" : "fn-badge-soft")}>
          {ownLabel(STATUS_LABELS, status) ?? (status || "不明")}
        </span>{" "}
        <span className={"fn-badge " + (critical ? "fn-badge-danger" : warning ? "fn-badge-warning" : "fn-badge-soft")}>{category}</span>{" "}
        <strong>{ownLabel(TYPE_LABELS, row.type) ?? row.type.replaceAll("_", " ")}</strong>
      </div>
      <div className="fn-td-muted">宛先: {destination}{recipient?.notificationsEnabled === false ? "（通知OFF）" : ""}</div>
      {preview ? <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{preview}</div> : null}
      {showGuidance && guidance ? (
        <div className="fn-surface-panel" role="status" data-testid="notification-failure-guidance">
          <strong>{guidance.summary}</strong>
          <ul>{guidance.nextSteps.map((step) => <li key={step}>{step}</li>)}</ul>
        </div>
      ) : null}
      {(TERMINAL_FAILURES.has(status) || status === "cancelled") && row.last_error ? (
        <div className="fn-td-muted" style={{ overflowWrap: "anywhere" }}>
          {translateNotificationError(row.last_error) ?? row.last_error}
        </div>
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
