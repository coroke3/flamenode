"use client";

import * as React from "react";
import Link from "next/link";
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
import { VideoIconPicker } from "@/components/forms/VideoIconPicker";
import { normalizeXId } from "@/lib/utils/xid";

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

export interface XIdOption {
  id: string;
  x_name: string;
}

interface VideoFormProps {
  mode: "free" | "slot" | "edit";
  initial?: VideoFormInitialValues;
  slotId?: string;
  videoId?: string;
  memberSuggestions?: VideoMemberSuggestion[];
  softwareSuggestions?: string[];
  xIdOptions?: XIdOption[];
  activeXId?: string | null;
  /**
   * 編集権限がない section の key 一覧。
   * 指定された section は opacity / pointer-events で不活性化され、
   * 内部の input 類に disabled 属性が付与される。
   *
   * 取りうる値: "submitter" | "video" | "descriptions" | "members"
   *
   * 省略時はすべて編集可能 (既存動作を維持)。
   *
   * 注意: これはフロント表示の補助のみ。
   * サーバー側権限チェック (updateVideo Server Action) は独立して実行される。
   */
  disabledSections?: string[];
  disabledFields?: string[];
  /**
   * 投稿ボタンを押せないようにする理由文。
   * 未承認 Active X ID など、サーバー側 writeGuard で必ず弾かれる状態のとき、
   * 「押せるけど失敗する」UX を避けるためにフォーム側で表示・無効化する。
   */
  submitBlockedReason?: string;
  /**
   * 作品アイコンの候補リスト。サーバー側で `getXIconCandidates(db, xId)` から取得する。
   * x_users.icon_url / x_user_icons / 同 X ID の過去 videos.icon_url を新しい順で含む。
   */
  iconCandidates?: string[];
}

/** section key が disabledSections に含まれているか確認する小関数。 */
function isSectionDisabled(
  disabledSections: string[] | undefined,
  key: string,
): boolean {
  return Array.isArray(disabledSections) && disabledSections.includes(key);
}

function isFieldDisabled(
  disabledFields: string[] | undefined,
  key: string,
): boolean {
  return Array.isArray(disabledFields) && disabledFields.includes(key);
}

