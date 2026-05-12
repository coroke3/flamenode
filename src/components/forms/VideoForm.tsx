"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import styles from "./VideoForm.module.css";
import { Icon } from "@/components/ui/Icon";
import {
  extractYoutubeId,
  youtubeThumbUrl,
  youtubeWatchUrl,
} from "@/lib/youtube/id";
import {
  createFreeVideo,
  submitSlotVideo,
  updateVideo,
  type VideoActionResult,
} from "@/lib/actions/video";
import {
  VideoMembersField,
  type VideoMemberInput,
  type VideoMemberSuggestion,
} from "@/components/forms/VideoMembersField";

export interface VideoFormInitialValues {
  display_name?: string;
  contact_x_id?: string;
  icon_url?: string;
  profile_text?: string;
  youtube_channel_url?: string;
  other_social_links?: string;
  title?: string;
  youtube_url?: string;
  music?: string;
  credit?: string;
  intro_comment?: string;
  used_software?: string;
  highlights?: string;
  production_story?: string;
  closing_comment?: string;
  is_collab?: boolean;
  members?: VideoMemberInput[];
}

interface VideoFormProps {
  mode: "free" | "slot" | "edit";
  initial?: VideoFormInitialValues;
  slotId?: string;
  videoId?: string;
  memberSuggestions?: VideoMemberSuggestion[];
}

/**
 * 作品投稿/編集フォーム。
 * 設計図 (post/page.md, post/slotted/page.md, edit/[id]/page.md) を統合。
 * Server Action と React 19 の `useTransition` で進行中状態と結果を扱う。
 */
