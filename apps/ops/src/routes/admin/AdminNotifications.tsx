// MIG-0734 U02: port of CURRENT app/(admin)/admin/notifications/page.tsx (SA-045..048 callers). Same order, copy, links and classes.
import * as React from "react";
import type { AdminNotificationsResponse } from "@flamenode/contracts";
import { useSearchParams } from "react-router-dom";
import { adminReadRedirect } from "../../api/adminTop.js";
import {
  createAdminNotificationsApi, notificationFilterHref, truncateNotificationSearch, type AdminNotificationsApi, type NotificationFilters,
} from "../../api/adminNotifications.js";
import { NotificationOutboxSummary } from "../../components/notifications/NotificationOutboxSummary.js";
import {
  ADMIN_NOTIFICATION_CATEGORY_OPTIONS, getNotificationStatusLabel, isTerminalNotificationFailure,
  statusBadgeClass,
} from "../../components/notifications/notificationDisplay.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { IME_COMPOSING_FORM_ATTR, isImeComposingForm } from "../../components/shared/imeSafeSearch.js";
import { EmptyState } from "../../components/shared/EmptyState.js";
import { FnTable } from "../../components/shared/FnTable.js";
import { OpsLink as Link } from "../../components/shared/OpsLink.js";
import { useApiResult } from "../useApiResult.js";
import { formatRelative } from "./adminFormat.js";
import { NotificationActionButton } from "./NotificationActionButton.js";
import { NotificationCancelButton } from "./NotificationCancelButton.js";
import { NotificationPayloadButton } from "./NotificationPayloadButton.js";

const STATUS_TABS = [
  ["all", "すべて"], ["pending", "配信待ち"], ["processing", "送信中"],
  ["sent", "送信済み"], ["failed", "最終失敗"], ["cancelled", "キャンセル"],
] as const;

/** CURRENT ignores duplicated Next.js searchParams keys; mirror that behavior in the SPA. */
function singleNotificationQueryValue(params: URLSearchParams, key: string): string {
  const values = params.getAll(key);
  return values.length === 1 ? values[0] : "";
}

/** CURRENT parseStatus + sp.type/event/q/cat normalisation (q is cut at 100 chars). */
export function readNotificationFilters(params: URLSearchParams): NotificationFilters {
  const status = singleNotificationQueryValue(params, "status") || "all";
  const cat = singleNotificationQueryValue(params, "cat").trim();
  return {
    status: STATUS_TABS.some((row) => row[0] === status) ? status : "all",
    cat: ADMIN_NOTIFICATION_CATEGORY_OPTIONS.some((option) => option.key === cat) ? cat : "all",
    type: singleNotificationQueryValue(params, "type").trim(),
    event: singleNotificationQueryValue(params, "event").trim(),
    q: truncateNotificationSearch(singleNotificationQueryValue(params, "q")),
  };
}

const defaultApi = createAdminNotificationsApi();

type Data = AdminNotificationsResponse;