/** CSS クラス名を条件結合する軽量ヘルパー。外部依存不要。 */
function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
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
  softwareSuggestions = [],
  xIdOptions = [],
  activeXId,
  disabledSections,
  disabledFields,
  submitBlockedReason,
  iconCandidates = [],
}: VideoFormProps): React.ReactElement {
  const router = useRouter();
  const [youtubeUrl, setYoutubeUrl] = React.useState(initial.youtube_url ?? "");
  const [isCollab, setIsCollab] = React.useState(!!initial.is_collab);
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<VideoActionResult | null>(null);

  const normalizedInitialXId = normalizeXId(initial.contact_x_id || activeXId || "");
  const normalizedActiveXId = normalizeXId(activeXId || "");
  const hasSelectableXIds = xIdOptions.length > 0;
  const initialIsSelectable = xIdOptions.some(
    (opt) => normalizeXId(opt.id) === normalizedInitialXId,
  );
  const selectedDefault =
    (initialIsSelectable && normalizedInitialXId) ||
    (xIdOptions[0] ? normalizeXId(xIdOptions[0].id) : "");
  // free/slot モードでは Active X ID が投稿主体に固定される。
  // edit モードでは admin のみ変更可。
  const isActiveXFixed = mode === "free" || mode === "slot";
  const canSubmit =
    !submitBlockedReason &&
    ((isActiveXFixed && !!normalizedActiveXId) ||
      (!isActiveXFixed && (hasSelectableXIds || !!normalizedInitialXId)));

  const youtubeId = extractYoutubeId(youtubeUrl);
  const submitterDisabled = isSectionDisabled(disabledSections, "submitter");
  const videoSectionDisabled = isSectionDisabled(disabledSections, "video");
  const descriptionsDisabled = isSectionDisabled(disabledSections, "descriptions");
  const membersDisabled = isSectionDisabled(disabledSections, "members");
  const fieldDisabled = (key: string) =>
    isFieldDisabled(disabledFields, key) ||
    (key.startsWith("submitter.") && submitterDisabled) ||
    (key.startsWith("video.") && videoSectionDisabled) ||
    (key.startsWith("descriptions.") && descriptionsDisabled) ||
    (key.startsWith("members.") && membersDisabled);

  const redirectForGuardReason = React.useCallback(
    (reason?: string): boolean => {
      if (typeof window === "undefined") return false;
      const next = `${window.location.pathname}${window.location.search}`;

      if (reason === "tos_required" || reason === "tos_reaccept_required") {
        router.push(`/rules?next=${encodeURIComponent(next)}`);
        return true;
      }

      if (reason === "unauthenticated") {
        router.push(`/entry?next=${encodeURIComponent(next)}`);
        return true;
      }

      if (
        reason === "active_x_required" ||
        reason === "active_x_rejected" ||
        reason === "active_x_not_approved"
      ) {
        router.push(`/dashboard/settings?next=${encodeURIComponent(next)}`);
        return true;
      }

      return false;
    },
    [router],
  );

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
      if (!r.ok && redirectForGuardReason(r.reason)) {
        return;
      }
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
      {softwareSuggestions.length > 0 ? (
        <datalist id="used-software-suggestions">
          {softwareSuggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      ) : null}

      <section
        className={cx(
          styles.section,
          submitterDisabled && styles.sectionDisabled,
        )}
        data-disabled={submitterDisabled || undefined}
      >
        <h2 className={styles.sectionTitle}>
          <Icon name="user" size={14} aria-hidden /> 提出者情報
          {submitterDisabled ? (
            <span className={styles.sectionDisabledBadge} aria-label="編集不可">
              <Icon name="alert" size={11} aria-hidden /> 編集権限なし
            </span>
          ) : null}
        </h2>
        <p className={styles.help}>
          この作品で表示する X ID、活動名、団体名を確認してください。X ID 設定の既定値を使いつつ、作品ごとに上書きできます。
        </p>
        <div className={`${styles.row} cols-2`}>
          <div className={cx(styles.field, styles.editableField)}>
            <label className={`${styles.label} ${styles.required}`} htmlFor="contact_x_id">
              提出主体 X ID
            </label>
            {isActiveXFixed ? (
              // free / slot モード: Active X ID に固定。変更不可。
              normalizedActiveXId ? (
                <>
                  <input
                    id="contact_x_id"
                    name="contact_x_id"
                    type="text"
                    value={normalizedActiveXId}
                    readOnly
                    className="fn-input"
                    aria-readonly="true"
                    disabled={fieldDisabled("submitter.contact_x_id")}
                    style={{ opacity: 0.75, cursor: "default" }}
                  />
                  <p className={styles.help} style={{ marginTop: 4 }}>
                    提出主体は現在の Active X ID に固定されます。変更する場合は上部バーから X ID を切り替えてください。
                  </p>
                </>
              ) : (
                <div className="fn-muted fn-text-sm">
                  承認済み X ID がありません。
                  <Link href="/dashboard/settings" style={{ marginLeft: 6 }}>
                    設定で連携
                  </Link>
                </div>
              )
            ) : mode === "edit" ? (
              // edit モード: admin は選択可、一般ユーザーは既存値を読み取り専用で表示。
              hasSelectableXIds ? (
                <>
                  <select
                    id="contact_x_id"
                    name="contact_x_id"
                    className="fn-select"
                    defaultValue={selectedDefault}
                    required
                    disabled={fieldDisabled("submitter.contact_x_id")}
                  >
                    {xIdOptions.map((opt) => (
                      <option key={opt.id} value={normalizeXId(opt.id)}>
                        @{opt.id} ({opt.x_name})
                      </option>
                    ))}
                  </select>
                  <p className={styles.help} style={{ marginTop: 4 }}>
                    提出主体を変更できるのは管理者のみです。サーバー側でも検証されます。
                  </p>
                </>
              ) : normalizedInitialXId ? (
                <input
                  id="contact_x_id"
                  name="contact_x_id"
                  type="text"
                  defaultValue={normalizedInitialXId}
                  className="fn-input"
                  readOnly
                  aria-readonly="true"
                  disabled={isSectionDisabled(disabledSections, "submitter")}
                  style={{ opacity: 0.75, cursor: "default" }}
                />
              ) : (
                <div className="fn-muted fn-text-sm">
                  提出主体 X ID が設定されていません。
                </div>
              )
            ) : null}
          </div>
          <div className={cx(styles.field, styles.editableField)}>
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
              readOnly={fieldDisabled("submitter.display_name")}
              aria-readonly={fieldDisabled("submitter.display_name") || undefined}
              style={fieldDisabled("submitter.display_name") ? { opacity: 0.65, cursor: "default" } : undefined}
            />
          </div>
        </div>
        <div className={cx(styles.field, styles.editableField)}>
          <label className={styles.label}>作品アイコン</label>
          <p className={styles.help}>
            この作品で表示するアイコンを選択します。X ID 既定アイコンは変更されません。
          </p>
          <VideoIconPicker
            candidates={iconCandidates}
            initialIconUrl={initial.icon_url}
            disabled={fieldDisabled("submitter.icon_url")}
          />
        </div>
        <div className={cx(styles.field, styles.editableField)}>
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
            disabled={fieldDisabled("submitter.profile_text")}
          />
        </div>
        <div className={`${styles.row} cols-2`}>
          <div className={cx(styles.field, styles.editableField)}>
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
              disabled={fieldDisabled("submitter.youtube_channel_url")}
            />
          </div>
          <div className={cx(styles.field, styles.editableField)}>
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
              disabled={fieldDisabled("submitter.other_social_links")}
            />
          </div>
        </div>
      </section>

      <section
        className={cx(
          styles.section,
          videoSectionDisabled && styles.sectionDisabled,
        )}
        data-disabled={videoSectionDisabled || undefined}
      >
        <h2 className={styles.sectionTitle}>
          <Icon name="youtube" size={14} aria-hidden /> 動画と基本情報
          {videoSectionDisabled ? (
            <span className={styles.sectionDisabledBadge} aria-label="編集不可">
              <Icon name="alert" size={11} aria-hidden /> 編集権限なし
            </span>
          ) : null}
        </h2>

        <div className={cx(styles.field, styles.editableField)}>
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
            readOnly={fieldDisabled("video.title")}
            aria-readonly={fieldDisabled("video.title") || undefined}
            style={fieldDisabled("video.title") ? { opacity: 0.65, cursor: "default" } : undefined}
          />
        </div>

        <div className={cx(styles.field, styles.editableField)}>
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
            readOnly={fieldDisabled("video.youtube_url")}
            aria-readonly={fieldDisabled("video.youtube_url") || undefined}
            style={fieldDisabled("video.youtube_url") ? { opacity: 0.65, cursor: "default" } : undefined}
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
          <div className={cx(styles.field, styles.editableField)}>
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
              disabled={fieldDisabled("video.music")}
            />
          </div>
          <div className={cx(styles.field, styles.editableField)}>
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
              disabled={fieldDisabled("video.credit")}
            />
          </div>
        </div>
      </section>

      <section
        className={cx(
          styles.section,
          descriptionsDisabled && styles.sectionDisabled,
        )}
        data-disabled={descriptionsDisabled || undefined}
      >
        <h2 className={styles.sectionTitle}>
          <Icon name="edit" size={14} aria-hidden /> 紹介文
          {descriptionsDisabled ? (
            <span className={styles.sectionDisabledBadge} aria-label="編集不可">
              <Icon name="alert" size={11} aria-hidden /> 編集権限なし
            </span>
          ) : null}
        </h2>

        <div className={cx(styles.field, styles.editableField)}>
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
            disabled={fieldDisabled("descriptions.intro_comment")}
          />
        </div>

        <div className={cx(styles.field, styles.editableField)}>
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
            disabled={fieldDisabled("descriptions.highlights")}
          />
        </div>

        <div className={cx(styles.field, styles.editableField)}>
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
            disabled={fieldDisabled("descriptions.production_story")}
          />
        </div>

        <div className={cx(styles.field, styles.editableField)}>
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
            list="used-software-suggestions"
            disabled={fieldDisabled("descriptions.used_software")}
          />
          {softwareSuggestions.length > 0 ? (
            <p className={styles.help}>
              既存データから候補を出しています。該当しない場合はそのまま入力できます。
            </p>
          ) : null}
        </div>

        <div className={cx(styles.field, styles.editableField)}>
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
            disabled={fieldDisabled("descriptions.closing_comment")}
          />
        </div>
      </section>

      <section
        className={cx(
          styles.section,
          membersDisabled && styles.sectionDisabled,
        )}
        data-disabled={membersDisabled || undefined}
      >
        <h2 className={styles.sectionTitle}>
          <Icon name="users" size={14} aria-hidden /> 合作メンバー
          {membersDisabled ? (
            <span className={styles.sectionDisabledBadge} aria-label="編集不可">
              <Icon name="alert" size={11} aria-hidden /> 編集権限なし
            </span>
          ) : null}
        </h2>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            cursor: membersDisabled ? "default" : "pointer",
            fontSize: 13,
          }}
        >
          <input
            type="checkbox"
            name="is_collab"
            checked={isCollab}
            onChange={(e) => setIsCollab(e.target.checked)}
            disabled={membersDisabled}
          />
          合作作品として登録する
        </label>
        {isCollab ? (
          <div style={{ marginTop: 12 }}>
            <VideoMembersField
              initialMembers={initial.members}
              suggestions={memberSuggestions}
              disabled={membersDisabled}
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
      {submitBlockedReason ? (
        <div
          role="alert"
          style={{
            padding: "12px 14px",
            border: "1px solid var(--accent-warning, #c08a00)",
            borderRadius: "var(--radius-sm)",
            background: "var(--accent-warning-soft, rgba(255, 200, 0, 0.08))",
            color: "var(--text-primary)",
            fontSize: 13,
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <Icon name="warning" size={13} aria-hidden />
          <span>{submitBlockedReason}</span>
        </div>
      ) : null}
      <div className={styles.actions}>
        
        <button
          type="submit"
          className="fn-btn fn-btn-primary"
          disabled={pending || !canSubmit}
          aria-busy={pending}
        >
          <Icon name="upload" size={14} aria-hidden />
          {pending ? "送信中…" : "提出する"}
        </button>
      </div>
    </form>
  );
}