export function VideoForm({
  mode,
  initial = {},
  slotId,
  videoId,
  memberSuggestions = [],
}: VideoFormProps): React.ReactElement {
  const router = useRouter();
  const [youtubeUrl, setYoutubeUrl] = React.useState(initial.youtube_url ?? "");
  const [isCollab, setIsCollab] = React.useState(!!initial.is_collab);
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<VideoActionResult | null>(null);

  const youtubeId = extractYoutubeId(youtubeUrl);

  const handleSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const formData = new FormData(ev.currentTarget);
    setResult(null);
    startTransition(async () => {
      const action =
        mode === "slot"
          ? submitSlotVideo
          : mode === "edit"
            ? updateVideo
            : createFreeVideo;
      const r = await action(formData);
      setResult(r);
      if (r.ok && r.videoId && mode !== "edit") {
        router.push(`/dashboard/edit/${r.videoId}`);
      }
      if (r.ok && mode === "edit") {
        router.refresh();
      }
    });
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {slotId ? <input type="hidden" name="slot_id" value={slotId} /> : null}
      {videoId ? <input type="hidden" name="video_id" value={videoId} /> : null}
      <input type="hidden" name="mode" value={mode} />

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          <Icon name="user" size={14} aria-hidden /> 提出者情報
        </h2>
        <p className={styles.help}>
          この作品で表示する X ID、活動名、団体名を確認してください。X ID 設定の既定値を使いつつ、作品ごとに上書きできます。
        </p>
        <div className={`${styles.row} cols-2`}>
          <div className={styles.field}>
            <label className={`${styles.label} ${styles.required}`} htmlFor="contact_x_id">
              提出主体 X ID
            </label>
            <input
              id="contact_x_id"
              name="contact_x_id"
              type="text"
              defaultValue={initial.contact_x_id}
              className="fn-input"
              placeholder="your_x_id"
              pattern="[A-Za-z0-9_]{1,32}"
              required
            />
          </div>
          <div className={styles.field}>
            <label className={`${styles.label} ${styles.required}`} htmlFor="display_name">
              表示名 / 活動名 / 団体名
            </label>
            <input
              id="display_name"
              name="display_name"
              type="text"
              defaultValue={initial.display_name}
              className="fn-input"
              maxLength={80}
              required
            />
          </div>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="icon_url">
            アイコン URL
          </label>
          <input
            id="icon_url"
            name="icon_url"
            type="url"
            defaultValue={initial.icon_url}
            className="fn-input"
            placeholder="https://..."
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="profile_text">
            自分・団体の概要
          </label>
          <textarea
            id="profile_text"
            name="profile_text"
            defaultValue={initial.profile_text}
            className="fn-input"
            rows={3}
            maxLength={1000}
          />
        </div>
        <div className={`${styles.row} cols-2`}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="youtube_channel_url">
              YouTube チャンネル URL
            </label>
            <input
              id="youtube_channel_url"
              name="youtube_channel_url"
              type="url"
              defaultValue={initial.youtube_channel_url}
              className="fn-input"
              placeholder="https://www.youtube.com/@..."
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="other_social_links">
              SNS 一覧
            </label>
            <input
              id="other_social_links"
              name="other_social_links"
              type="text"
              defaultValue={initial.other_social_links}
              className="fn-input"
              placeholder="X=https://x.com/... / niconico=..."
              maxLength={1000}
            />
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          <Icon name="youtube" size={14} aria-hidden /> 動画と基本情報
        </h2>

        <div className={styles.field}>
          <label className={`${styles.label} ${styles.required}`} htmlFor="title">
            作品タイトル
          </label>
          <input
            id="title"
            name="title"
            type="text"
            defaultValue={initial.title}
            className="fn-input"
            placeholder="例: First Light - 春の輪"
            maxLength={120}
            required
          />
        </div>

        <div className={styles.field}>
          <label
            className={`${styles.label} ${styles.required}`}
            htmlFor="youtube_url"
          >
            YouTube URL
          </label>
          <input
            id="youtube_url"
            name="youtube_url"
            type="url"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            className="fn-input"
            placeholder="https://www.youtube.com/watch?v=..."
            required
          />
          <p className={styles.help}>
            限定公開でも登録可能ですが、編集時の動画 ID 変更は管理者の事前承認が必要です。
          </p>
          {youtubeId ? (
            <div className={styles.preview}>
              <div className={styles.previewThumb}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={youtubeThumbUrl(youtubeId, "hqdefault")} alt="" />
              </div>
              <div className={styles.previewBody}>
                <strong style={{ color: "var(--text-primary)" }}>
                  YouTube ID: {youtubeId}
                </strong>
                <br />
                <a
                  href={youtubeWatchUrl(youtubeId)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  YouTube で確認 →
                </a>
              </div>
            </div>
          ) : null}
        </div>

        <div className={`${styles.row} cols-2`}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="music">
              使用楽曲
            </label>
            <input
              id="music"
              name="music"
              type="text"
              defaultValue={initial.music}
              className="fn-input"
              placeholder="アーティスト名 - 曲名"
              maxLength={200}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="credit">
              クレジット
            </label>
            <input
              id="credit"
              name="credit"
              type="text"
              defaultValue={initial.credit}
              className="fn-input"
              placeholder="提供 / 作詞作曲 など"
              maxLength={200}
            />
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          <Icon name="edit" size={14} aria-hidden /> 紹介文
        </h2>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="intro_comment">
            紹介コメント
          </label>
          <textarea
            id="intro_comment"
            name="intro_comment"
            defaultValue={initial.intro_comment}
            className="fn-input"
            rows={3}
            maxLength={500}
            placeholder="作品の見どころを 1〜2 行で。"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="highlights">
            みどころ
          </label>
          <textarea
            id="highlights"
            name="highlights"
            defaultValue={initial.highlights}
            className="fn-input"
            rows={4}
            maxLength={1000}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="production_story">
            制作エピソード
          </label>
          <textarea
            id="production_story"
            name="production_story"
            defaultValue={initial.production_story}
            className="fn-input"
            rows={4}
            maxLength={1000}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="used_software">
            使用ソフト
          </label>
          <input
            id="used_software"
            name="used_software"
            type="text"
            defaultValue={initial.used_software}
            className="fn-input"
            maxLength={200}
            placeholder="AviUtl, After Effects, Vegas など"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="closing_comment">
            あとがき
          </label>
          <textarea
            id="closing_comment"
            name="closing_comment"
            defaultValue={initial.closing_comment}
            className="fn-input"
            rows={3}
            maxLength={500}
          />
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          <Icon name="users" size={14} aria-hidden /> 合作メンバー
        </h2>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          <input
            type="checkbox"
            name="is_collab"
            checked={isCollab}
            onChange={(e) => setIsCollab(e.target.checked)}
          />
          合作作品として登録する
        </label>
        {isCollab ? (
          <div style={{ marginTop: 12 }}>
            <VideoMembersField
              initialMembers={initial.members}
              suggestions={memberSuggestions}
            />
            <p className={styles.help} style={{ marginTop: 8 }}>
              X ID 欄は @ 抜きで入力します。未承認 X ID も受け付け、後で本人連携時に紐付け可能です。
            </p>
          </div>
        ) : null}
      </section>

      {result && !result.ok ? (
        <div
          role="alert"
          style={{
            padding: "12px 14px",
            border: "1px solid var(--accent-danger)",
            borderRadius: "var(--radius-sm)",
            background: "var(--accent-danger-soft, rgba(255,0,0,0.08))",
            color: "var(--accent-danger)",
            fontSize: 13,
          }}
        >
          <Icon name="warning" size={13} aria-hidden /> {result.message ?? "提出に失敗しました。"}
        </div>
      ) : null}
      {result && result.ok ? (
        <div
          role="status"
          style={{
            padding: "12px 14px",
            border: "1px solid var(--accent-primary)",
            borderRadius: "var(--radius-sm)",
            background: "var(--accent-primary-soft)",
            color: "var(--text-primary)",
            fontSize: 13,
          }}
        >
          <Icon name="check" size={13} aria-hidden /> 提出が完了しました。続けて詳細編集画面へ移動します。
        </div>
      ) : null}
      <div className={styles.actions}>
        <button
          type="button"
          className="fn-btn fn-btn-ghost"
          disabled={pending}
        >
          下書き保存
        </button>
        <button
          type="submit"
          className="fn-btn fn-btn-primary"
          disabled={pending}
          aria-busy={pending}
        >
          <Icon name="upload" size={14} aria-hidden />
          {pending ? "送信中…" : "提出する"}
        </button>
      </div>
    </form>
  );
}
