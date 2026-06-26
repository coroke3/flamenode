"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import styles from "./XIdSettingsClient.module.css";
import { Icon } from "@/components/ui/Icon";
import {
  deleteLinkedXId,
  enablePortfolio,
  requestXIdLink,
  setXIdIcon,
  setActiveXId,
  uploadXIdIcon,
  updateXIdProfile,
} from "@/lib/actions/xid";
import { ConfirmTextDialog } from "@/components/ui/ConfirmTextDialog";
import {
  parseSocialLinks,
  SOCIAL_LINK_TYPE_OPTIONS,
  type SocialLink,
} from "@/lib/socialLinks";

/** X ID 連携申請フォーム (Server Action `requestXIdLink`)。 */
export function XIdLinkForm({
  compact = false,
}: {
  compact?: boolean;
} = {}): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [okMsg, setOkMsg] = React.useState<string | null>(null);
  const [errMsg, setErrMsg] = React.useState<string | null>(null);

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const fd = new FormData(form);
    setOkMsg(null);
    setErrMsg(null);
    startTransition(async () => {
      const r = await requestXIdLink(fd);
      if (r.ok) {
        setOkMsg(
          r.message ??
            "連携申請を受け付けました。承認後、一覧に表示されます。",
        );
        form?.reset();
        router.refresh();
      } else {
        setErrMsg(r.message ?? "申請に失敗しました。");
      }
    });
  };

  return (
    <form className={styles.stack} onSubmit={onSubmit} aria-labelledby="xid-link-heading">
      {!compact ? (
        <p id="xid-link-heading" className={styles.introNote}>
          @ を除いた X のユーザー名を入力し、連携申請を送ります。運営承認後に一覧に表示されます。
        </p>
      ) : (
        <span id="xid-link-heading" className="fn-sr-only">
          新しい X ID を申請
        </span>
      )}
      <div className={styles.row}>
        <label htmlFor="xid-input" className="fn-sr-only">
          X ID
        </label>
        <span
          aria-hidden
          className={styles.atMark}
        >
          @
        </span>
        <input
          id="xid-input"
          name="x_id"
          type="text"
          autoComplete="username"
          placeholder="your_x_id"
          required
          maxLength={20}
          pattern="[A-Za-z0-9_]{1,20}"
          title="英数字とアンダースコアのみ、1〜20文字"
          className={styles.input}
          disabled={pending}
        />
        <input type="hidden" name="link_type" value="new" />
        <button
          type="submit"
          className="fn-btn fn-btn-primary fn-btn-sm"
          disabled={pending}
          aria-busy={pending}
        >
          <Icon name="plus" size={12} aria-hidden />
          {pending ? "送信中…" : "連携を申請"}
        </button>
      </div>
      {okMsg ? (
        <p className={styles.msgOk} role="status">
          <Icon name="check" size={13} aria-hidden /> {okMsg}
        </p>
      ) : null}
      {errMsg ? (
        <p className={styles.msgErr} role="alert">
          <Icon name="warning" size={13} aria-hidden /> {errMsg}
        </p>
      ) : null}
    </form>
  );
}

/**
 * 承認済み X ID をアクティブにする (Server Action `setActiveXId`)。
 * `next` が指定されている場合は切替成功後にそのパスへ自動遷移する
 * (例: 投稿フォーム経由で設定画面に来たユーザーをそのまま投稿画面へ戻す)。
 */
export function SetActiveXButton({
  xUserId,
  next,
  label = "アクティブに設定",
  className,
}: {
  xUserId: string;
  next?: string | null;
  label?: string;
  className?: string;
}): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [errMsg, setErrMsg] = React.useState<string | null>(null);

  const onClick = () => {
    setErrMsg(null);
    const fd = new FormData();
    fd.set("x_user_id", xUserId);
    startTransition(async () => {
      const r = await setActiveXId(fd);
      if (r.ok) {
        if (next) router.push(next);
        else router.refresh();
      } else {
        setErrMsg(r.message ?? "切替に失敗しました。");
      }
    });
  };

  return (
    <>
      <button
        type="button"
        className={className ?? "fn-btn fn-btn-ghost fn-btn-sm"}
        disabled={pending}
        onClick={onClick}
        aria-busy={pending}
      >
        {pending ? "設定中…" : label}
      </button>
      {errMsg ? (
        <p className={`${styles.msgErr} ${styles.msgGap}`} role="alert">
          {errMsg}
        </p>
      ) : null}
    </>
  );
}

