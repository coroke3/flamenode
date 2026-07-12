import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { youtubeThumbUrl, youtubeWatchUrl } from "@/lib/youtube/id";
import { formatUnix } from "@/lib/utils/format";
import type { VideoReviewDetail } from "@/lib/admin/videoReviewDetail";
import {
  videoVisibilityBadgeClass,
  videoVisibilityLabel,
} from "@/lib/admin/videoVisibilityLabels";

interface VideoReviewDetailPanelProps {
  video: VideoReviewDetail;
  statusForm: React.ReactNode;
  footerLinks?: React.ReactNode;
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.ReactElement {
  return (
    <>
      <dt className="fn-muted" style={{ fontSize: 12 }}>
        {label}
      </dt>
      <dd style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>{value}</dd>
    </>
  );
}

export function VideoReviewDetailPanel({
  video,
  statusForm,
  footerLinks,
}: VideoReviewDetailPanelProps): React.ReactElement {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.4fr) minmax(280px, 0.8fr)",
        gap: 24,
        marginTop: 8,
      }}
    >
      <section>
        <div
          style={{
            width: "100%",
            aspectRatio: "16 / 9",
            background: "var(--bg-elevated)",
            borderRadius: "var(--radius-md)",
            overflow: "hidden",
          }}
        >
          {video.youtube_video_id ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={youtubeThumbUrl(video.youtube_video_id, "maxresdefault") ?? ""}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                display: "grid",
                placeItems: "center",
                height: "100%",
                color: "var(--text-muted)",
              }}
            >
              <Icon name="youtube" size={28} aria-hidden />
            </div>
          )}
        </div>

        <dl
          style={{
            marginTop: 16,
            display: "grid",
            gridTemplateColumns: "120px 1fr",
            gap: "8px 12px",
          }}
        >
          <Field label="状態" value={
            <span className={`fn-badge ${videoVisibilityBadgeClass(video.visibility_status)}`}>
              {videoVisibilityLabel(video.visibility_status)}
            </span>
          } />
          <Field label="作者" value={`${video.creator_name}${video.creator_x_user_id ? ` (@${video.creator_x_user_id})` : ""}`} />
          <Field
            label="YouTube ID"
            value={
              video.youtube_video_id ? (
                <a
                  href={youtubeWatchUrl(video.youtube_video_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {video.youtube_video_id}
                </a>
              ) : (
                "なし"
              )
            }
          />
          <Field label="楽曲" value={video.music ?? "—"} />
          <Field label="クレジット" value={video.credit ?? "—"} />
          <Field label="使用ソフト" value={video.software_label ?? "—"} />
          <Field label="intro_comment" value={video.intro_comment ?? "—"} />
          <Field label="highlights" value={video.highlights ?? "—"} />
          <Field label="production_story" value={video.production_story ?? "—"} />
          <Field label="権利確認" value={video.stagePermission ?? "—"} />
        </dl>

        {video.customAnswers.length > 0 ? (
          <section style={{ marginTop: 18 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
              カスタム質問回答
            </h2>
            <dl style={{ display: "grid", gap: 10 }}>
              {video.customAnswers.map((item) => (
                <div
                  key={item.label}
                  style={{
                    padding: 10,
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  <dt style={{ fontSize: 12, fontWeight: 700 }}>
                    {item.label}
                    {item.required ? (
                      <span className="fn-badge fn-badge-warning" style={{ marginLeft: 6 }}>
                        必須
                      </span>
                    ) : null}
                  </dt>
                  <dd style={{ margin: "6px 0 0", fontSize: 13, whiteSpace: "pre-wrap" }}>
                    {item.answer}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {video.members.length > 0 ? (
          <section style={{ marginTop: 18 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
              メンバー
            </h2>
            <table className="fn-table">
              <thead>
                <tr>
                  <th>名前</th>
                  <th>役割</th>
                  <th>X ID</th>
                  <th>チャプター</th>
                </tr>
              </thead>
              <tbody>
                {video.members.map((member, index) => (
                  <tr key={`${member.name}-${index}`}>
                    <td>
                      {member.name}
                      {!member.is_public_member ? (
                        <span className="fn-badge fn-badge-soft" style={{ marginLeft: 4 }}>
                          非公開
                        </span>
                      ) : null}
                    </td>
                    <td>{member.role ?? "—"}</td>
                    <td>{member.x_user_id ? `@${member.x_user_id}` : "—"}</td>
                    <td style={{ fontSize: 12 }}>{member.chapters ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </section>

      <aside>
        <section className="fn-card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
            状態変更
          </h2>
          <p style={{ marginBottom: 12, fontSize: 12 }}>
            登録: {formatUnix(video.created_at)}
          </p>
          {statusForm}
        </section>

        {footerLinks ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{footerLinks}</div>
        ) : null}
      </aside>
    </div>
  );
}
