import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import {
  events as eventsTable,
  slots as slotsTable,
  videos as videosTable,
  videoEvents as videoEventsTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCollaboratorPermissions } from "@/lib/auth/ownership";
import { ManageEventPageShell } from "@/components/manage/ManageEventPageShell";
import { manageEventAccentStyle } from "@/lib/utils/eventAccent";
import { getEventPendingReviewVideoCount } from "@/lib/manage/pendingReviewVideos";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) return { title: `登録者プレビュー (${id})` };
  const ev = (
    await db
      .select({ title: eventsTable.title })
      .from(eventsTable)
      .where(eq(eventsTable.id, id))
      .limit(1)
  )[0];
  return {
    title: ev?.title ? `${ev.title} 登録者プレビュー` : "登録者プレビュー",
  };
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

  const isAdmin = user.role === "admin";
  const permissions = isAdmin
    ? new Set<string>()
    : await getCollaboratorPermissions(db, user.id, id);
  if (!isAdmin && permissions.size === 0) notFound();

  const slotAudienceXId = sql<string>`COALESCE(${slotsTable.reserved_x_id_snapshot}, ${slotsTable.x_user_id})`;

  const slotXIds = await db
    .select({
      x_user_id: slotAudienceXId,
      x_name: xUsersTable.x_name,
      icon_url: xUsersTable.icon_url,
      slot_count: sql<number>`COUNT(*)`,
      submitted_count: sql<number>`SUM(CASE WHEN ${slotsTable.status} = 'submitted' THEN 1 ELSE 0 END)`,
    })
    .from(slotsTable)
    .leftJoin(xUsersTable, eq(xUsersTable.id, slotAudienceXId))
    .where(
      and(
        eq(slotsTable.event_id, id),
        or(
          isNotNull(slotsTable.x_user_id),
          isNotNull(slotsTable.reserved_x_id_snapshot),
        ),
        sql`TRIM(COALESCE(${slotsTable.reserved_x_id_snapshot}, ${slotsTable.x_user_id}, '')) != ''`,
      )!,
    )
    .groupBy(slotAudienceXId);

  const submitters = await db
    .select({
      x_user_id: videosTable.creator_x_user_id,
      x_name: xUsersTable.x_name,
      icon_url: xUsersTable.icon_url,
      video_count: sql<number>`COUNT(*)`,
    })
    .from(videosTable)
    .innerJoin(videoEventsTable, eq(videoEventsTable.video_id, videosTable.id))
    .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_x_user_id))
    .where(
      and(
        eq(videoEventsTable.event_id, id),
        isNotNull(videosTable.creator_x_user_id),
      )!,
    )
    .groupBy(videosTable.creator_x_user_id);

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
    if (b.submitted_count !== a.submitted_count) {
      return b.submitted_count - a.submitted_count;
    }
    if (b.video_count !== a.video_count) return b.video_count - a.video_count;
    return b.slot_count - a.slot_count;
  });
  const pendingCount = await getEventPendingReviewVideoCount(id);

  return (
    <ManageEventPageShell
      eventId={id}
      title={ev.title}
      description={`登録者プレビュー — ${audience.length} 名（読み取り専用）`}
      backHref={`/manage/events/${id}`}
      backLabel="イベント概要へ"
      isAdmin={isAdmin}
      pendingCount={pendingCount}
      accentStyle={manageEventAccentStyle(ev.accent_color)}
    >
      {audience.length === 0 ? (
        <EmptyState
          tone="neutral"
          title="登録者はまだいません"
          description="このイベントで枠を確保した、または作品を提出した X ID がここに表示されます。"
          actions={[
            { href: `/event/${id}`, label: "公開ページを見る", variant: "primary" },
            {
              href: `/manage/events/${id}`,
              label: "イベント概要へ",
              variant: "ghost",
            },
          ]}
        />
      ) : (
        <FnTable className="manage-audience-table">
          <thead>
            <tr>
              <th>参加者</th>
              <th>確保枠</th>
              <th>提出済</th>
              <th>動画</th>
            </tr>
          </thead>
          <tbody>
            {audience.map((a, index) => (
              <tr key={`${a.x_user_id}-audience-${index}`}>
                <td>
                  <div className="manage-audience-identity">
                    {a.icon_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={a.icon_url}
                        alt=""
                        className="manage-audience-avatar"
                        width={32}
                        height={32}
                      />
                    ) : (
                      <span className="manage-audience-avatar manage-audience-avatar-fallback">
                        <Icon name="user" size={13} aria-hidden />
                      </span>
                    )}
                    <div className="manage-audience-identity-text">
                      <Link href={`/user/${a.x_user_id}`} className="manage-audience-name">
                        {a.x_name ?? a.x_user_id}
                      </Link>
                      <span className="manage-audience-xid">@{a.x_user_id}</span>
                    </div>
                  </div>
                </td>
                <td className="fn-td-tabular">{a.slot_count}</td>
                <td className="fn-td-tabular">
                  {a.submitted_count > 0 ? (
                    <strong>{a.submitted_count}</strong>
                  ) : (
                    a.submitted_count
                  )}
                </td>
                <td className="fn-td-tabular">{a.video_count}</td>
              </tr>
            ))}
          </tbody>
        </FnTable>
      )}
    </ManageEventPageShell>
  );
}
