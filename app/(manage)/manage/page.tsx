import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import {
  events as eventsTable,
  eventEditors as eventEditorsTable,
  historyLogs as historyLogsTable,
  notificationOutbox as notificationOutboxTable,
  videos as videosTable,
  videoEvents as videoEventsTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
} from "@/lib/utils/eventStatus";
import { formatUnix, formatRelative } from "@/lib/utils/format";

export const metadata: Metadata = { title: "イベント運営" };
export const dynamic = "force-dynamic";

export default async function ManageTopPage(): Promise<React.ReactElement> {
  const guard = await requireSession();
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  if (!db) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>イベント運営</h1>
        <p className="fn-muted fn-text-sm" style={{ marginTop: 8 }}>
          DB に接続できませんでした。
        </p>
      </div>
    );
  }

  const activeX = user.active_x_user_id;

  // event_editors を活性 X ID で参照。X ID 未選択時は空配列を返す。
  // ただし管理者は全イベントを操作可なので、active X が無くても見える状態にする。
  const myEditorRows = activeX
    ? await db
        .select({
          event_id: eventEditorsTable.event_id,
          role: eventEditorsTable.role,
          approved_at: eventEditorsTable.approved_at,
        })
        .from(eventEditorsTable)
        .where(eq(eventEditorsTable.x_user_id, activeX))
    : [];

  const eventIds = myEditorRows.map((r) => r.event_id);
  const isAdmin = user.role === "admin";

  const eventRows = eventIds.length > 0
    ? await db
        .select()
        .from(eventsTable)
        .where(inArray(eventsTable.id, eventIds))
    : [];

  // 各イベントごとの審査待ち件数
  const pendingByEvent = new Map<string, number>();
  if (eventIds.length > 0) {
    const rows = await db
      .select({
        event_id: videoEventsTable.event_id,
        c: sql<number>`COUNT(*)`,
      })
      .from(videosTable)
      .innerJoin(
        videoEventsTable,
        eq(videoEventsTable.video_id, videosTable.id),
      )
      .where(
        and(
          inArray(videoEventsTable.event_id, eventIds),
          eq(videosTable.status, "pending"),
        )!,
      )
      .groupBy(videoEventsTable.event_id);
    for (const r of rows) {
      pendingByEvent.set(r.event_id, Number(r.c ?? 0));
    }
  }

  // 担当イベント関連の history_logs を直近で取得 (event_id を record_id として参照する記録)
  const recentInbox = eventIds.length > 0
    ? await db
        .select()
        .from(historyLogsTable)
        .where(
          and(
            eq(historyLogsTable.table_name, "events"),
            inArray(historyLogsTable.record_id, eventIds),
          )!,
        )
        .orderBy(desc(historyLogsTable.created_at))
        .limit(20)
    : [];

  // event-scoped 通知 (notification_outbox.event_id が担当イベントに該当するもの)
  // 古いローカル D1 では event_id migration 未適用のことがあるため、ページ全体は落とさない。
  let eventNotifications: (typeof notificationOutboxTable.$inferSelect)[] = [];
  let eventNotificationSchemaMissing = false;
  if (eventIds.length > 0) {
    try {
      eventNotifications = await db
        .select()
        .from(notificationOutboxTable)
        .where(inArray(notificationOutboxTable.event_id, eventIds))
        .orderBy(desc(notificationOutboxTable.created_at))
        .limit(20);
    } catch (e) {
      eventNotificationSchemaMissing = true;
      console.warn("[ManageTopPage] notification_outbox.event_id unavailable", e);
    }
  }

  // failed 件数集計 (担当イベント分のみ)
  const failedCount = eventNotifications.filter((n) => n.status === "failed").length;

  if (myEditorRows.length === 0) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>イベント運営</h1>
        <p className="fn-muted fn-text-sm" style={{ marginTop: 8 }}>
          現在、あなたが運営者として登録されているイベントはありません。
        </p>
        {isAdmin ? (
          <p style={{ marginTop: 16, fontSize: 13 }}>
            管理者の方は <Link href="/admin/events">イベント管理</Link> から、
            運営者として割り当てるイベントを作成できます。
          </p>
        ) : (
          <p style={{ marginTop: 16, fontSize: 13 }}>
            イベント主催者にあなたの X ID を登録してもらうと、このページから運営できるようになります。
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>イベント運営</h1>
        <p className="fn-muted fn-text-sm" style={{ marginTop: 4 }}>
          あなたが担当するイベントの状態・審査待ち・関連履歴を表示します。
        </p>
      </header>

      {failedCount > 0 ? (
        <div
          role="status"
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            background: "var(--accent-danger-soft, #fee2e2)",
            border: "1px solid var(--accent-danger, #dc2626)",
            borderRadius: "var(--radius-md)",
            color: "var(--accent-danger, #991b1b)",
            fontSize: 13,
          }}
        >
          <strong>担当イベントに失敗通知が {failedCount} 件</strong>
          {" "}あります。下の「イベント通知」セクションを確認してください。
        </div>
      ) : null}

      {eventNotificationSchemaMissing ? (
        <div
          role="status"
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            background: "var(--accent-warning-soft, #fef3c7)",
            border: "1px solid var(--accent-warning, #d97706)",
            borderRadius: "var(--radius-md)",
            color: "var(--text-primary)",
            fontSize: 13,
          }}
        >
          イベント通知の絞り込みに必要な DB migration が未適用です。
          ローカルでは `npm.cmd run db:local-apply` を実行してください。
        </div>
      ) : null}

      <section style={{ marginTop: 16 }}>
        <h2
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.18em",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          担当イベント
        </h2>
        <div style={{ display: "grid", gap: 10 }}>
          {eventRows.map((ev) => {
            const status = computeEventStatus(ev);
            const pending = pendingByEvent.get(ev.id) ?? 0;
            const editor = myEditorRows.find((r) => r.event_id === ev.id);
            return (
              <article
                key={ev.id}
                style={{
                  padding: "14px 18px",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <Link
                      href={`/manage/events/${ev.id}`}
                      style={{ fontWeight: 700 }}
                    >
                      {ev.title}
                    </Link>
                    <span className={`fn-badge ${eventStatusBadgeClass(status)}`}>
                      {eventStatusLabel(status)}
                    </span>
                    <span className="fn-badge fn-badge-soft">
                      {editor?.role === "representative" ? "代表" : "運営"}
                    </span>
                    {pending > 0 ? (
                      <span className="fn-badge fn-badge-warning">
                        審査待ち {pending}
                      </span>
                    ) : null}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      color: "var(--text-muted)",
                    }}
                  >
                    {ev.start_time ? formatUnix(ev.start_time, { dateOnly: true }) : "—"}
                    {ev.end_time
                      ? ` 〜 ${formatUnix(ev.end_time, { dateOnly: true })}`
                      : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {isAdmin ? (
                    <Link
                      href={`/admin/events/${ev.id}`}
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                    >
                      <Icon name="settings" size={11} aria-hidden /> 編集
                    </Link>
                  ) : null}
                  <Link
                    href={`/admin/videos?event=${encodeURIComponent(ev.id)}&status=pending`}
                    className="fn-btn fn-btn-primary fn-btn-sm"
                  >
                    <Icon name="check" size={11} aria-hidden /> 審査キュー
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {eventNotifications.length > 0 ? (
        <section style={{ marginTop: 28 }}>
          <h2
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.18em",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            イベント通知
          </h2>
          <table className="fn-table">
            <thead>
              <tr>
                <th>日時</th>
                <th>イベント</th>
                <th>type</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {eventNotifications.map((n) => {
                const ev = eventRows.find((e) => e.id === n.event_id);
                return (
                  <tr key={n.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div>{formatUnix(n.created_at)}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {formatRelative(n.created_at)}
                      </div>
                    </td>
                    <td>
                      {ev ? (
                        <Link href={`/manage/events/${ev.id}`}>{ev.title}</Link>
                      ) : (
                        <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                          {n.event_id ?? "—"}
                        </span>
                      )}
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                      {n.type}
                    </td>
                    <td>
                      <span
                        className={`fn-badge ${
                          n.status === "sent"
                            ? "fn-badge-accent"
                            : n.status === "failed"
                              ? "fn-badge-danger"
                              : "fn-badge-soft"
                        }`}
                      >
                        {n.status ?? "?"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}

      <section style={{ marginTop: 28 }}>
        <h2
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.18em",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          受信箱 (担当イベント関連の更新履歴)
        </h2>
        {recentInbox.length === 0 ? (
          <p className="fn-muted fn-text-sm">
            <Icon name="check" size={12} aria-hidden /> 直近の更新はありません。
          </p>
        ) : (
          <table className="fn-table">
            <thead>
              <tr>
                <th>日時</th>
                <th>イベント</th>
                <th>操作</th>
                <th>実行者</th>
              </tr>
            </thead>
            <tbody>
              {recentInbox.map((h) => {
                const ev = eventRows.find((e) => e.id === h.record_id);
                return (
                  <tr key={h.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div>{formatUnix(h.created_at)}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {formatRelative(h.created_at)}
                      </div>
                    </td>
                    <td>
                      {ev ? (
                        <Link href={`/event/${ev.id}`}>{ev.title}</Link>
                      ) : (
                        <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                          {h.record_id}
                        </span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`fn-badge ${
                          h.action === "DELETE"
                            ? "fn-badge-danger"
                            : h.action === "CREATE"
                              ? "fn-badge-accent"
                              : "fn-badge-soft"
                        }`}
                      >
                        {h.action}
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                      {h.operator_discord_id ?? "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
