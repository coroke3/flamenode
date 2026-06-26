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
import { formatSocialLinksForText } from "@/lib/socialLinks";
import {
  VideoMembersField,
  type VideoMemberInput,
  type VideoMemberSuggestion,
} from "@/components/forms/VideoMembersField";
import { VideoIconPicker } from "@/components/forms/VideoIconPicker";
import { normalizeXId } from "@/lib/utils/xid";
import { ErrorCallout } from "@/components/ui/ErrorCallout";
import {
  getStagePermissionAnswerValue,
  resolveStagePermissionFieldsFromJson,
} from "@/lib/video/formSettings";
import { redirectForGuardReason } from "@/lib/client/guardRedirect";

export interface VideoFormInitialValues {
  display_name?: string;
  creator_x_user_id?: string;
  icon_url?: string;
  profile_text?: string;
  youtube_channel_url?: string;
  other_social_links?: string;
  title?: string;
  youtube_url?: string;
  music?: string;
  music_reference_url?: string;
  credit?: string;
  intro_comment?: string;
  used_software?: string;
  stage_permission?: string;
  highlights?: string;
  production_story?: string;
  closing_comment?: string;
  is_collab?: boolean;
  members?: VideoMemberInput[];
  /** この作品が所属するイベント ID 一覧 (video_events 経由)。 */
  event_ids?: string[];
  /** 作品が選択した「部」(events.parts_json の候補から)。未設定なら null/空文字。 */
  part?: string | null;
}

/** VideoForm のイベント選択肢。 */
export interface EventOption {
  id: string;
  title: string;
  video_form_settings_json?: string | null;
  /** イベントに設定された「部」候補 (JSON 文字列)。null/空配列なら部 UI を出さない。 */
  parts_json?: string | null;
}

