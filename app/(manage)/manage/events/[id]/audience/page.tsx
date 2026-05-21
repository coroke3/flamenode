import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import {
  events as eventsTable,
  eventEditors as eventEditorsTable,
  slots as slotsTable,
  videos as videosTable,
  videoEvents as videoEventsTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `登録者プレビュー (${id})` };
}

export default async function ManageEventAudiencePage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const guard = await requireSession({
    next: `/manage/events/${encodeURIComponent(id)}/audience`,
  });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  if (!db) notFound();

  const ev = (
    await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
  )[0];
  if (!ev) notFound();

  const activeX = user.active_x_user_id;
  const isAdmin = user.role === "admin";
  if (activeX) {
    const editor = (
      await db
        .select()
        .from(eventEditorsTable)
        .where(
          and(
            eq(eventEditorsTable.event_id, id),
            eq(eventEditorsTable.x_user_id, activeX),
          )!,
        )
        .limit(1)
    )[0];
    if (!editor && !isAdmin) notFound();
  } else if (!isAdmin) {
    notFound();
  }

  // slot を確保した X ID (distinct)
  const slotXIds = await db
    .select({
      x_user_id: slotsTable.x_user_id,
      x_name: xUsersTable.x_name,
      icon_url: xUsersTable.icon_url,
      slot_count: sql<number>`COUNT(*)`,
      submitted_count: sql<number>`SUM(CASE WHEN ${slotsTable.status} = 'submitted' THEN 1 ELSE 0 END)`,
    })
    .from(slotsTable)
    .leftJoin(xUsersTable, eq(xUsersTable.id, slotsTable.x_user_id))
    .where(
      and(
        eq(slotsTable.event_id, id),
        isNotNull(slotsTable.x_user_id),
      )!,
    )
    .groupBy(slotsTable.x_user_id);

  // 動画提出者 (slot 経由ではない creator も拾う)
  const submitters = await db
    .select({
      x_user_id: videosTable.creator_id,
      x_name: xUsersTable.x_name,
      icon_url: xUsersTable.icon_url,
      video_count: sql<number>`COUNT(*)`,
    })
    .from(videosTable)
    .innerJoin(videoEventsTable, eq(videoEventsTable.video_id, videosTable.id))
    .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_id))
    .where(
      and(
        eq(videoEventsTable.event_id, id),
        isNotNull(videosTable.creator_id),
      )!,
    )
    .groupBy(videosTable.creator_id);

  // X ID 単位で merge して 1 行 / unique にする
  const audienceMap = new Map<
    string,
    {
      x_user_id: string;
      x_name: string | null;
      icon_url: string | null;
      slot_count: number;
      submitted_count: number;
      video_count: number;
    }
  >();
  for (const s of slotXIds) {
    if (!s.x_user_id) continue;
    audienceMap.set(s.x_user_id, {
      x_user_id: s.x_user_id,
      x_name: s.x_name,
      icon_url: s.icon_url,
      slot_count: Number(s.slot_count ?? 0),
      submitted_count: Number(s.submitted_count ?? 0),
      video_count: 0,
    });
  }
  for (const v of submitters) {
    if (!v.x_user_id) continue;
    const existing = audienceMap.get(v.x_user_id);
    if (existing) {
      existing.video_count = Number(v.video_count ?? 0);
      if (!existing.x_name && v.x_name) existing.x_name = v.x_name;
      if (!existing.icon_url && v.icon_url) existing.icon_url = v.icon_url;
    } else {
      audienceMap.set(v.x_user_id, {
        x_user_id: v.x_user_id,
        x_name: v.x_name,
        icon_url: v.icon_url,
        slot_count: 0,
        submitted_count: 0,
        video_count: Number(v.video_count ?? 0),
      });
    }
  }

  const audience = Array.from(audienceMap.values()).sort((a, b) => {
    // submitted_count → video_count → slot_count の順で降順
    if (b.submitted_count !== a.submitted_count) {
      return b.submitted_count - a.submitted_count;
    }
    if (b.video_count !== a.video_count) return b.video_count - a.video_count;
    return b.slot_count - a.slot_count;
  });

  return (
    <div>
      <p style={{ marginBottom: 8, fontSize: 12 }}>
        <Link href={`/manage/events/${id}`}>← イベント運営トップへ</Link>
      </p>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>
        登録者プレビュー: {ev.title}
      </h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>
        {audience.length} 名の参加者 (slot 確保 / 動画提出のいずれかを行った X ID を集約)。読み取り専用。
      </p>

      {audience.length === 0 ? (
        <p className="fn-muted fn-text-sm" style={{ marginTop: 16 }}>
          <Icon name="info" size={12} aria-hidden /> 参加者はまだいません。
        </p>
      ) : (
        <table className="fn-table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>X ID / 名前</th>
              <th>確保枠</th>
              <th>提出済</th>
              <th>動画</th>
            </tr>
          </thead>
          <tbody>
            {audience.map((a, index) => (
              <tr key={`${a.x_user_id}-audience-${index}`}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {a.icon_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={a.icon_url}
                        alt=""
                        width={28}
                        height={28}
                        style={{ borderRadius: 999, objectFit: "cover" }}
                      />
                    ) : (
                      <span
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 999,
                          display: "grid",
                          placeItems: "center",
                          background: "var(--bg-elevated)",
                          color: "var(--text-muted)",
                        }}
                      >
                        <Icon name="user" size={13} aria-hidden />
                      </span>
                    )}
                    <div>
                      <Link
                        href={`/user/${a.x_user_id}`}
                        style={{ fontWeight: 600 }}
                      >
                        {a.x_name ?? a.x_user_id}
                      </Link>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                        @{a.x_user_id}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{a.slot_count}</td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>
                  {a.submitted_count > 0 ? (
                    <strong>{a.submitted_count}</strong>
                  ) : (
                    a.submitted_count
                  )}
                </td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{a.video_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