/** Pure view over the API response, testable without a network. */
export function AdminNotificationsView({ data, filters, api, onSuccess, onSearch }: {
  data: Data; filters: NotificationFilters; api: AdminNotificationsApi; onSuccess: (message?: string) => void;
  onSearch?: (next: URLSearchParams) => void;
}): React.ReactElement {
  const { counts, rows } = data;
  const status = filters.status;
  const deadLetterCount = counts.deadLetter;
  const unhealthyLeaseCount = counts.unhealthyLease;
  const filterInput = { type: filters.type, event: filters.event, q: filters.q, cat: filters.cat };
  const hasDetailFilter = Boolean(filters.type || filters.event || filters.q || filters.cat !== "all");

  // The form is an ordinary SPA GET form, not ImeSafeGetForm. Maintain the
  // composition marker that AutoSubmitSelect checks, including the commit-Enter tick.
  const compositionEndTimer = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (compositionEndTimer.current !== null) window.clearTimeout(compositionEndTimer.current);
  }, []);
  const clearCompositionTimer = (): void => {
    if (compositionEndTimer.current !== null) {
      window.clearTimeout(compositionEndTimer.current);
      compositionEndTimer.current = null;
    }
  };
  const beginComposition = (form: HTMLFormElement): void => {
    clearCompositionTimer();
    form.setAttribute(IME_COMPOSING_FORM_ATTR, "");
  };
  const finishComposition = (form: HTMLFormElement): void => {
    clearCompositionTimer();
    compositionEndTimer.current = window.setTimeout(() => {
      form.removeAttribute(IME_COMPOSING_FORM_ATTR);
      compositionEndTimer.current = null;
    }, 0);
  };
  // D-17-7: category changes must update React Router query state, not navigateGetForm's
  // document-level location.assign(). Preserve the same GET form field names/normalization.
  const submitFilters = (form: HTMLFormElement): void => {
    // Preserve AutoSubmitSelect: do not submit while a search input is in IME composition.
    if (isImeComposingForm(form)) return;
    const next = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (typeof value !== "string") continue;
      const normalized = value.trim();
      if (normalized) next.set(key, key === "q" ? truncateNotificationSearch(normalized) : normalized);
    }
    if (onSearch) {
      onSearch(next);
    } else {
      // Pure view fallback outside the SPA router.
      const query = next.toString();
      window.location.assign("/admin/notifications" + (query ? "?" + query : ""));
    }
  };

  return (
    <div>
      <ConsolePageHeader
        title="通知配信状況"
        description="notification_outbox の直近100件。管理者の再試行・強制再送・一括再試行はQueue wakeを送信せず、通常は毎時 Recovery Cron 等で処理されます。その他のQueue起動で早まる場合があります。失敗時は1/5/15分間隔で最大4回試行します。"
      />
      <p style={{ marginTop: 6, fontSize: 11 }}>
        <Link href="/admin/audit?table=notification_outbox&record=bulk_retry">
          直近の一括再試行履歴を見る →
        </Link>
      </p>

      {data.error ? null : unhealthyLeaseCount > 0 ? (
        <div role="status" className="fn-alert fn-alert--danger" style={{ marginTop: 14 }}>
          <strong>配送リース期限超過・欠損 {unhealthyLeaseCount} 件</strong>
          {" "}— 期限超過は毎時 Recovery Cron の回収対象です。欠損行または10分以上続く場合はWorkerとD1を確認してください。
        </div>
      ) : counts.failed > 0 || deadLetterCount > 0 ? (
        <div role="status" className="fn-alert fn-alert--danger" style={{ marginTop: 14 }}>
          <span>
            <strong>
              失敗 {counts.failed} 件
              {deadLetterCount > 0 ? ` / dead_letter ${deadLetterCount} 件` : ""}
            </strong>
            {" "}— 原因を確認し、必要な通知だけ再試行してください。
          </span>{" "}
          <NotificationActionButton kind="bulk-retry" api={api} onSuccess={onSuccess} />
        </div>
      ) : counts.pending > 0 ? (
        <div role="status" className="fn-alert fn-alert--warn" style={{ marginTop: 14 }}>
          配信待ち <strong>{counts.pending} 件</strong>（管理者操作はQueue wakeなし。毎時 Recovery Cron 等で処理）
        </div>
      ) : rows.length > 0 ? (
        <div role="status" className="fn-alert fn-alert--success" style={{ marginTop: 14 }}>
          現在、失敗・滞留はありません。
        </div>
      ) : null}

      <nav aria-label="ステータスフィルタ" style={{ marginTop: 16, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {STATUS_TABS.map(([key, label]) => (
          <Link
            key={key}
            href={notificationFilterHref({ status: key, ...filterInput })}
            className={`fn-btn fn-btn-sm ${status === key ? "fn-btn-primary" : "fn-btn-ghost"}`}
            aria-current={status === key ? "page" : undefined}
          >
            {label}
            {!data.error && (key === "pending" || key === "processing" || key === "failed")
              ? ` (${key === "failed" ? counts.failed + deadLetterCount : key === "pending" ? counts.pending : counts.processing})`
              : ""}
          </Link>
        ))}
      </nav>

      {/* URL navigation must remount uncontrolled filter fields in the persistent SPA view. */}
      <form
        key={notificationFilterHref(filters)}
        method="get"
        role="search"
        aria-label="通知の絞り込み"
        style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}
        onCompositionStart={(event) => beginComposition(event.currentTarget)}
        onCompositionEnd={(event) => finishComposition(event.currentTarget)}
        onKeyDown={(event) => {
          const form = event.currentTarget;
          if (event.nativeEvent.isComposing) {
            // IMEs may report key="Process" instead of Enter during conversion.
            // Only compositionend can schedule clearing an active session.
            if (!isImeComposingForm(form)) beginComposition(form);
          } else if (event.nativeEvent.keyCode === 229 && !isImeComposingForm(form)) {
            // Windows can report a commit key as Process/229 without compositionstart.
            // Retain the guard for an implicit submit in the same event loop tick.
            beginComposition(form);
            finishComposition(form);
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          submitFilters(event.currentTarget);
        }}
      >
        {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
        <select name="cat" defaultValue={filters.cat} className="fn-input fn-input-sm" aria-label="カテゴリ"
          onChange={(event) => { if (event.currentTarget.form) submitFilters(event.currentTarget.form); }}>
          {ADMIN_NOTIFICATION_CATEGORY_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>{option.label}</option>
          ))}
        </select>
        <input name="type" defaultValue={filters.type} placeholder="type 完全一致（例: x_id_approved）"
          aria-label="type 完全一致" className="fn-input fn-input-sm" style={{ minWidth: 220 }} />
        <input name="event" defaultValue={filters.event} placeholder="event_id 完全一致"
          aria-label="event_id 完全一致" className="fn-input fn-input-sm" style={{ minWidth: 200 }} />
        <input name="q" defaultValue={filters.q} placeholder="通知本文を検索" maxLength={100}
          aria-label="通知本文を検索" className="fn-input fn-input-sm" style={{ minWidth: 200 }} />
        {/* Three text inputs prevent reliable implicit Enter submission without a submit button. */}
        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm">検索</button>
        {hasDetailFilter ? (
          <Link
            href={notificationFilterHref({ status, type: "", event: "", q: "", cat: "all" })}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            詳細条件をクリア
          </Link>
        ) : null}
      </form>

      {data.error ? (
        <div role="alert" className="fn-alert fn-alert--danger" style={{ marginTop: 20 }}>
          エラー: 通知ログの取得に失敗しました（{data.error}）。{" "}
          <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" onClick={() => onSuccess()}>再試行</button>
        </div>
      ) : (
        <section style={{ marginTop: 18 }}>
          {rows.length === 0 ? (
            <EmptyState
              tone={status === "failed" ? "success" : "neutral"}
              title={status === "failed" ? "失敗通知はありません" : "通知ログはありません"}
              description={status === "failed" ? "現在、最終失敗状態の通知はありません。" : "現在の条件に一致する通知はありません。"}
              actions={[
                ...(status !== "all"
                  ? [{ href: "/admin/notifications", label: "フィルタを解除", variant: "ghost" as const }]
                  : []),
                { href: "/admin/notifications?status=failed", label: "最終失敗を見る", variant: "ghost" },
                { href: "/admin", label: "管理ダッシュボードへ", variant: "ghost" },
              ]}
            />
          ) : (
            <FnTable>
              <thead>
                <tr>
                  <th style={{ width: 92 }}>状態</th>
                  <th>通知</th>
                  <th style={{ width: 72 }}>試行</th>
                  <th style={{ width: 100 }}>次試行</th>
                  <th style={{ width: 100 }}>登録</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const terminalFailure = isTerminalNotificationFailure(row.status);
                  return (
                    <tr key={row.id}>
                      <td style={{ verticalAlign: "top" }}>
                        <span className={`fn-badge ${statusBadgeClass(row.status)}`} title={row.status ?? ""}>
                          {getNotificationStatusLabel(row.status)}
                        </span>
                        {row.event_id ? (
                          <div style={{ fontSize: 10, marginTop: 6, wordBreak: "break-all" }}>
                            <Link href={`/manage/events/${encodeURIComponent(row.event_id)}`}>
                              {row.event_id.slice(0, 10)}…
                            </Link>
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <NotificationOutboxSummary row={row} recipient={row.recipient} showTechnicalType />
                      </td>
                      <td style={{ fontVariantNumeric: "tabular-nums", verticalAlign: "top" }}>
                        {row.attempt_count ?? 0}
                      </td>
                      <td style={{ fontSize: 11, color: "var(--text-muted)", verticalAlign: "top" }}>
                        {row.next_attempt_at ? formatRelative(row.next_attempt_at) : "—"}
                      </td>
                      <td style={{ fontSize: 11, color: "var(--text-muted)", verticalAlign: "top" }}>
                        {formatRelative(row.created_at)}
                      </td>
                      <td style={{ verticalAlign: "top" }}>
                        <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                          <NotificationPayloadButton payload={row.payload_json} />
                          <span title="この通知の監査ログ">
                            <Link
                              href={`/admin/audit?table=notification_outbox&record=${encodeURIComponent(row.id)}`}
                              className="fn-btn fn-btn-ghost fn-btn-sm"
                              aria-label="この通知の監査ログ"
                            >
                              監査
                            </Link>
                          </span>
                          {terminalFailure ? (
                            <NotificationActionButton kind="retry" id={row.id} api={api} onSuccess={onSuccess} />
                          ) : null}
                          {row.status === "sent" || terminalFailure ? (
                            <NotificationActionButton kind="force-resend" id={row.id} api={api} onSuccess={onSuccess} />
                          ) : null}
                          {row.status === "pending" || row.status === "processing" || terminalFailure ? (
                            <NotificationCancelButton id={row.id} api={api} onSuccess={onSuccess} />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </FnTable>
          )}
        </section>
      )}
    </div>
  );
}

export function AdminNotifications({ api = defaultApi }: { api?: AdminNotificationsApi }): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const filters = readNotificationFilters(params);
  const [refresh, setRefresh] = React.useState(0);
  // The successful write's message must outlive the fail-closed reload below, which
  // unmounts the row buttons (CURRENT router.refresh() kept the client message).
  const [notice, setNotice] = React.useState<string | null>(null);
  // A failed admin refresh must not keep previously displayed notification payloads
  // or mutation buttons mounted while the new authoritative read is unavailable.
  const key = "admin-notifications:" + notificationFilterHref(filters) + ":refresh=" + refresh;
  const state = useApiResult((signal) => api.list(filters, signal), key);
  const redirect = state.status === "loading" ? null : adminReadRedirect(state);
  React.useEffect(() => {
    if (redirect) window.location.assign(redirect);
  }, [redirect]);

  if (state.status === "loading" || state.status === "anonymous" || state.status === "forbidden") {
    return <div role="status" aria-busy="true">読み込み中...</div>;
  }
  if (state.status !== "ok") {
    return (
      <div role="alert" className="fn-alert fn-alert--danger" style={{ marginTop: 20 }}>
        エラー: 通知ログを取得できません（{state.status}）。{" "}
        <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" onClick={() => setRefresh((v) => v + 1)}>再試行</button>
      </div>
    );
  }
  return (
    <>
      {notice ? <p role="status" style={{ marginTop: 12, fontSize: 12 }}>{notice}</p> : null}
      <AdminNotificationsView
        data={state.data}
        filters={filters}
        api={api}
        onSuccess={(message) => { setNotice(message ?? null); setRefresh((v) => v + 1); }}
        onSearch={(next) => { setNotice(null); setParams(next); }}
      />
    </>
  );
}
