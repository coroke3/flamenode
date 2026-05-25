import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import {
  events as eventsTable,
  eventStaff as eventStaffTable,
  eventStaffPermissions as eventStaffPermissionsTable,
  historyLogs as historyLogsTable,
  notificationOutbox as notificationOutboxTable,
  slots as slotsTable,
  videos as videosTable,
  videoEvents as videoEventsTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  isAcceptingEntries,
} from "@/lib/utils/eventStatus";
import { formatUnix, formatRelative } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ notif?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) return { title: id };
  try {
    const ev = await db
      .select({ title: eventsTable.title })
      .from(eventsTable)
      .where(eq(eventsTable.id, id))
      .limit(1);
    return ev[0]?.title
      ? { title: `${ev[0].title} 運営` }
      : { title: "イベント運営" };
  } catch {
    // Miniflare D1 が稀に transient エラーを返すため metadata で 500 を出さない
    return { title: id };
  }
}

type NotifCategory = "all" | "video" | "x_id" | "slot" | "chapter" | "system";

/** type 文字列をカテゴリへ分類する。enqueueNotification で使う type に合わせる。 */
function categorizeNotificationType(type: string): NotifCategory {
  if (type.startsWith("video_")) return "video";
  if (type.startsWith("x_id_")) return "x_id";
  if (type.startsWith("slot_")) return "slot";
  if (type.startsWith("chapter_")) return "chapter";
  return "system";
}

