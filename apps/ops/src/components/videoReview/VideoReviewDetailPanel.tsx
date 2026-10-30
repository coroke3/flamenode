import * as React from "react";
import { formatUnix, videoVisibilityBadgeClass, videoVisibilityLabel, youtubeThumbUrl, youtubeWatchUrl } from "./shared.js";

export interface VideoReviewDetail {
  id: string;
  title: string;
  creator_name: string;
  creator_x_user_id: string | null;
  created_at: number;
  source_type: string;
  youtube_video_id: string | null;
  music: string | null;
  credit: string | null;
  intro_comment: string | null;
  highlights: string | null;
  production_story: string | null;
  stagePermission: string | null;
  visibility_status: string;
  software_label: string | null;
  event_ids: string[];
  customAnswers: Array<{ label: string; answer: string; required: boolean }>;
  members: Array<{
    name: string; role: string | null; x_user_id: string | null;
    is_public_member: boolean; chapters: string | null;
  }>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return <>
    <dt className="fn-muted" style={{ fontSize: 12 }}>{label}</dt>
    <dd style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>{value}</dd>
  </>;
}
export function VideoReviewDetailPanel({
  video, statusForm, footerLinks,
}: {
  video: VideoReviewDetail; statusForm: React.ReactNode; footerLinks?: React.ReactNode;
}): React.ReactElement {
  const youtubeVideoId = video.youtube_video_id?.trim() || null;
  const thumb = youtubeThumbUrl(youtubeVideoId, "maxresdefault");
  return <div className="video-review-detail-panel">
    <section>
      <div className="video-review-hero">
        {thumb ? <img src={thumb} alt="" className="video-review-hero-image" />
          : <div className="video-review-hero-placeholder" aria-hidden>▶</div>}
      </div>
      <dl className="video-review-details">
        {video.source_type === "youtube" && !youtubeVideoId ? <Field
          label="YouTube URL"
          value={<span className="fn-muted">未設定（動画情報のみ公開できます。後から追加可能です）</span>}
        /> : null}
        <Field label="状態" value={<span className={`fn-badge ${videoVisibilityBadgeClass(video.visibility_status)}`}>
          {videoVisibilityLabel(video.visibility_status)}
        </span>} />
        <Field label="作者" value={`${video.creator_name}${video.creator_x_user_id ? ` (@${video.creator_x_user_id})` : ""}`} />
        <Field label="YouTube ID" value={thumb && youtubeVideoId
          ? <a href={youtubeWatchUrl(youtubeVideoId)} target="_blank" rel="noopener noreferrer">{youtubeVideoId}</a>
          : "なし"} />
        <Field label="楽曲" value={video.music ?? "—"} />
        <Field label="クレジット" value={video.credit ?? "—"} />
        <Field label="使用ソフト" value={video.software_label ?? "—"} />
        <Field label="intro_comment" value={video.intro_comment ?? "—"} />
        <Field label="highlights" value={video.highlights ?? "—"} />
        <Field label="production_story" value={video.production_story ?? "—"} />
        <Field label="権利確認" value={video.stagePermission ?? "—"} />
      </dl>
      {video.customAnswers.length > 0 ? <section className="video-review-extra">
        <h2 className="video-review-subtitle">カスタム質問回答</h2>
        <dl className="video-review-answer-list">
          {video.customAnswers.map((item, index) => <div key={`${item.label}-${index}`} className="video-review-answer">
            <dt className="video-review-answer-label">{item.label}
              {item.required ? <span className="fn-badge fn-badge-warning">必須</span> : null}
            </dt>
            <dd className="video-review-answer-value">{item.answer}</dd>
          </div>)}
        </dl>
      </section> : null}
      {video.members.length > 0 ? <section className="video-review-extra">
        <h2 className="video-review-subtitle">メンバー</h2>
        <div className="video-review-table-scroll">
          <table className="fn-table">
            <thead><tr><th>名前</th><th>役割</th><th>X ID</th><th>チャプター</th></tr></thead>
            <tbody>{video.members.map((m, index) => <tr key={`${m.name}-${index}`}>
              <td>{m.name}{!m.is_public_member ? <span className="fn-badge fn-badge-soft">非公開</span> : null}</td>
              <td>{m.role ?? "—"}</td>
              <td>{m.x_user_id ? `@${m.x_user_id}` : "—"}</td>
              <td>{m.chapters ?? "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section> : null}
    </section>
    <aside>
      <section className="fn-card video-review-aside">
        <h2 className="video-review-subtitle">状態変更</h2>
        <p className="fn-muted">登録: {formatUnix(video.created_at)}</p>
        {statusForm}
      </section>
      {footerLinks ? <div className="video-review-actions">{footerLinks}</div> : null}
    </aside>
  </div>;
}