function parsePartsJson(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  } catch {
    return [];
  }
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
   * x_users.icon_url / x_user_icons / 同 X ID の過去 videos.creator_icon_url を新しい順で含む。
   */
  iconCandidates?: string[];
  /**
   * 所属イベントの選択肢 (受付中のイベント等)。複数チェック可能で、
   * 出力は hidden input `event_ids` (改行区切り) で渡される。
   * 未指定なら所属イベント選択 UI は表示しない (現在の挙動互換)。
   */
  eventOptions?: EventOption[];
  /**
   * 所属イベントの編集権限。false なら表示のみ (チェックボックス操作不可)。
   * デフォルト true。slot モードでは slot.event_id は固定で含まれる。
   */
  canEditEvents?: boolean;
  /**
   * 提出主体 X ID を変更できるか。デフォルト false。
   * true でも UI は「解除チェックボックス → <select>」の二段階で、
   * 解除した時のみ hidden `allow_submitter_change=1` が送信される。
   * サーバー側でも `role === "admin"` を再検証するため、UI 操作だけでは突破できない。
   */
  canChangeSubmitter?: boolean;
  /**
   * 編集モード時のクライアント側 privilegeMode。サーバー側 hidden として
   * `edit_privilege_mode` で送信される。サーバーは別途 URL/セッションから再検証する。
   */
  editPrivilegeMode?: "normal" | "admin" | "event";
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
  eventOptions = [],
  canEditEvents = true,
  canChangeSubmitter = false,
  editPrivilegeMode,
}: VideoFormProps): React.ReactElement {
  const router = useRouter();
  const [youtubeUrl, setYoutubeUrl] = React.useState(initial.youtube_url ?? "");
  const [titlePreview, setTitlePreview] = React.useState(initial.title ?? "");
  const [displayNamePreview, setDisplayNamePreview] = React.useState(
    initial.display_name ?? "",
  );
  const [isCollab, setIsCollab] = React.useState(
    Boolean(initial.is_collab || (initial.members?.length ?? 0) > 0),
  );
  // 所属イベントの選択状態。slot モードでは slot.event_id が initial.event_ids
  // に含まれている前提で、固定として扱う (UI でも変更不可)。
  const [selectedEventIds, setSelectedEventIds] = React.useState<string[]>(
    initial.event_ids ?? [],
  );
  // 部 (作品の分類)。所属イベントの parts_json から選ぶ。
  const [selectedPart, setSelectedPart] = React.useState<string>(
    initial.part ?? "",
  );
  // 所属イベントの parts_json から、選択可能な部の候補 (重複排除) を作る。
  const availableParts = React.useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const event of eventOptions) {
      if (!selectedEventIds.includes(event.id)) continue;
      for (const part of parsePartsJson(event.parts_json)) {
        if (seen.has(part)) continue;
        seen.add(part);
        out.push(part);
      }
    }
    return out;
  }, [eventOptions, selectedEventIds]);
  // 選択中の部が、現在の候補に含まれていない場合は自動でクリアする。
  // (イベント所属を外したときに古い値が残らないようにする)
  React.useEffect(() => {
    if (selectedPart && !availableParts.includes(selectedPart)) {
      setSelectedPart("");
    }
  }, [availableParts, selectedPart]);
  const selectedStagePermissionFields = React.useMemo(
    () =>
      resolveStagePermissionFieldsFromJson(
        eventOptions
          .filter((event) => selectedEventIds.includes(event.id))
          .map((event) => event.video_form_settings_json),
      ),
    [eventOptions, selectedEventIds],
  );

  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<VideoActionResult | null>(null);
  // 未保存変更がある状態でブラウザを離れようとしたときに警告を出すための dirty 判定。
  // 入力長文 (紹介文・メンバー編集・アイコン選択) を持つフォームなので、
  // 誤ってリロード / タブ閉じが起きると入力が失われる事故を避ける。
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      // 送信中・送信完了直後・dirty でない場合は警告しない。
      if (!dirty || pending) return;
      e.preventDefault();
      // Chrome 系では returnValue を空文字でも default 警告を出す。
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, pending]);

  const normalizedInitialXId = normalizeXId(initial.creator_x_user_id || activeXId || "");
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
  const selectedEventLabels = eventOptions
    .filter((event) => selectedEventIds.includes(event.id))
    .map((event) => event.title);
  const sidePreviewTitle = titlePreview.trim() || "作品タイトル未入力";
  const sidePreviewName =
    displayNamePreview.trim() ||
    normalizedActiveXId ||
    normalizedInitialXId ||
    "提出者未設定";
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
  const requiredStageQuestionCount = selectedStagePermissionFields.filter(
    (question) => question.required,
  ).length;

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
      const currentPath =
        typeof window === "undefined"
          ? "/"
          : `${window.location.pathname}${window.location.search}`;
      if (!r.ok && redirectForGuardReason(router, r.reason, currentPath)) {
        // リダイレクトで離脱するので dirty 警告は不要にする。
        setDirty(false);
        return;
      }
      setResult(r);
      if (r.ok) {
        // 保存成功時は dirty を解除し、編集画面遷移時の警告を抑制する。
        setDirty(false);
      }
      // 新規投稿後は自動遷移をやめて成功 CTA (公開ページ / イベント / 編集を続ける) を出す。
      // 「投稿できた → 公開ページ確認したい」「→ イベントに戻りたい」を選べるようにする。
      // 編集モードはその場に留まり、router.refresh で最新値を反映する。
      if (r.ok && mode === "edit") {
        router.refresh();
      }
    });
  };

  return (
    <form
      className={styles.form}
      onSubmit={handleSubmit}
      onChange={() => {
        if (!dirty) setDirty(true);
      }}
    >
      {slotId ? <input type="hidden" name="slot_id" value={slotId} /> : null}
      {videoId ? <input type="hidden" name="video_id" value={videoId} /> : null}
      <input type="hidden" name="mode" value={mode} />
      {mode === "edit" && editPrivilegeMode ? (
        <input
          type="hidden"
          name="edit_privilege_mode"
          value={editPrivilegeMode}
        />
      ) : null}
      {softwareSuggestions.length > 0 ? (
        <datalist id="used-software-suggestions">
          {softwareSuggestions.map((name, index) => (
            <option key={`${name}-software-${index}`} value={name} />
          ))}
        </datalist>
      ) : null}

      <div className={styles.formMain}>
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
        <div className={`${styles.row} ${styles.cols2}`}>
          <div className={cx(styles.field, styles.editableField)}>
            <label className={`${styles.label} ${styles.required}`} htmlFor="creator_x_user_id">
              提出主体 X ID
            </label>
            {isActiveXFixed ? (
              // free / slot モード: Active X ID に固定。変更不可。
              normalizedActiveXId ? (
                <>
                  <input
                    id="creator_x_user_id"
                    name="creator_x_user_id"
                    type="text"
                    value={normalizedActiveXId}
                    readOnly
                    className="fn-input"
                    aria-readonly="true"
                    disabled={fieldDisabled("submitter.creator_x_user_id")}
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
              // edit モード: 既定では readOnly で表示し、admin が明示的に解錠した場合のみ
              // <select> を出して提出主体 X ID を変更できる。
              // 解錠時は allow_submitter_change=1 を hidden で送り、サーバー側でも
              // role==="admin" と二重ゲートで検証する。
              <EditSubmitterField
                initialXId={normalizedInitialXId}
                xIdOptions={xIdOptions}
                hasSelectableXIds={hasSelectableXIds}
                selectedDefault={selectedDefault}
                disabled={fieldDisabled("submitter.creator_x_user_id")}
                sectionDisabled={isSectionDisabled(disabledSections, "submitter")}
                canChangeSubmitter={canChangeSubmitter}
              />
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
              onChange={(e) => setDisplayNamePreview(e.target.value)}
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
        <div className={`${styles.row} ${styles.cols2}`}>
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
              defaultValue={formatSocialLinksForText(initial.other_social_links)}
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
            onChange={(e) => setTitlePreview(e.target.value)}
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

        <div className={`${styles.row} ${styles.cols2}`}>
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
            <input
              id="music_reference_url"
              name="music_reference_url"
              type="url"
              defaultValue={initial.music_reference_url}
              className="fn-input"
              placeholder="楽曲リンク URL (任意, https://...)"
              maxLength={500}
              disabled={fieldDisabled("video.music")}
              style={{ marginTop: 6 }}
            />
            <p className={styles.help}>
              楽曲ページ・ニコニコ動画・YouTube などのリンクを入れると、視聴者に楽曲ページへ飛んでもらえます。
            </p>
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

        {eventOptions.length > 0 ? (
          <div className={cx(styles.field, styles.editableField)}>
            <label className={styles.label}>所属イベント</label>
            <p className={styles.help}>
              この作品を関連付けるイベントを選択します。複数選択可。
              {slotId ? " 確保したスロットのイベントは固定で含まれます。" : ""}
            </p>
            <input
              type="hidden"
              name="event_ids"
              value={selectedEventIds.join(",")}
            />
            <div className={styles.eventOptionGrid}>
              {eventOptions.map((ev) => {
                const checked = selectedEventIds.includes(ev.id);
                // slot モードでは slot.event_id を固定で含めるため、編集者でも外せない。
                const locked =
                  !canEditEvents ||
                  (mode === "slot" &&
                    !!initial.event_ids?.includes(ev.id) &&
                    initial.event_ids.length === 1);
                return (
                  <label
                    key={ev.id}
                    className={`${styles.eventOption} ${checked ? styles.eventOptionChecked : ""} ${locked ? styles.eventOptionLocked : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={locked}
                      onChange={(e) => {
                        if (locked) return;
                        setSelectedEventIds((prev) =>
                          e.target.checked
                            ? Array.from(new Set([...prev, ev.id]))
                            : prev.filter((id) => id !== ev.id),
                        );
                      }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>{ev.title}</span>
                    {locked ? (
                      <Icon
                        name="alert"
                        size={11}
                        aria-hidden
                        title="このイベントは固定です"
                      />
                    ) : null}
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}

        {mode === "slot" ? (
          <input type="hidden" name="part" value={initial.part ?? ""} />
        ) : availableParts.length > 0 ? (
          <div className={cx(styles.field, styles.editableField)}>
            <label className={styles.label} htmlFor="part">
              部
            </label>
            <p className={styles.help}>
              所属イベントで設定された「部」(セクション/カテゴリ) から 1 つ選択します。
              未選択でも投稿できます。
            </p>
            <select
              id="part"
              name="part"
              className="fn-select"
              value={selectedPart}
              onChange={(e) => {
                setSelectedPart(e.target.value);
                setDirty(true);
              }}
              disabled={fieldDisabled("video.part")}
            >
              <option value="">(未設定)</option>
              {availableParts.map((part) => (
                <option key={part} value={part}>
                  {part}
                </option>
              ))}
            </select>
          </div>
        ) : (
          // フォーム送信時に常に part キーを含めるため、UI 非表示時も hidden で送る。
          <input type="hidden" name="part" value="" />
        )}
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

        {selectedStagePermissionFields.map((question, index) => {
          const fieldId = `stage_permission_${question.id}`;
          return (
            <div
              key={`${question.id}-${index}`}
              className={cx(styles.field, styles.editableField)}
            >
              <input
                type="hidden"
                name="stage_permission_answer_id"
                value={question.id}
              />
              <label
                className={`${styles.label} ${
                  question.required ? styles.required : ""
                }`}
                htmlFor={fieldId}
              >
                {question.label}
              </label>
              {question.description ? (
                <p className={styles.help}>{question.description}</p>
              ) : null}
              <textarea
                id={fieldId}
                name="stage_permission_answer_value"
                defaultValue={getStagePermissionAnswerValue(
                  initial.stage_permission,
                  question.id,
                )}
                className="fn-input"
                rows={3}
                maxLength={1000}
                required={question.required}
                placeholder={question.placeholder}
                disabled={fieldDisabled("descriptions.stage_permission")}
              />
            </div>
          );
        })}

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
          <input type="hidden" name="is_collab" value="false" />
          <input
            type="checkbox"
            name="is_collab"
            value="true"
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
              collabPermsHref="#video-collab-perms"
            />
            <p className={styles.help} style={{ marginTop: 8 }}>
              X ID 欄は @ 抜きで入力します。未承認 X ID も受け付け、後で本人連携時に紐付け可能です。
            </p>
          </div>
        ) : null}
      </section>

      {result && !result.ok ? (
        <ErrorCallout
          reason={result.reason}
          message={result.message ?? "提出に失敗しました。"}
        />
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
            display: "grid",
            gap: 10,
          }}
        >
          <div>
            <Icon name="check" size={13} aria-hidden />{" "}
            {mode === "edit"
              ? "保存しました。"
              : "提出が完了しました。続けて以下から進めてください。"}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {result.youtubeVideoId || result.videoId ? (
              <Link
                href={`/${result.youtubeVideoId ?? result.videoId}`}
                className="fn-btn fn-btn-primary fn-btn-sm"
              >
                <Icon name="external" size={12} aria-hidden /> 公開ページを見る
              </Link>
            ) : null}
            {result.eventId ? (
              <Link
                href={`/event/${result.eventId}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                <Icon name="calendar" size={12} aria-hidden /> イベントへ戻る
              </Link>
            ) : null}
            {mode !== "edit" && result.videoId ? (
              <Link
                href={`/dashboard/edit/${result.videoId}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                <Icon name="edit" size={12} aria-hidden /> 編集を続ける
              </Link>
            ) : null}
          </div>
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
      </div>

      <aside className={styles.sidePreview} aria-label="投稿内容プレビュー">
        <span className={styles.sideEyebrow}>live preview</span>
        <div className={styles.previewCard}>
          <div className={styles.previewVisual}>
            {youtubeId ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={youtubeThumbUrl(youtubeId, "hqdefault")} alt="" />
            ) : null}
            <span className={styles.previewCode}>
              {youtubeId ? `yt / ${youtubeId}` : "youtube url"}
            </span>
            <span className={styles.previewPlay} aria-hidden>
              <Icon name="play" size={18} />
            </span>
          </div>
          <div className={styles.previewInfo}>
            <h3>{sidePreviewTitle}</h3>
            <p>{sidePreviewName}</p>
            <span>{isCollab ? "合作作品" : "個人作品"}</span>
          </div>
        </div>
        <dl className={styles.previewChecklist}>
          <PreviewCheck ok={Boolean(youtubeId)} label="YouTube URL" />
          <PreviewCheck ok={Boolean(titlePreview.trim())} label="作品タイトル" />
          <PreviewCheck ok={Boolean(displayNamePreview.trim())} label="表示名" />
          <PreviewCheck
            ok={requiredStageQuestionCount === 0}
            label={
              requiredStageQuestionCount > 0
                ? `追加質問 ${requiredStageQuestionCount} 件は入力必須`
                : selectedStagePermissionFields.length > 0
                  ? `追加質問 ${selectedStagePermissionFields.length} 件は任意`
                  : "追加質問なし"
            }
            pending={requiredStageQuestionCount > 0}
          />
          <PreviewCheck
            ok={!isCollab || Boolean(initial.members?.length)}
            label={isCollab ? "合作メンバーを確認" : "メンバー入力なし"}
            pending={isCollab && !initial.members?.length}
          />
        </dl>
        <div className={styles.saveId}>
          <span className={styles.sideEyebrow}>保存名義 / active X ID</span>
          <div className={styles.saveIdRow}>
            <span className={styles.saveIdAvatar}>
              {sidePreviewName.slice(0, 1).toLowerCase()}
            </span>
            <span>
              <strong>{sidePreviewName}</strong>
              <small>
                @{normalizedActiveXId || normalizedInitialXId || "not-selected"}
              </small>
            </span>
          </div>
        </div>
        {selectedEventLabels.length > 0 ? (
          <div className={styles.previewEvents}>
            <span className={styles.sideEyebrow}>events</span>
            {selectedEventLabels.slice(0, 3).map((label) => (
              <span key={label}>{label}</span>
            ))}
            {selectedEventLabels.length > 3 ? (
              <span>ほか {selectedEventLabels.length - 3} 件</span>
            ) : null}
          </div>
        ) : null}
      </aside>

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

      <div className={styles.mobileSubmitBar} aria-label="送信操作">
        <span className={styles.mobileSubmitHint}>
          {submitBlockedReason
            ? "投稿できません"
            : pending
              ? "送信中…"
              : mode === "edit"
                ? "変更を保存できます"
                : "入力後に提出できます"}
        </span>
        <button
          type="submit"
          className="fn-btn fn-btn-primary"
          disabled={pending || !canSubmit}
          aria-busy={pending}
        >
          {pending ? "送信中…" : mode === "edit" ? "保存する" : "提出する"}
        </button>
      </div>
    </form>
  );
}

function PreviewCheck({
  ok,
  pending = false,
  label,
}: {
  ok: boolean;
  pending?: boolean;
  label: string;
}): React.ReactElement {
  const mark = ok ? "✓" : pending ? "!" : "·";
  return (
    <div className={ok ? styles.checkOk : pending ? styles.checkPending : styles.checkTodo}>
      <dt>{mark}</dt>
      <dd>{label}</dd>
    </div>
  );
}

/**
 * 編集モードの提出主体 X ID フィールド。
 *
 * 既定状態:
 *   - 既存の creator_x_user_id / creator_x_user_id を **readOnly** で表示。
 *   - 一切送信されない (hidden name="creator_x_user_id" を出さない) わけにはいかない
 *     ので、視覚的に readOnly な input を出しつつサーバー側が現在値を維持する。
 *
 * 解錠 (admin がチェックボックスを ON):
 *   - <select> に切り替えて xIdOptions から選択させる。
 *   - hidden `allow_submitter_change=1` を一緒に送る。サーバー側は
 *     `role === "admin"` と二重ゲートで検証するので、UI 操作だけでは突破できない。
 *
 * 操作可能な admin がいないケース (xIdOptions が空) では unlock UI 自体を出さない。
 */
function EditSubmitterField({
  initialXId,
  xIdOptions,
  hasSelectableXIds,
  selectedDefault,
  disabled,
  sectionDisabled,
  canChangeSubmitter,
}: {
  initialXId: string;
  xIdOptions: readonly XIdOption[];
  hasSelectableXIds: boolean;
  selectedDefault: string;
  disabled: boolean;
  sectionDisabled: boolean;
  canChangeSubmitter: boolean;
}): React.ReactElement {
  const [unlocked, setUnlocked] = React.useState(false);

  if (!initialXId && !hasSelectableXIds) {
    return (
      <div className="fn-muted fn-text-sm">提出主体 X ID が設定されていません。</div>
    );
  }

  // 非 admin (canChangeSubmitter === false) は unlock UI を一切出さず、
  // 既存の提出主体 X ID を読み取り専用で表示するだけ。
  if (!unlocked) {
    return (
      <>
        <input
          id="creator_x_user_id"
          name="creator_x_user_id"
          type="text"
          defaultValue={initialXId}
          className="fn-input"
          readOnly
          aria-readonly="true"
          disabled={sectionDisabled}
          style={{ opacity: 0.75, cursor: "default" }}
        />
        {canChangeSubmitter && hasSelectableXIds ? (
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 6,
              fontSize: 11,
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={false}
              onChange={() => setUnlocked(true)}
              disabled={disabled || sectionDisabled}
            />
            提出主体 X ID を変更する (管理者のみ)
          </label>
        ) : (
          <p className="fn-text-sm" style={{ marginTop: 4, color: "var(--text-muted)" }}>
            提出主体 X ID は変更できません。
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <input type="hidden" name="allow_submitter_change" value="1" />
      <select
        id="creator_x_user_id"
        name="creator_x_user_id"
        className="fn-select"
        defaultValue={selectedDefault}
        required
        disabled={disabled}
      >
        {xIdOptions.map((opt, index) => (
          <option
            key={`${opt.id}-xid-option-${index}`}
            value={normalizeXId(opt.id)}
          >
            @{opt.id} ({opt.x_name})
          </option>
        ))}
      </select>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 6,
          flexWrap: "wrap",
          fontSize: 11,
          color: "var(--accent-danger, #b91c1c)",
        }}
      >
        <Icon name="alert" size={11} aria-hidden />
        提出主体 X ID を変更しようとしています。サーバー側でも管理者権限を再検証します。
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          onClick={() => setUnlocked(false)}
          style={{ marginLeft: "auto" }}
        >
          キャンセル
        </button>
      </div>
    </>
  );
}