/** 設定画面のインライン編集用（表示名 + アイコン候補）。 */
export function XIdCompactProfileForm({
  x,
  iconCandidates,
  onCancel,
}: {
  x: {
    id: string;
    x_name: string;
    icon_url: string | null;
    profile_text: string | null;
    portfolio_contact: string | null;
    youtube_channel_url: string | null;
    other_social_links: string | null;
  };
  iconCandidates: string[];
  onCancel: () => void;
}): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    fd.set("x_user_id", x.id);
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await updateXIdProfile(fd);
      if (!result.ok) {
        setError(result.message ?? "更新に失敗しました。");
        return;
      }
      setMessage(result.message ?? "保存しました。");
      router.refresh();
      onCancel();
    });
  };

  return (
    <form className={styles.stack} onSubmit={onSubmit}>
      <input type="hidden" name="x_user_id" value={x.id} />
      <label className={styles.compactLabel}>
        表示名オーバーライド（空欄で @ハンドル表示）
      </label>
      <input
        name="x_name"
        className={styles.input}
        defaultValue={x.x_name}
        placeholder={`@${x.id}`}
        maxLength={80}
        disabled={pending}
      />
      <div className={styles.stack}>
        <span className={styles.compactLabel}>
          アイコン候補（作品サムネから自動取得）
        </span>
        <XIdIconPicker
          xUserId={x.id}
          currentIconUrl={x.icon_url}
          candidates={iconCandidates}
          compact
        />
      </div>
      <label className={styles.compactLabel} htmlFor={`xid-about-${x.id}`}>
        About / 自己紹介
      </label>
      <textarea
        id={`xid-about-${x.id}`}
        name="profile_text"
        className={styles.textarea}
        defaultValue={x.profile_text ?? ""}
        rows={3}
        maxLength={2000}
        placeholder="制作スタイル、得意なこと、活動紹介など"
        disabled={pending}
      />
      <label className={styles.compactLabel} htmlFor={`xid-contact-${x.id}`}>
        Contact / 連絡先
      </label>
      <textarea
        id={`xid-contact-${x.id}`}
        name="portfolio_contact"
        className={styles.textarea}
        defaultValue={x.portfolio_contact ?? ""}
        rows={2}
        maxLength={1200}
        placeholder="依頼・連絡先、メール、フォームURL、DM可否など"
        disabled={pending}
      />
      <div className={styles.fieldGrid}>
        <label className={styles.field}>
          <span className={styles.compactLabel}>YouTube チャンネル</span>
          <input
            name="youtube_channel_url"
            className={styles.input}
            defaultValue={x.youtube_channel_url ?? ""}
            placeholder="https://www.youtube.com/@..."
            disabled={pending}
          />
        </label>
      </div>
      <SocialLinksEditor
        initialValue={x.other_social_links}
        disabled={pending}
      />
      <div className={`${styles.row} ${styles.rowEnd}`}>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          disabled={pending}
          onClick={onCancel}
        >
          キャンセル
        </button>
        <button
          type="submit"
          className="fn-btn fn-btn-primary fn-btn-sm"
          disabled={pending}
        >
          {pending ? "保存中…" : "保存"}
        </button>
      </div>
      {message ? <p className={styles.msgOk}>{message}</p> : null}
      {error ? <p className={styles.msgErr}>{error}</p> : null}
    </form>
  );
}

