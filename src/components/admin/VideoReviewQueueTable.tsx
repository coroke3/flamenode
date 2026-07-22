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

interface VideoReviewQueueTableProps {
  rows: VideoReviewQueueRow[];
  reviewHref: (videoId: string) => string;
  contentHref: (videoId: string) => string;
  extraActions?: (videoId: string) => React.ReactNode;
}

export function VideoReviewQueueTable({
  rows,
  reviewHref,
  contentHref,
  extraActions,
}: VideoReviewQueueTableProps): React.ReactElement {
  return (
    <FnTable className="approval-queue-table approval-queue-table-video">
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
            <td>
              <div
                style={{
                  width: 88,
                  aspectRatio: "16 / 9",
                  background: "var(--bg-elevated)",
                  borderRadius: "var(--radius-sm)",
                  overflow: "hidden",
                }}
              >
                {v.youtube_video_id ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={youtubeThumbUrl(v.youtube_video_id, "default") ?? ""}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <span
                    style={{
                      display: "grid",
                      placeItems: "center",
                      height: "100%",
                      color: "var(--text-muted)",
                    }}
                  >
                    <Icon name="youtube" size={16} aria-hidden />
                  </span>
                )}
              </div>
            </td>
            <td style={{ fontWeight: 600, minWidth: 160 }}>{v.title}</td>
            <td>{v.display_name}</td>
            <td>
              <span
                className={`fn-badge ${videoVisibilityBadgeClass(v.visibility_status)}`}
              >
                {videoVisibilityLabel(v.visibility_status)}
              </span>
            </td>
            <td className="fn-muted" title={formatUnix(v.created_at)}>
              {formatRelative(v.created_at)}
            </td>
            <td>
              {v.youtube_video_id ? (
                <span className="fn-badge fn-badge-soft">あり</span>
              ) : (
                <span className="fn-badge fn-badge-warning">なし</span>
              )}
            </td>
            <td style={{ fontSize: 12, maxWidth: 140 }}>{v.stage_permission_summary}</td>
            <td>
              {v.required_unanswered_count > 0 ? (
                <span className="fn-badge fn-badge-warning">
                  {v.required_unanswered_count}
                </span>
              ) : (
                <span className="fn-muted">0</span>
              )}
            </td>
            <td>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                <Link
                  href={reviewHref(v.id)}
                  className="fn-btn fn-btn-primary fn-btn-sm"
                >
                  審査
                </Link>
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
              <p className="fn-empty-message" style={{ padding: 16, textAlign: "center" }}>
                条件に合う作品がありません。
              </p>
            </td>
          </tr>
        ) : null}
      </tbody>
    </FnTable>
  );
}
