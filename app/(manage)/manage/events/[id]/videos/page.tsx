import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq, inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import {
  canAccessManageEventFromSnapshot,
  canEditEventFromSnapshot,
  getManageAuthorizationSnapshot,
} from "@/lib/auth/manageAuthorization";
import {
  events as eventsTable,
  videos as videosTable,
  videoEvents as videoEventsTable,
} from "@/lib/db/schema";
import { EmptyState } from "@/components/ui/EmptyState";
import { ManageEventPageShell } from "@/components/manage/ManageEventPageShell";
import { manageEventAccentStyle } from "@/lib/utils/eventAccent";
import { VideoReviewQueueTable } from "@/components/admin/VideoReviewQueueTable";
import { fetchVideoReviewSummaries } from "@/lib/admin/videoReviewMeta";
import { videoReviewQueueOrder } from "@/lib/admin/videoReviewQueueOrder";
import { approveManageVideoPublic } from "@/lib/actions/manage-video";
import { getManageNavigationSnapshot } from "@/lib/manage/navigationEvents";
import {
  VIDEO_VISIBILITY_GROUPS,
  normalizeVideoVisibilityFilter,
  type VideoVisibilityGroupKey,
  videoVisibilityFilterLabel,
  videoVisibilityGroupForFilter,
  videoVisibilityStatusesForFilter,
} from "@/lib/admin/videoVisibilityLabels";

export const dynamic = "force-dynamic";

type StatusFilter = {
  value: "all" | VideoVisibilityGroupKey;
  label: string;
};

const STATUS_FILTERS: readonly StatusFilter[] = [
  { value: "all", label: "すべて" },
  ...VIDEO_VISIBILITY_GROUPS.map((group) => ({
    value: group.key,
    label: group.label,
  })),
];

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) return { title: `作品・審査 (${id})` };
  const ev = (
    await db
      .select({ title: eventsTable.title })
      .from(eventsTable)
      .where(eq(eventsTable.id, id))
      .limit(1)
  )[0];
  return { title: ev?.title ? `${ev.title} 作品・審査` : "作品・審査" };
}

export default async function ManageEventVideosPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const { status: statusRaw = "review" } = await searchParams;
  const statusFilter = normalizeVideoVisibilityFilter(statusRaw, "review");
  const activeStatusGroup = statusFilter
    ? videoVisibilityGroupForFilter(statusFilter)
    : null;
  const isReviewFilter = activeStatusGroup === "review";

  const guard = await requireSession({
    next: `/manage/events/${encodeURIComponent(id)}/videos`,
  });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  if (!db) notFound();

  const isAdmin = user.role === "admin";
  const authorization = await getManageAuthorizationSnapshot(
    user.id,
    user.role ?? null,
  );
  const navigation = await getManageNavigationSnapshot(user.id, user.role ?? null);
  if (!canAccessManageEventFromSnapshot(authorization, id)) notFound();
  const ev = navigation.events.find((event) => event.id === id);
  if (!ev) notFound();
  const canApproveVideoStatus = canEditEventFromSnapshot(
    authorization,
    id,
    "video.status",
  );

  const statusValues = videoVisibilityStatusesForFilter(statusFilter);
  const statusCond =
    statusValues && statusValues.length > 1
      ? inArray(videosTable.visibility_status, statusValues)
      : statusValues?.[0]
        ? eq(videosTable.visibility_status, statusValues[0])
        : undefined;
  const eventCond = eq(videoEventsTable.event_id, id);
  const where = statusCond ? and(eventCond, statusCond) : eventCond;

  const baseRows = await db
    .select({
      id: videosTable.id,
      title: videosTable.title,
      youtube_video_id: videosTable.youtube_video_id,
      display_name: videosTable.creator_display_name,
      visibility_status: videosTable.visibility_status,
      created_at: videosTable.created_at,
    })
    .from(videosTable)
    .innerJoin(videoEventsTable, eq(videoEventsTable.video_id, videosTable.id))
    .where(where)
    .orderBy(...videoReviewQueueOrder)
    .limit(200);

  const summaries =
    baseRows.length > 0
      ? await fetchVideoReviewSummaries(
          db,
          baseRows.map((row) => row.id),
          id,
        )
      : new Map();

  const rows = baseRows.map((row) => {
    const summary = summaries.get(row.id);
    return {
      ...row,
      stage_permission_summary: summary?.stage_permission_summary ?? "—",
      required_unanswered_count: summary?.required_unanswered_count ?? 0,
    };
  });

  const filterLabel = statusFilter
    ? videoVisibilityFilterLabel(statusFilter)
    : "すべて";
  const pendingCount = navigation.pendingByEvent.get(id) ?? 0;

  return (
    <ManageEventPageShell
      eventId={id}
      title={ev.title}
      description={`作品・審査 — ${rows.length} 件（${filterLabel}）`}
      backHref={`/manage/events/${id}`}
      backLabel="イベント概要へ"
      isAdmin={isAdmin}
      pendingCount={pendingCount}
      accentStyle={manageEventAccentStyle(ev.accent_color)}
    >
      <nav
        aria-label="公開状態フィルタ"
        className="manage-filter-compact"
      >
        {STATUS_FILTERS.map((f) => {
          const active =
            f.value === "all" ? statusFilter === "" : f.value === activeStatusGroup;
          const href = `/manage/events/${id}/videos?status=${encodeURIComponent(f.value)}`;
          return (
            <Link
              key={f.value}
              href={href}
              aria-current={active ? "page" : undefined}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          tone={isReviewFilter ? "success" : "neutral"}
          title={
            isReviewFilter
              ? "審査待ちはありません"
              : "該当する作品はありません"
          }
          description={
            isReviewFilter
              ? "現在、このイベントで対応が必要な作品はありません。"
              : "フィルタ条件を変えると、別の作品が表示される場合があります。"
          }
          iconName={isReviewFilter ? "check" : "info"}
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
        <VideoReviewQueueTable
          rows={rows}
          variant="manage"
          reviewHref={(videoId) => `/manage/events/${id}/videos/${videoId}`}
          contentHref={(videoId) => `/dashboard/edit/${videoId}?privileged=event`}
          canApprove={canApproveVideoStatus}
          quickApproveAction={approveManageVideoPublic}
          quickApproveHiddenFields={{ event_id: id }}
        />
      )}
    </ManageEventPageShell>
  );
}
