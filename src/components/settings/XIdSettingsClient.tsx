"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import styles from "./XIdSettingsClient.module.css";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  deleteLinkedXId,
  enablePortfolio,
  requestXIdLink,
  setXIdIcon,
  setActiveXId,
  uploadXIdIcon,
  updateXIdProfile,
} from "@/lib/actions/xid";

/** X ID 連携申請フォーム (Server Action `requestXIdLink`)。 */
export function XIdLinkForm(): React.ReactElement {
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
      <p id="xid-link-heading" className="fn-muted fn-text-sm" style={{ margin: 0 }}>
        @ を除いた X のユーザー名を入力し、連携申請を送ります。運営承認後に一覧に表示されます。
      </p>
      <div className={styles.row}>
        <label htmlFor="xid-input" className="fn-sr-only">
          X ID
        </label>
        <span
          aria-hidden
          style={{
            color: "var(--text-muted)",
            fontSize: 14,
            userSelect: "none",
          }}
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

/** 承認済み X ID をアクティブにする (Server Action `setActiveXId`)。 */
export function SetActiveXButton({
  xUserId,
}: {
  xUserId: string;
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
      if (r.ok) router.refresh();
      else setErrMsg(r.message ?? "切替に失敗しました。");
    });
  };

  return (
    <div>
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        disabled={pending}
        onClick={onClick}
        aria-busy={pending}
      >
        {pending ? "切替中…" : "切替"}
      </button>
      {errMsg ? (
        <p className={styles.msgErr} role="alert" style={{ marginTop: 6 }}>
          {errMsg}
        </p>
      ) : null}
    </div>
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
        <label className="fn-label" style={{ fontSize: 12 }}>アイコン</label>
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
        className="fn-input"
        defaultValue={x.profile_text ?? ""}
        rows={3}
        maxLength={1000}
        placeholder="プロフィール・概要"
      />
      <div className={styles.row}>
        <input
          name="youtube_channel_url"
          className={styles.input}
          defaultValue={x.youtube_channel_url ?? ""}
          placeholder="YouTubeチャンネルURL"
        />
        <input
          name="other_social_links"
          className={styles.input}
          defaultValue={x.other_social_links ?? ""}
          placeholder="SNS一覧"
        />
      </div>
      <div className={styles.row}>
        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm" disabled={pending}>
          <Icon name="check" size={12} aria-hidden /> プロフィールを保存
        </button>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          disabled={pending}
          onClick={(ev) => run(ev.currentTarget.form!, enablePortfolio)}
        >
          <Icon name="grid" size={12} aria-hidden /> ポートフォリオを有効化
        </button>
      </div>
      {message ? <p className={styles.msgOk}>{message}</p> : null}
      {error ? <p className={styles.msgErr}>{error}</p> : null}
    </form>
  );
}

function XIdIconPicker({
  xUserId,
  currentIconUrl,
  candidates,
}: {
  xUserId: string;
  currentIconUrl: string | null;
  candidates: string[];
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
      {mode === "select" ? (
        <div className={styles.iconGrid}>
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
                className={`${styles.iconButton} ${url === currentIconUrl ? styles.iconButtonActive : ""}`}
                disabled={pending}
                aria-pressed={url === currentIconUrl}
                aria-label="アイコンを選択"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className={styles.iconThumb} />
                {url === currentIconUrl ? (
                  <span className={styles.iconSelectedMark}>
                    <Icon name="check" size={12} aria-hidden />
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : (
        <div className={styles.uploadPanel}>
          <div className={styles.uploadPreview}>
            {uploadPreview ?? currentIconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={uploadPreview ?? currentIconUrl ?? ""}
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
                style={{ display: "none" }}
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
      )}
      {message ? <p className={styles.msgOk}>{message}</p> : null}
      {error ? <p className={styles.msgErr}>{error}</p> : null}
    </div>
  );
}

export function DeleteXIdForm({ xUserId }: { xUserId: string }): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  const doDelete = () => {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    fd.set("x_user_id", xUserId);
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
    <form ref={formRef} className={styles.stack} onSubmit={(ev) => ev.preventDefault()}>
      <input type="hidden" name="x_user_id" value={xUserId} />
      <label className="fn-label">連携削除の確認</label>
      <input
        name="confirm"
        className="fn-input"
        placeholder={`DELETE ${xUserId}`}
      />
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        disabled={pending}
        onClick={() => setConfirmOpen(true)}
      >
        <Icon name="trash" size={12} aria-hidden /> X ID連携を削除
      </button>
      {error ? <p className={styles.msgErr}>{error}</p> : null}

      <ConfirmDialog
        open={confirmOpen}
        title="X ID 連携を削除しますか?"
        message="この X ID 連携を削除します。作品や履歴は残ります。アクティブ X ID からも外れます。本当に削除しますか?"
        confirmLabel="削除する"
        tone="danger"
        onConfirm={() => {
          setConfirmOpen(false);
          doDelete();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </form>
  );
}