export default async function ManageEventPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const notifCategory: NotifCategory =
    sp.notif === "video" ||
    sp.notif === "x_id" ||
    sp.notif === "slot" ||
    sp.notif === "chapter" ||
    sp.notif === "system"
      ? sp.notif
      : "all";
  const guard = await requireSession({
    next: `/manage/events/${encodeURIComponent(id)}`,
  });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  if (!db) notFound();

  const ev = (
    await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
  )[0];
  if (!ev) notFound();

  // 運営者チェック
  const activeX = user.active_x_user_id;
  const isAdmin = user.role === "admin";
  let editorRole: "representative" | "editor" | null = null;
  if (!isAdmin) {
    const subjectCondition = activeX
      ? or(
          eq(eventStaffTable.x_user_id, activeX),
          eq(eventStaffTable.discord_user_id, user.id),
        )!
      : eq(eventStaffTable.discord_user_id, user.id);
    const staff = (
      await db
        .select({ role: eventStaffTable.role })
        .from(eventStaffTable)
        .innerJoin(
          eventStaffPermissionsTable,
          eq(eventStaffPermissionsTable.event_staff_id, eventStaffTable.id),
        )
        .where(
          and(
            eq(eventStaffTable.event_id, id),
            eq(eventStaffPermissionsTable.allowed, 1),
            subjectCondition,
          )!,
        )
        .limit(1)
    )[0];
    if (staff) {
      editorRole =
        staff.role === "representative" ? "representative" : "editor";
    }
  }
  if (!editorRole && !isAdmin) notFound();

  // 集計
  const [pendingCount, publicCount, slotCounts] = await Promise.all([
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videosTable)
      .innerJoin(videoEventsTable, eq(videoEventsTable.video_id, videosTable.id))
      .where(
        and(
          eq(videoEventsTable.event_id, id),
          eq(videosTable.visibility_status, "pending"),
        )!,
      ),
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videosTable)
      .innerJoin(videoEventsTable, eq(videoEventsTable.video_id, videosTable.id))
      .where(
        and(
          eq(videoEventsTable.event_id, id),
          eq(videosTable.visibility_status, "public"),
        )!,
      ),
    db
      .select({
        status: slotsTable.status,
        c: sql<number>`COUNT(*)`,
      })
      .from(slotsTable)
      .where(eq(slotsTable.event_id, id))
      .groupBy(slotsTable.status),
  ]);

  const slotStatusMap: Record<string, number> = {};
  for (const r of slotCounts) {
    slotStatusMap[r.status] = Number(r.c ?? 0);
  }
  const totalSlots = Object.values(slotStatusMap).reduce((a, b) => a + b, 0);
  const availableSlots = slotStatusMap.available ?? 0;
  const reservedSlots = slotStatusMap.reserved ?? 0;
  const submittedSlots = slotStatusMap.submitted ?? 0;

  // 直近の審査待ち作品
  const pendingVideos = await db
    .select({
      id: videosTable.id,
      title: videosTable.title,
      display_name: sql<string>`COALESCE(${xUsersTable.x_name}, ${videosTable.creator_display_name}, ${videosTable.creator_x_user_id})`,
      created_at: videosTable.created_at,
    })
    .from(videosTable)
    .innerJoin(videoEventsTable, eq(videoEventsTable.video_id, videosTable.id))
    .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_x_user_id))
    .where(
      and(
        eq(videoEventsTable.event_id, id),
        eq(videosTable.visibility_status, "pending"),
      )!,
    )
    .orderBy(desc(videosTable.created_at))
    .limit(10);

  // 当該イベントの直近 history_logs (events / video_events / slots すべて)
  const historyEv = await db
    .select()
    .from(historyLogsTable)
    .where(
      and(
        eq(historyLogsTable.table_name, "events"),
        eq(historyLogsTable.record_id, id),
      )!,
    )
    .orderBy(desc(historyLogsTable.created_at))
    .limit(15);

  // event-scoped 通知: カテゴリ別件数は DB の GROUP BY で集計し、
  // 一覧は対象カテゴリだけ where 句で絞り込んで取得する (クライアントフィルタを廃止)。
  const categoryWhere = (cat: NotifCategory) => {
    if (cat === "all") return eq(notificationOutboxTable.event_id, id);
    if (cat === "system") {
      // video_/x_id_/slot_/chapter_ 以外
      return and(
        eq(notificationOutboxTable.event_id, id),
        sql`${notificationOutboxTable.type} NOT LIKE 'video_%'`,
        sql`${notificationOutboxTable.type} NOT LIKE 'x_id_%'`,
        sql`${notificationOutboxTable.type} NOT LIKE 'slot_%'`,
        sql`${notificationOutboxTable.type} NOT LIKE 'chapter_%'`,
      )!;
    }
    const prefix =
      cat === "video"
        ? "video_%"
        : cat === "x_id"
          ? "x_id_%"
          : cat === "slot"
            ? "slot_%"
            : "chapter_%";
    return and(
      eq(notificationOutboxTable.event_id, id),
      like(notificationOutboxTable.type, prefix),
    )!;
  };

  const notifCounts: Record<NotifCategory, number> = {
    all: 0,
    video: 0,
    x_id: 0,
    slot: 0,
    chapter: 0,
    system: 0,
  };
  let eventNotifications: (typeof notificationOutboxTable.$inferSelect)[] = [];
  let eventNotificationSchemaMissing = false;
  try {
    // カテゴリ別件数集計 (GROUP BY で 1 クエリ)
    const typeCountRows = await db
      .select({
        type: notificationOutboxTable.type,
        c: sql<number>`COUNT(*)`,
      })
      .from(notificationOutboxTable)
      .where(eq(notificationOutboxTable.event_id, id))
      .groupBy(notificationOutboxTable.type);
    for (const r of typeCountRows) {
      const c = Number(r.c ?? 0);
      notifCounts.all += c;
      notifCounts[categorizeNotificationType(r.type)] += c;
    }

    eventNotifications = await db
      .select()
      .from(notificationOutboxTable)
      .where(categoryWhere(notifCategory))
      .orderBy(desc(notificationOutboxTable.created_at))
      .limit(20);
  } catch (e) {
    eventNotificationSchemaMissing = true;
    console.warn("[ManageEventPage] notification_outbox.event_id unavailable", e);
  }

  // UI 互換用 (allEventNotifications がフィルタ UI の表示判定に使われていた)
  const allEventNotifications =
    !eventNotificationSchemaMissing && notifCounts.all > 0
      ? eventNotifications
      : [];

  const status = computeEventStatus(ev);
  const accepting = isAcceptingEntries(ev);

  return (
    <div>
      <p style={{ marginBottom: 8, fontSize: 12 }}>
        <Link href="/manage">← 担当イベント一覧へ</Link>
      </p>
      <header style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>{ev.title}</h1>
          <span className={`fn-badge ${eventStatusBadgeClass(status)}`}>
            {eventStatusLabel(status)}
          </span>
          {accepting ? (
            <span className="fn-badge fn-badge-soft">受付中</span>
          ) : null}
          <span className="fn-badge fn-badge-soft">
            {editorRole === "representative"
              ? "代表"
              : editorRole === "editor"
                ? "運営"
                : "管理者"}
          </span>
        </div>
        <p style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
          {ev.start_time ? formatUnix(ev.start_time, { dateOnly: true }) : "—"}
          {ev.end_time
            ? ` 〜 ${formatUnix(ev.end_time, { dateOnly: true })}`
            : ""}
          {ev.entry_start_time != null || ev.entry_end_time != null ? (
            <span style={{ marginLeft: 8 }}>
              · 募集{" "}
              {ev.entry_start_time != null
                ? formatUnix(ev.entry_start_time)
                : "—"}
              {" 〜 "}
              {ev.entry_end_time != null ? formatUnix(ev.entry_end_time) : "—"}
            </span>
          ) : null}
        </p>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
        }}
      >
        <Stat label="審査待ち" value={Number(pendingCount[0]?.c ?? 0)} accent />
        <Stat label="公開済み" value={Number(publicCount[0]?.c ?? 0)} />
        <Stat label="枠合計" value={totalSlots} />
        <Stat label="空き枠" value={availableSlots} />
        <Stat label="確保済" value={reservedSlots} />
        <Stat label="提出済" value={submittedSlots} />
      </section>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        <Link
          href={`/admin/videos?event=${encodeURIComponent(id)}&status=pending`}
          className="fn-btn fn-btn-primary fn-btn-sm"
        >
          <Icon name="check" size={11} aria-hidden /> 審査キューを開く
        </Link>
        <Link
          href={`/manage/events/${id}/slots`}
          className="fn-btn fn-btn-ghost fn-btn-sm"
        >
          <Icon name="calendar" size={11} aria-hidden /> スロット一覧
        </Link>
        <Link
          href={`/manage/events/${id}/staff`}
          className="fn-btn fn-btn-ghost fn-btn-sm"
        >
          <Icon name="users" size={11} aria-hidden /> 運営メンバー
        </Link>
        <Link
          href={`/manage/events/${id}/audience`}
          className="fn-btn fn-btn-ghost fn-btn-sm"
        >
          <Icon name="user" size={11} aria-hidden /> 登録者プレビュー
        </Link>
        <Link
          href={`/event/${id}`}
          className="fn-btn fn-btn-ghost fn-btn-sm"
        >
          公開ページを見る
        </Link>
        {isAdmin ? (
          <>
            <Link
              href={`/admin/events/${id}`}
              className="fn-btn fn-btn-ghost fn-btn-sm"
            >
              <Icon name="settings" size={11} aria-hidden /> 管理者編集
            </Link>
            <Link
              href={`/admin/notifications?event=${encodeURIComponent(id)}`}
              className="fn-btn fn-btn-ghost fn-btn-sm"
            >
              <Icon name="alert" size={11} aria-hidden /> 通知ログ
            </Link>
          </>
        ) : null}
      </div>

      {eventNotificationSchemaMissing ? (
        <div
          role="status"
          style={{
            marginTop: 18,
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
          直近の審査待ち作品
        </h2>
        {pendingVideos.length === 0 ? (
          <p className="fn-muted fn-text-sm">
            <Icon name="check" size={12} aria-hidden /> 審査待ちはありません。
          </p>
        ) : (
          <table className="fn-table">
            <thead>
              <tr>
                <th>タイトル</th>
                <th>作者</th>
                <th>登録</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pendingVideos.map((v, index) => (
                <tr key={`${v.id}-pending-${index}`}>
                  <td>{v.title}</td>
                  <td>{v.display_name}</td>
                  <td className="fn-muted">{formatRelative(v.created_at)}</td>
                  <td>
                    <Link
                      href={`/admin/videos/${v.id}`}
                      className="fn-btn fn-btn-primary fn-btn-sm"
                    >
                      審査
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {allEventNotifications.length > 0 ? (
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
            イベント通知 (notification_outbox)
          </h2>
          <nav
            aria-label="通知カテゴリフィルタ"
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              marginBottom: 10,
            }}
          >
            {(
              [
                ["all", "すべて"],
                ["video", "動画"],
                ["x_id", "X ID"],
                ["slot", "スロット"],
                ["chapter", "チャプター"],
                ["system", "その他"],
              ] as const
            ).map(([key, label]) => {
              const href =
                key === "all"
                  ? `/manage/events/${id}`
                  : `/manage/events/${id}?notif=${key}`;
              return (
                <Link
                  key={key}
                  href={href}
                  className={`fn-btn fn-btn-sm ${notifCategory === key ? "fn-btn-primary" : "fn-btn-ghost"}`}
                >
                  {label} ({notifCounts[key]})
                </Link>
              );
            })}
          </nav>
          {eventNotifications.length === 0 ? (
            <p className="fn-muted fn-text-sm">該当する通知はありません。</p>
          ) : null}
          <table className="fn-table">
            <thead>
              <tr>
                <th>日時</th>
                <th>type</th>
                <th>状態</th>
                <th>試行</th>
              </tr>
            </thead>
            <tbody>
              {eventNotifications.map((n) => (
                <tr key={n.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <div>{formatUnix(n.created_at)}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {formatRelative(n.created_at)}
                    </div>
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
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>
                    {n.attempt_count ?? 0}
                  </td>
                </tr>
              ))}
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
          イベント更新履歴
        </h2>
        {historyEv.length === 0 ? (
          <p className="fn-muted fn-text-sm">直近の更新はありません。</p>
        ) : (
          <table className="fn-table">
            <thead>
              <tr>
                <th>日時</th>
                <th>操作</th>
                <th>実行者</th>
              </tr>
            </thead>
            <tbody>
              {historyEv.map((h) => (
                <tr key={h.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <div>{formatUnix(h.created_at)}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {formatRelative(h.created_at)}
                    </div>
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
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}): React.ReactElement {
  return (
    <div
      className={`fn-card ${accent && value > 0 ? "fn-card-accent" : ""}`}
      style={{ padding: "12px 14px" }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.16em",
          color: "var(--text-muted)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
