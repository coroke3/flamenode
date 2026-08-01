"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import styles from "./XIdSettingsClient.module.css";
import { Icon } from "@/components/ui/Icon";
import { deleteLinkedXId, requestXIdLink, setXIdIcon, setActiveXId, uploadXIdIcon, updateXIdProfile } from "@/lib/actions/xid";
import { parseXIdentityInput } from "@/lib/utils/xid";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { YoutubeChannelPicker } from "@/components/settings/YoutubeChannelPicker";
import { SocialLinksEditor } from "@/components/forms/SocialLinksEditor";

/** 初回・追加を問わず同じ入力で送るX ID連携申請フォーム。 */
export function XIdLinkForm({
  compact = false,
  onSuccessRedirect,
}: {
  compact?: boolean;
  onSuccessRedirect?: string | null;
} = {}): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [okMsg, setOkMsg] = React.useState<string | null>(null);
  const [errMsg, setErrMsg] = React.useState<string | null>(null);
  const [rawInput, setRawInput] = React.useState("");
  const preview = parseXIdentityInput(rawInput);

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!preview) {
      setErrMsg(
        "@username、username、または x.com / twitter.com のプロフィール URL を入力してください。",
      );
      return;
    }
    const fd = new FormData();
    fd.set("request_type", "link");
    fd.set("x_id", rawInput);
    setOkMsg(null);
    setErrMsg(null);
    startTransition(async () => {
      try {
        const result = await requestXIdLink(fd);
        if (result.ok) {
          setOkMsg(result.message ?? "X ID申請を受け付けました。");
          setRawInput("");
          if (onSuccessRedirect) router.push(onSuccessRedirect);
          else router.refresh();
        } else {
          setErrMsg(result.message ?? "申請に失敗しました。");
        }
      } catch {
        setErrMsg("申請の保存に失敗しました。時間をおいて再試行してください。");
      }
    });
  };

  return (
    <form className={styles.stack} onSubmit={onSubmit} aria-labelledby="xid-link-heading">
      {!compact ? (
        <p id="xid-link-heading" className={styles.introNote}>
          X IDを連携します。2件目以降も同じ方法で申請でき、運営承認後に反映されます。
        </p>
      ) : (
        <span id="xid-link-heading" className="fn-sr-only">X IDを連携</span>
      )}
      <label className={styles.compactLabel} htmlFor="xid-input">
        連携する X ID
      </label>
      <div className={styles.row}>
        <span aria-hidden className={styles.atMark}>@</span>
        <input
          id="xid-input"
          name="x_id"
          type="text"
          autoComplete="username"
          placeholder="username または https://x.com/username"
          required
          className={styles.input}
          disabled={pending}
          value={rawInput}
          onChange={(e) => {
            setRawInput(e.target.value);
            setErrMsg(null);
          }}
        />
      </div>
      {rawInput && preview ? (
        <p className={styles.msgOk} role="status">
          申請名義: @{preview}
        </p>
      ) : null}
      <button
        type="submit"
        className="fn-btn fn-btn-primary fn-btn-sm"
        disabled={pending || !preview}
        aria-busy={pending}
      >
        <Icon name="plus" size={12} aria-hidden />
        {pending ? "送信中…" : "X IDを連携"}
      </button>
      {okMsg ? <p className={styles.msgOk} role="status"><Icon name="check" size={13} aria-hidden /> {okMsg}</p> : null}
      {errMsg ? <p className={styles.msgErr} role="alert"><Icon name="warning" size={13} aria-hidden /> {errMsg}</p> : null}
    </form>
  );
}

