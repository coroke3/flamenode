"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import styles from "./XIdSettingsClient.module.css";
import { Icon } from "@/components/ui/Icon";
import {
  deleteLinkedXId,
  enablePortfolio,
  requestXIdLink,
  setActiveXId,
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
}: {
  x: {
    id: string;
    x_name: string;
    icon_url: string | null;
    profile_text: string | null;
    youtube_channel_url: string | null;
    other_social_links: string | null;
  };
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
      <div className={styles.row}>
        <input
          name="x_name"
          className={styles.input}
          defaultValue={x.x_name}
          placeholder="表示名 / 活動名"
          maxLength={80}
          required
        />
        <input
          name="icon_url"
          className={styles.input}
          defaultValue={x.icon_url ?? ""}
          placeholder="アイコンURL"
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

export function DeleteXIdForm({ xUserId }: { xUserId: string }): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className={styles.stack}
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!confirm("この X ID 連携を削除します。作品や履歴は残ります。続行しますか?")) {
          return;
        }
        if (!confirm("アクティブ X ID からも外れます。本当に削除しますか?")) return;
        const fd = new FormData(ev.currentTarget);
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
      }}
    >
      <input type="hidden" name="x_user_id" value={xUserId} />
      <label className="fn-label">連携削除の確認</label>
      <input
        name="confirm"
        className="fn-input"
        placeholder={`DELETE ${xUserId}`}
      />
      <button type="submit" className="fn-btn fn-btn-ghost fn-btn-sm" disabled={pending}>
        <Icon name="trash" size={12} aria-hidden /> X ID連携を削除
      </button>
      {error ? <p className={styles.msgErr}>{error}</p> : null}
    </form>
  );
}
