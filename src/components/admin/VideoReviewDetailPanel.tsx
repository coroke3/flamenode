import * as React from "react";

import { Icon } from "@/components/ui/Icon";
import { youtubeThumbUrl, youtubeWatchUrl } from "@/lib/youtube/id";
import { formatUnix } from "@/lib/utils/format";
import type { VideoReviewDetail } from "@/lib/admin/videoReviewDetail";
import {
  videoVisibilityBadgeClass,
  videoVisibilityLabel,
} from "@/lib/admin/videoVisibilityLabels";
import styles from "./VideoReviewDetailPanel.module.css";

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
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

export function VideoReviewDetailPanel({
  video,
  statusForm,
  footerLinks,
}: VideoReviewDetailPanelProps): React.ReactElement {
  return (
    <div className={styles.layout}>
      <section className={styles.main}>
        <div className={styles.media}>
          {video.youtube_video_id ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={youtubeThumbUrl(video.youtube_video_id, "maxresdefault") ?? ""}
              alt=""
            />
          ) : (
            <Icon name="youtube" size={28} aria-hidden />
          )}
        </div>

        <dl className={styles.details}>
          <Field
            label="状態"
            value={(
              <span className={`fn-badge ${videoVisibilityBadgeClass(video.visibility_status)}`}>
                {videoVisibilityLabel(video.visibility_status)}
              </span>
            )}
          />
          <Field
            label="作者"
            value={`${video.creator_name}${video.creator_x_user_id ? ` (@${video.creator_x_user_id})` : ""}`}
          />
          <Field
            label="YouTube ID"
            value={video.youtube_video_id ? (
              <a
                href={youtubeWatchUrl(video.youtube_video_id)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {video.youtube_video_id}
              </a>
            ) : "なし"}
          />
          <Field
            label="所属イベント"
            value={video.event_ids.length > 0 ? video.event_ids.join(" / ") : "—"}
          />
          <Field label="楽曲" value={video.music ?? "—"} />
          <Field label="クレジット" value={video.credit ?? "—"} />
          <Field label="使用ソフト" value={video.software_label ?? "—"} />
          <Field label="紹介コメント" value={video.intro_comment ?? "—"} />
          <Field label="みどころ" value={video.highlights ?? "—"} />
          <Field label="制作エピソード" value={video.production_story ?? "—"} />
        </dl>

        {video.customAnswers.length > 0 ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>カスタム質問回答</h2>
            <dl className={styles.answerList}>
              {video.customAnswers.map((item) => (
                <div key={item.id} className={styles.answerCard}>
                  <dt className={styles.answerTitle}>
                    <span>{item.label}</span>
                    {item.required ? (
                      <span className="fn-badge fn-badge-warning">必須</span>
                    ) : null}
                    {!item.active ? (
                      <span className="fn-badge fn-badge-soft">現在は無効</span>
                    ) : null}
                  </dt>
                  <dd className={styles.answerValue}>{item.answer}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {video.members.length > 0 ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>メンバー</h2>
            <div className={styles.tableWrap}>
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
            </div>
          </section>
        ) : null}
      </section>

      <aside className={styles.aside}>
        <section className={`fn-card ${styles.statusCard}`}>
          <h2 className={styles.statusTitle}>状態変更</h2>
          <p className={`fn-muted ${styles.registeredAt}`}>
            登録: {formatUnix(video.created_at)}
          </p>
          {statusForm}
        </section>

        {footerLinks ? (
          <div className={styles.footerLinks}>{footerLinks}</div>
        ) : null}
      </aside>
    </div>
  );
}