export function XIdProfileForm({
  x,
  iconCandidates,
}: {
  x: {
    id: string;
    x_name: string;
    icon_url: string | null;
    profile_text: string | null;
    portfolio_contact: string | null;
    youtube_channel_url: string | null;
    other_social_links: string | null;
  };
  iconCandidates: string[];
}): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const run = (
    form: HTMLFormElement,
    action: (fd: FormData) => Promise<{ ok: boolean; message?: string }>,
  ) => {
    const fd = new FormData(form);
    fd.set("x_user_id", x.id);
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await action(fd);
      if (!result.ok) {
        setError(result.message ?? "更新に失敗しました。");
        return;
      }
      setMessage(result.message ?? "更新しました。");
      router.refresh();
    });
  };

  return (
    <form
      className={styles.stack}
      onSubmit={(ev) => {
        ev.preventDefault();
        run(ev.currentTarget, updateXIdProfile);
      }}
    >
      <input type="hidden" name="x_user_id" value={x.id} />
      <div className={styles.stack}>
        <label className={styles.compactLabel}>アイコン</label>
        <XIdIconPicker
          xUserId={x.id}
          currentIconUrl={x.icon_url}
          candidates={iconCandidates}
        />
      </div>
      <div className={styles.row}>
        <input
          name="x_name"
          className={styles.input}
          defaultValue={x.x_name}
          placeholder="表示名 / 活動名"
          maxLength={80}
          required
        />
      </div>
      <textarea
        name="profile_text"
        className={styles.textarea}
        defaultValue={x.profile_text ?? ""}
        rows={3}
        maxLength={2000}
        placeholder="プロフィール・概要"
      />
      <textarea
        name="portfolio_contact"
        className={styles.textarea}
        defaultValue={x.portfolio_contact ?? ""}
        rows={2}
        maxLength={1200}
        placeholder="Contact / 連絡先"
      />
      <div className={styles.fieldGrid}>
        <label className={styles.field}>
          <span className={styles.compactLabel}>YouTube チャンネル</span>
          <input
            name="youtube_channel_url"
            className={styles.input}
            defaultValue={x.youtube_channel_url ?? ""}
            placeholder="https://www.youtube.com/@..."
          />
        </label>
      </div>
      <SocialLinksEditor initialValue={x.other_social_links} />
      <div className={styles.row}>
        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm" disabled={pending}>
          <Icon name="check" size={12} aria-hidden /> プロフィールを保存
        </button>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          disabled={pending}
          onClick={(ev) => {
            const form = ev.currentTarget.form;
            if (form) run(form, enablePortfolio);
          }}
        >
          <Icon name="grid" size={12} aria-hidden /> ポートフォリオを有効化
        </button>
      </div>
      {message ? <p className={styles.msgOk}>{message}</p> : null}
      {error ? <p className={styles.msgErr}>{error}</p> : null}
    </form>
  );
}

function emptySocialLink(): SocialLink {
  return { type: "X", url: "" };
}

function draftSocialLinksJson(links: readonly SocialLink[]): string {
  const rows = links
    .map((link) => ({
      type: link.type.trim() || "Other",
      url: link.url.trim(),
    }))
    .filter((link) => link.url.length > 0);
  return rows.length > 0 ? JSON.stringify(rows) : "";
}

