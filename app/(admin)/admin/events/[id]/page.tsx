import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { desc, eq, sql } from "drizzle-orm";
import { withDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  slots as slotsTable,
  videos as videosTable,
  videoEvents,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import { collapseReservationGroups, type SlotBase } from "@/lib/utils/slotGrouping";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  isAcceptingEntries,
} from "@/lib/utils/eventStatus";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SaveEventTemplateForm } from "@/components/admin/SaveEventTemplateForm";

export const metadata: Metadata = { title: "イベント詳細" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminEventDetailPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;

  const bundle = await withDatabase(async (db) => {
    const event = (
      await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
    )[0];
    if (!event) return null;

    const slots = await db
      .select()
      .from(slotsTable)
      .where(eq(slotsTable.event_id, id))
      .orderBy(slotsTable.start_time, slotsTable.end_time, slotsTable.sort_order);

    const evVideos = await db
      .select({
        id: videosTable.id,
        title: videosTable.title,
        status: videosTable.visibility_status,
        display_name: sql<string>`COALESCE(${xUsersTable.x_name}, ${videosTable.creator_display_name}, ${videosTable.creator_x_user_id})`,
      })
      .from(videosTable)
      .innerJoin(videoEvents, eq(videosTable.id, videoEvents.video_id))
      .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_x_user_id))
      .where(eq(videoEvents.event_id, id))
      .orderBy(desc(videosTable.created_at))
      .limit(60);

    return { event, slots, evVideos };
  });

  if (!bundle) notFound();
  const { event, slots, evVideos } = bundle;
  const displaySlots = collapseReservationGroups(slots as SlotBase[]);
  const status = computeEventStatus(event);
  const accepting = isAcceptingEntries(event);

  // 集計サマリ
  const slotStats = {
    total: slots.length,
    available: slots.filter((s) => s.status === "available").length,
    reserved: slots.filter((s) => s.status === "reserved").length,
    submitted: slots.filter((s) => s.status === "submitted").length,
  };
  const videoStats = {
    total: evVideos.length,
    public: evVideos.filter((v) => v.status === "public").length,
    pending: evVideos.filter((v) => v.status === "pending").length,
    voided: evVideos.filter((v) => v.status === "voided").length,
  };

  return (
    <div>
      <AdminPageHeader
        title={event.title}
        description={`ID: ${event.id}`}
        backHref="/admin/events"
        backLabel="イベント一覧へ"
        actions={[
          {
            href: `/manage/events/${event.id}`,
            label: "運営ビュー",
            icon: <Icon name="users" size={12} aria-hidden />,
            variant: "primary",
          },
          {
            href: `/event/${event.id}`,
            label: "公開ページ",
            icon: <Icon name="external" size={12} aria-hidden />,
          },
          {
            href: `/admin/events/${event.id}/edit`,
            label: "設定編集",
            icon: <Icon name="edit" size={12} aria-hidden />,
          },
          {
            href: `/manage/events/${event.id}/slots`,
            label: "枠運営",
            icon: <Icon name="clock" size={12} aria-hidden />,
          },
          {
            href: `/manage/events/${event.id}/staff`,
            label: "イベント管理者",
            icon: <Icon name="users" size={12} aria-hidden />,
          },
          {
            href: `/admin/audit?table=events&record=${encodeURIComponent(event.id)}`,
            label: "監査ログ",
            icon: <Icon name="clock" size={12} aria-hidden />,
          },
        ]}
      />

      <section
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 8,
        }}
      >
        <StatBox label="枠合計" value={slotStats.total} />
        <StatBox label="空き枠" value={slotStats.available} />
        <StatBox label="確保済" value={slotStats.reserved} />
        <StatBox label="提出済" value={slotStats.submitted} />
        <StatBox label="作品" value={videoStats.total} />
        <StatBox label="公開済" value={videoStats.public} />
        <StatBox label="審査待ち" value={videoStats.pending} accent />
        <StatBox label="無効" value={videoStats.voided} />
      </section>

      <section
        className="fn-card"
        style={{ marginTop: 18, padding: "18px 22px" }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px" }}>
          テンプレート化
        </h2>
        <SaveEventTemplateForm eventId={event.id} eventTitle={event.title} />
      </section>

      <section className="fn-card" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span className={`fn-badge ${eventStatusBadgeClass(status)}`}>
            状態: {eventStatusLabel(status)}
          </span>
          <span className="fn-badge fn-badge-soft">
            受付: {event.is_entry_open === 1 ? "OPEN" : "CLOSED"}
          </span>
          {accepting ? (
            <span className="fn-badge fn-badge-accent">募集中</span>
          ) : null}
          <span className="fn-badge fn-badge-soft">タイプ: {event.event_type}</span>
        </div>
        <dl
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "6px 12px",
            fontSize: 13,
          }}
        >
          <dt className="fn-muted">期間</dt>
          <dd>
            {formatUnix(event.start_time, { dateOnly: true })}
            {event.end_time ? ` - ${formatUnix(event.end_time, { dateOnly: true })}` : ""}
          </dd>
          <dt className="fn-muted">説明</dt>
          <dd style={{ whiteSpace: "pre-wrap" }}>{event.explanation ?? "-"}</dd>
          <dt className="fn-muted">アクセントカラー</dt>
          <dd>{event.accent_color ?? "-"}</dd>
          <dt className="fn-muted">連続取得上限</dt>
          <dd>{event.max_consecutive_slots_per_entry}</dd>
        </dl>
      </section>

      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
          枠 ({displaySlots.length})
        </h2>
        {displaySlots.length === 0 ? (
          <p className="fn-muted fn-text-sm">枠はまだありません。</p>
        ) : (
          <FnTable>
            <thead>
              <tr>
                <th>日付</th>
                <th>時間</th>
                <th>取得者</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {displaySlots.map((s) => (
                <tr key={s.id}>
                  <td>{s.start_time ? formatUnix(s.start_time, { dateOnly: true }) : (s.slot_label ?? "-")}</td>
                  <td>
                    {s.start_time
                      ? `${formatUnix(s.start_time, { timeOnly: true })}${s.end_time ? ` - ${formatUnix(s.end_time, { timeOnly: true })}` : ""}`
                      : "-"}
                    {s.is_group ? (
                      <span className="fn-badge fn-badge-soft" style={{ marginLeft: 6 }}>
                        {s.group_size}連続
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {s.display_name || s.x_user_id ? (
                      <span>
                        <strong>{s.display_name ?? `@${s.x_user_id}`}</strong>
                        {s.x_user_id ? (
                          <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                            @{s.x_user_id}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td><span className="fn-badge fn-badge-soft">{s.status}</span></td>
                </tr>
              ))}
            </tbody>
          </FnTable>
        )}
      </section>

      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
          所属作品 ({evVideos.length})
        </h2>
        {evVideos.length === 0 ? (
          <p className="fn-muted fn-text-sm">作品はまだありません。</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
            {evVideos.map((v, index) => (
              <li
                key={`${v.id}-event-admin-video-${index}`}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  padding: "6px 0",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <span className="fn-badge fn-badge-soft">{v.status}</span>
                <Link href={`/admin/videos/${v.id}`} style={{ flex: 1, color: "var(--text-primary)" }}>
                  {v.title}
                </Link>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {v.display_name}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

    </div>
  );
}

function StatBox({
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
      style={{ padding: "10px 14px" }}
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
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