/** 承認済みの自分のX ID同士を統合申請する設定画面専用フォーム。 */
export function XIdMergeForm({
  linkedXIds,
}: {
  linkedXIds: readonly { id: string; label: string }[];
}): React.ReactElement | null {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [okMsg, setOkMsg] = React.useState<string | null>(null);
  const [errMsg, setErrMsg] = React.useState<string | null>(null);

  if (linkedXIds.length < 2) return null;

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    fd.set("request_type", "merge");
    setOkMsg(null);
    setErrMsg(null);
    startTransition(async () => {
      try {
        const result = await requestXIdLink(fd);
        if (result.ok) {
          setOkMsg(result.message ?? "X ID統合申請を受け付けました。");
          router.refresh();
        } else {
          setErrMsg(result.message ?? "統合申請に失敗しました。");
        }
      } catch {
        setErrMsg("申請の保存に失敗しました。時間をおいて再試行してください。");
      }
    });
  };

  return (
    <form className={styles.stack} onSubmit={onSubmit} aria-labelledby="xid-merge-heading">
      <p id="xid-merge-heading" className={styles.introNote}>
        連携済みのX ID同士を1つの名義へ統合します。運営承認後に反映されます。
      </p>
      <label className={styles.compactLabel}>
        統合元 X ID
        <select
          name="x_id"
          className={styles.input}
          defaultValue={linkedXIds[0].id}
          disabled={pending}
        >
          {linkedXIds.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
      </label>
      <label className={styles.compactLabel}>
        統合先 X ID
        <select
          name="target_x_user_id"
          className={styles.input}
          defaultValue={linkedXIds[1].id}
          disabled={pending}
        >
          {linkedXIds.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        disabled={pending}
        aria-busy={pending}
      >
        <Icon name="refresh" size={12} aria-hidden />
        {pending ? "送信中…" : "統合を申請"}
      </button>
      {okMsg ? <p className={styles.msgOk} role="status"><Icon name="check" size={13} aria-hidden /> {okMsg}</p> : null}
      {errMsg ? <p className={styles.msgErr} role="alert"><Icon name="warning" size={13} aria-hidden /> {errMsg}</p> : null}
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
  channelCandidates,
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
  channelCandidates: string[];
  onCancel?: () => void;
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
      onCancel?.();
    });
  };

  return (
    <form key={x.id} className={styles.stack} onSubmit={onSubmit}>
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
          key={x.id}
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
        <div className={styles.field}>
          <span className={styles.compactLabel}>
            YouTube チャンネル（過去の作品から候補を表示）
          </span>
          <YoutubeChannelPicker
            key={x.id}
            defaultValue={x.youtube_channel_url}
            candidates={channelCandidates}
            disabled={pending}
          />
        </div>
      </div>
      <SocialLinksEditor
        key={x.id}
        initialValue={x.other_social_links}
        disabled={pending}
      />
      <div className={`${styles.row} ${styles.rowEnd}`}>
        {onCancel ? (
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            disabled={pending}
            onClick={onCancel}
          >
            キャンセル
          </button>
        ) : null}
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
}function XIdIconPicker({
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

  const iconUploadInput = (
    <label
      className={`${styles.iconButton} ${styles.iconAddButton} ${pending ? styles.iconAddButtonDisabled : ""}`}
      title="画像をアップロード"
    >
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(ev) => {
          onPickUploadFile(ev.currentTarget.files?.[0] ?? null);
          ev.currentTarget.value = "";
        }}
        className={styles.fileInputHidden}
        disabled={pending}
        aria-label="画像をアップロード"
      />
      <Icon name="plus" size={18} aria-hidden />
    </label>
  );

  const iconChoices = (
    <>
      <div className={compact ? styles.iconRow : styles.iconGrid}>
        {candidates.map((url) => (
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
        ))}
        {iconUploadInput}
      </div>
      {candidates.length === 0 ? (
        <p className="fn-muted fn-text-sm">
          まだ候補がありません。＋からアップロードするか、作品に設定したアイコンが候補になります。
        </p>
      ) : null}
    </>
  );

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
      {mode === "select" || compact ? iconChoices : !compact ? (
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

      <ConfirmDialog
        open={confirmOpen}
        title="X ID 連携を削除しますか?"
        message={
          <>
            <p style={{ margin: 0 }}>
              この X ID <strong>@{xUserId}</strong> とDiscordアカウントの紐付けを解除します。
            </p>
            <ul
              style={{
                margin: "8px 0 0",
                paddingLeft: "1.2em",
                fontSize: 12,
              }}
            >
              <li>X ID自体・過去の作品・履歴は削除されません。</li>
              <li>このDiscordアカウントからは編集できなくなります。</li>
              <li>同じX IDを再連携すれば編集権限は戻ります。</li>
            </ul>
          </>
        }
        expectedText={expected}
        confirmLabel="連携を削除する"
        tone="danger"
        busy={pending}
        onConfirm={() => {
          setConfirmOpen(false);
          doDelete();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