function SocialLinksEditor({
  initialValue,
  disabled = false,
}: {
  initialValue: string | null;
  disabled?: boolean;
}): React.ReactElement {
  const [links, setLinks] = React.useState<SocialLink[]>(() => {
    const parsed = parseSocialLinks(initialValue);
    return parsed.length > 0 ? parsed : [emptySocialLink()];
  });
  const hiddenValue = React.useMemo(() => draftSocialLinksJson(links), [links]);

  const updateLink = (index: number, patch: Partial<SocialLink>) => {
    setLinks((current) =>
      current.map((link, i) => (i === index ? { ...link, ...patch } : link)),
    );
  };

  const removeLink = (index: number) => {
    setLinks((current) => {
      const next = current.filter((_, i) => i !== index);
      return next.length > 0 ? next : [emptySocialLink()];
    });
  };

  return (
    <div className={styles.socialEditor}>
      <input type="hidden" name="other_social_links" value={hiddenValue} />
      <div className={styles.socialEditorHead}>
        <span className={styles.compactLabel}>SNS / 外部リンク</span>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          onClick={() => setLinks((current) => [...current, emptySocialLink()])}
          disabled={disabled || links.length >= 8}
        >
          <Icon name="plus" size={12} aria-hidden />
          追加
        </button>
      </div>
      <div className={styles.socialRows}>
        {links.map((link, index) => (
          <div className={styles.socialRow} key={`${index}-${link.type}`}>
            <label className="fn-sr-only" htmlFor={`social-type-${index}`}>
              SNS種類
            </label>
            <select
              id={`social-type-${index}`}
              className={styles.select}
              value={link.type}
              onChange={(ev) => updateLink(index, { type: ev.currentTarget.value })}
              disabled={disabled}
            >
              {(
                (SOCIAL_LINK_TYPE_OPTIONS as readonly string[]).includes(link.type)
                  ? SOCIAL_LINK_TYPE_OPTIONS
                  : ([link.type, ...SOCIAL_LINK_TYPE_OPTIONS] as const)
              ).map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <label className="fn-sr-only" htmlFor={`social-url-${index}`}>
              SNS URL
            </label>
            <input
              id={`social-url-${index}`}
              type="url"
              className={styles.input}
              value={link.url}
              placeholder="https://..."
              maxLength={500}
              onChange={(ev) => updateLink(index, { url: ev.currentTarget.value })}
              disabled={disabled}
            />
            <button
              type="button"
              className={styles.iconOnlyButton}
              onClick={() => removeLink(index)}
              disabled={disabled}
              aria-label="SNSリンクを削除"
              title="SNSリンクを削除"
            >
              <Icon name="trash" size={13} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function XIdIconPicker({
  xUserId,
  currentIconUrl,
  candidates,
  compact = false,
}: {
  xUserId: string;
  currentIconUrl: string | null;
  candidates: string[];
  compact?: boolean;
}): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"select" | "upload">(
    candidates.length > 0 ? "select" : "upload",
  );
  const [uploadPreview, setUploadPreview] = React.useState<string | null>(null);
  const [uploadFileName, setUploadFileName] = React.useState<string | null>(null);

  React.useEffect(() => {
    return () => {
      if (uploadPreview) window.URL.revokeObjectURL(uploadPreview);
    };
  }, [uploadPreview]);

  const selectedIconUrl = currentIconUrl ?? candidates[0] ?? null;

  const onSelect = (iconUrl: string) => {
    setError(null);
    setMessage(null);
    const fd = new FormData();
    fd.set("x_user_id", xUserId);
    fd.set("icon_url", iconUrl);
    startTransition(async () => {
      const r = await setXIdIcon(fd);
      if (!r.ok) {
        setError(r.message ?? "アイコンの更新に失敗しました。");
        return;
      }
      setMessage(r.message ?? "アイコンを更新しました。");
      router.refresh();
    });
  };

  const onUpload = (file: File | null) => {
    if (!file) return;
    setError(null);
    setMessage(null);
    const fd = new FormData();
    fd.set("x_user_id", xUserId);
    fd.set("icon_file", file);
    startTransition(async () => {
      const r = await uploadXIdIcon(fd);
      if (!r.ok) {
        setError(r.message ?? "アップロードに失敗しました。");
        return;
      }
      setMessage(r.message ?? "アイコンをアップロードしました。");
      router.refresh();
    });
  };

  const onPickUploadFile = (file: File | null) => {
    if (uploadPreview) window.URL.revokeObjectURL(uploadPreview);
    setUploadPreview(file ? window.URL.createObjectURL(file) : null);
    setUploadFileName(file?.name ?? null);
    onUpload(file);
  };

  return (
    <div className={styles.iconPicker}>
      {!compact ? (
        <div className={styles.iconModeSwitch} role="tablist" aria-label="アイコン設定方法">
          <button
            type="button"
            className={`${styles.iconModeButton} ${mode === "select" ? styles.iconModeButtonActive : ""}`}
            onClick={() => setMode("select")}
            disabled={pending || candidates.length === 0}
            aria-selected={mode === "select"}
            role="tab"
          >
            候補から選ぶ
          </button>
          <button
            type="button"
            className={`${styles.iconModeButton} ${mode === "upload" ? styles.iconModeButtonActive : ""}`}
            onClick={() => setMode("upload")}
            disabled={pending}
            aria-selected={mode === "upload"}
            role="tab"
          >
            新規アップロード
          </button>
        </div>
      ) : null}
      {mode === "select" || compact ? (
        <div className={compact ? styles.iconRow : styles.iconGrid}>
          {candidates.length === 0 ? (
            <p className="fn-muted fn-text-sm">
              まだ候補がありません。新しくアップロードするか、作品に設定したアイコンが候補になります。
            </p>
          ) : (
            candidates.map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => onSelect(url)}
                className={`${styles.iconButton} ${url === selectedIconUrl ? styles.iconButtonActive : ""}`}
                disabled={pending}
                aria-pressed={url === selectedIconUrl}
                aria-label="アイコンを選択"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className={styles.iconThumb} />
                {url === selectedIconUrl ? (
                  <span className={styles.iconSelectedMark}>
                    <Icon name="check" size={12} aria-hidden />
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : !compact ? (
        <div className={styles.uploadPanel}>
          <div className={styles.uploadPreview}>
            {uploadPreview ?? selectedIconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={uploadPreview ?? selectedIconUrl ?? ""}
                alt=""
                className={styles.uploadPreviewImage}
              />
            ) : (
              <Icon name="upload" size={22} aria-hidden />
            )}
          </div>
          <div className={styles.uploadBody}>
            <label className="fn-btn fn-btn-ghost fn-btn-sm">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(ev) => onPickUploadFile(ev.currentTarget.files?.[0] ?? null)}
                className={styles.fileInputHidden}
                disabled={pending}
              />
              <Icon name="upload" size={12} aria-hidden /> 画像を選ぶ
            </label>
            <span className={styles.iconHint}>
              250x250 程度の正方形推奨 / PNG・JPEG・WEBP / 2MB まで
            </span>
            {uploadFileName ? (
              <span className={styles.iconHint}>選択中: {uploadFileName}</span>
            ) : null}
          </div>
        </div>
      ) : null}
      {message ? <p className={styles.msgOk}>{message}</p> : null}
      {error ? <p className={styles.msgErr}>{error}</p> : null}
    </div>
  );
}

export function DeleteXIdForm({
  xUserId,
  label = "削除",
  className,
}: {
  xUserId: string;
  label?: string;
  className?: string;
}): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const expected = `DELETE ${xUserId}`;

  const doDelete = () => {
    const fd = new FormData();
    fd.set("x_user_id", xUserId);
    fd.set("confirm", expected);
    setError(null);
    startTransition(async () => {
      const result = await deleteLinkedXId(fd);
      if (!result.ok) {
        setError(result.message ?? "削除に失敗しました。");
        return;
      }
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        className={className ?? "fn-btn fn-btn-ghost fn-btn-sm"}
        disabled={pending}
        onClick={() => setConfirmOpen(true)}
      >
        {label === "削除" ? null : <Icon name="trash" size={12} aria-hidden />}
        {label}
      </button>
      {error ? <p className={styles.msgErr}>{error}</p> : null}

      <ConfirmTextDialog
        open={confirmOpen}
        title="X ID 連携を削除しますか?"
        description={
          <>
            <p style={{ margin: 0 }}>
              この X ID <strong>@{xUserId}</strong> と Discord アカウントの紐付けを解除します。
            </p>
            <ul
              style={{
                margin: "8px 0 0",
                paddingLeft: "1.2em",
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              <li>X ID 自体・過去の作品・履歴は削除されません。</li>
              <li>この Discord アカウントからは編集できなくなります。</li>
              <li>同じ X ID を再連携すれば編集権限は戻ります。</li>
            </ul>
          </>
        }
        expectedText={expected}
        confirmLabel="連携を削除する"
        tone="danger"
        onConfirm={() => {
          setConfirmOpen(false);
          doDelete();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
