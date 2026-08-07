import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { videoModerationCases } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import { AdminVideoStatusForm } from "@/components/video/VideoStatusForm";
import { VideoApproveActions } from "@/components/video/VideoApproveActions";
import {
  approveAdminVideoPublic,
  approveAdminVideoPublicAndNext,
} from "@/lib/actions/admin";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AdminVideoTabs } from "@/components/admin/AdminVideoTabs";
import { VideoReviewDetailPanel } from "@/components/admin/VideoReviewDetailPanel";
import { fetchVideoReviewDetail } from "@/lib/admin/videoReviewDetail";
import { CreateModerationCaseForm } from "@/components/admin/CreateModerationCaseForm";
import {
  firstSearchParamValue,
  type SearchParamValue,
} from "#utils/next";

export const metadata: Metadata = { title: "作品詳細" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ event?: SearchParamValue }>;
}

export default async function AdminVideoDetailPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const sp = await searchParams;
  const event = firstSearchParamValue(sp.event);
  const db = getDatabase();
  if (!db) notFound();

  const video = await fetchVideoReviewDetail(db, id);
  if (!video) notFound();

  const moderationCases = await db
    .select({
      id: videoModerationCases.id,
      case_type: videoModerationCases.case_type,
      status: videoModerationCases.status,
      public_reason: videoModerationCases.public_reason,
      private_note: videoModerationCases.private_note,
      due_at: videoModerationCases.due_at,
      related_x_user_id: videoModerationCases.related_x_user_id,
      created_at: videoModerationCases.created_at,
      resolved_at: videoModerationCases.resolved_at,
    })
    .from(videoModerationCases)
    .where(eq(videoModerationCases.video_id, video.id))
    .orderBy(desc(videoModerationCases.created_at))
    .limit(20);
  const openCaseCount = moderationCases.filter((c) => c.status === "open").length;
  const openVoidCaseId =
    moderationCases.find((c) => c.status === "open" && c.case_type === "void")?.id ??
    moderationCases.find((c) => c.status === "open")?.id ??
    null;

  const reviewHiddenFields = event ? { review_event_id: event } : undefined;
  const backHref = event
    ? `/admin/videos?status=review&event=${encodeURIComponent(event)}`
    : "/admin/videos";

  return (
    <div>
      <AdminPageHeader
        title={video.title}
        description={`作者: ${video.creator_name}${video.creator_x_user_id ? ` (@${video.creator_x_user_id})` : ""}`}
        backHref={backHref}
        backLabel="作品一覧へ"
      />

      <AdminVideoTabs
        videoId={video.id}
        youtubeVideoId={video.youtube_video_id}
        active="detail"
      />

      <VideoReviewDetailPanel
        video={video}
        statusForm={
          <>
            <VideoApproveActions
              videoId={video.id}
              currentStatus={video.visibility_status}
              approveAction={approveAdminVideoPublic}
              approveAndNextAction={approveAdminVideoPublicAndNext}
              hiddenFields={reviewHiddenFields}
            />
            <AdminVideoStatusForm
              videoId={video.id}
              currentStatus={video.visibility_status}
              openVoidCaseId={openVoidCaseId}
              hiddenFields={reviewHiddenFields}
            />
          </>
        }
        footerLinks={
          <>
            <Link
              href={`/${video.youtube_video_id ?? video.id}`}
              className="fn-btn fn-btn-ghost"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="external" size={12} aria-hidden /> 公開ページ
            </Link>
            <Link href={`/dashboard/edit/${video.id}`} className="fn-btn fn-btn-ghost">
              <Icon name="edit" size={12} aria-hidden /> 編集画面
            </Link>
            <Link href={`/admin/videos/${video.id}/members`} className="fn-btn fn-btn-ghost">
              <Icon name="users" size={12} aria-hidden /> 参加者設定
            </Link>
          </>
        }
      />

      <section className="fn-card" style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
          モデレーションケース
        </h2>
        <p className="fn-muted" style={{ marginBottom: 12, fontSize: 12 }}>
          未解決 {openCaseCount} 件 / 直近 {moderationCases.length} 件
        </p>

        {moderationCases.length > 0 ? (
          <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            {moderationCases.map((item) => (
              <details
                key={item.id}
                style={{
                  padding: 10,
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <summary style={{ cursor: "pointer", fontSize: 12 }}>
                  <span
                    className={`fn-badge ${
                      item.status === "open" ? "fn-badge-warning" : "fn-badge-soft"
                    }`}
                  >
                    {item.status}
                  </span>{" "}
                  <code>{item.case_type}</code>{" "}
                  <span className="fn-muted">{formatUnix(item.created_at)}</span>
                </summary>
                <dl
                  style={{
                    marginTop: 8,
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    gap: "4px 8px",
                    fontSize: 12,
                  }}
                >
                  <dt className="fn-muted">期限</dt>
                  <dd>{item.due_at ? formatUnix(item.due_at) : "—"}</dd>
                  <dt className="fn-muted">関連X ID</dt>
                  <dd>{item.related_x_user_id ? `@${item.related_x_user_id}` : "—"}</dd>
                  <dt className="fn-muted">公開理由</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>{item.public_reason || "—"}</dd>
                  <dt className="fn-muted">内部メモ</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>{item.private_note || "—"}</dd>
                  <dt className="fn-muted">解決日時</dt>
                  <dd>{item.resolved_at ? formatUnix(item.resolved_at) : "—"}</dd>
                </dl>
              </details>
            ))}
          </div>
        ) : (
          <p className="fn-muted" style={{ marginBottom: 14, fontSize: 12 }}>
            この作品のケースはまだありません。
          </p>
        )}

        <CreateModerationCaseForm videoId={video.id} />
      </section>
    </div>
  );
}
