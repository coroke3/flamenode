import * as React from "react";
import Link from "next/link";
import { FnTable } from "@/components/ui/FnTable";
import { Icon } from "@/components/ui/Icon";
import { formatRelative, formatUnix } from "@/lib/utils/format";
import { youtubeThumbUrl } from "@/lib/youtube/id";
import {
  videoVisibilityBadgeClass,
  videoVisibilityLabel,
} from "@/lib/admin/videoVisibilityLabels";
import { VideoReviewQuickApproveButton } from "@/components/admin/VideoReviewQuickApproveButton";

export type VideoReviewQueueRow = {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  visibility_status: string;
  created_at: number;
  stage_permission_summary: string;
  required_unanswered_count: number;
};

type QuickApproveAction = (formData: FormData) => Promise<{
  ok: boolean;
  message?: string;
  retryable?: boolean;
}>;

interface VideoReviewQueueTableProps {
  rows: VideoReviewQueueRow[];
  reviewHref: (videoId: string) => string;
  contentHref: (videoId: string) => string;
  extraActions?: (videoId: string) => React.ReactNode;
  canApprove?: boolean;
  quickApproveAction?: QuickApproveAction;
  quickApproveHiddenFields?: Record<string, string>;
  variant?: "admin" | "manage";
}

function visibilityCell(
  status: string,
  manage: boolean,
): React.ReactElement {
  const label = videoVisibilityLabel(status);
  if (manage && status !== "pending") {
    return <span className="manage-queue-muted">{label}</span>;
  }
  return (
    <span className={`fn-badge ${videoVisibilityBadgeClass(status)}`}>
      {label}
    </span>
  );
}

export function VideoReviewQueueTable({
  rows,
  reviewHref,
  contentHref,
  extraActions,
  canApprove = false,
  quickApproveAction,
  quickApproveHiddenFields,
  variant = "admin",
}: VideoReviewQueueTableProps): React.ReactElement {
  const isManage = variant === "manage";
  const showQuickApprove =
    canApprove && quickApproveAction && rows.some((v) => v.visibility_status === "pending");
  const tableClass = [
    "approval-queue-table",
    "approval-queue-table-video",
    isManage ? "manage-video-queue" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <FnTable className={tableClass}>
      <thead>
        <tr>
          <th>サムネイル</th>
          <th>タイトル</th>
          <th>作者</th>
          <th>公開状態</th>
          <th>登録日時</th>
          <th>YouTube</th>
          <th>ステージ許可</th>
          <th>必須未回答</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((v) => (
          <tr key={v.id}>
            <td className="manage-queue-col-thumb">
              <div className="manage-queue-thumb-frame">
                {v.youtube_video_id ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={youtubeThumbUrl(v.youtube_video_id, "default") ?? ""}
                    alt=""
                    className="manage-queue-thumb-image"
                  />
                ) : (
                  <span className="manage-queue-thumb-placeholder">
                    <Icon name="youtube" size={16} aria-hidden />
                  </span>
                )}
              </div>
            </td>
            <td className="manage-queue-title">{v.title}</td>
            <td>{v.display_name}</td>
            <td className="manage-queue-col-status">
              {visibilityCell(v.visibility_status, isManage)}
            </td>
            <td className="fn-muted" title={formatUnix(v.created_at)}>
              {formatRelative(v.created_at)}
            </td>
            <td className="manage-queue-col-youtube">
              {v.youtube_video_id ? (
                isManage ? (
                  <span className="manage-queue-muted">あり</span>
                ) : (
                  <span className="fn-badge fn-badge-soft">あり</span>
                )
              ) : (
                <span className="fn-badge fn-badge-warning">なし</span>
              )}
            </td>
            <td className="manage-queue-stage">{v.stage_permission_summary}</td>
            <td className="manage-queue-col-unanswered">
              {v.required_unanswered_count > 0 ? (
                <span className="fn-badge fn-badge-warning">
                  {v.required_unanswered_count}
                </span>
              ) : isManage ? (
                <span className="manage-queue-muted">0</span>
              ) : (
                <span className="fn-muted">0</span>
              )}
            </td>
            <td className="manage-queue-col-actions">
              <div
                className={`approval-queue-actions${
                  isManage ? " fn-console-row-actions manage-queue-actions" : ""
                }`}
              >
                {canApprove ? (
                  <Link
                    href={reviewHref(v.id)}
                    className="fn-btn fn-btn-primary fn-btn-sm"
                  >
                    審査
                  </Link>
                ) : null}
                {canApprove &&
                v.visibility_status === "pending" &&
                showQuickApprove ? (
                  <VideoReviewQuickApproveButton
                    videoId={v.id}
                    action={quickApproveAction!}
                    hiddenFields={quickApproveHiddenFields}
                  />
                ) : null}
                <Link
                  href={contentHref(v.id)}
                  className="fn-btn fn-btn-ghost fn-btn-sm"
                >
                  内容確認
                </Link>
                {extraActions ? extraActions(v.id) : null}
              </div>
            </td>
          </tr>
        ))}
        {rows.length === 0 ? (
          <tr>
            <td colSpan={9}>
              <p className="fn-empty-message approval-queue-empty">
                条件に合う作品がありません。
              </p>
            </td>
          </tr>
        ) : null}
      </tbody>
    </FnTable>
  );
}
