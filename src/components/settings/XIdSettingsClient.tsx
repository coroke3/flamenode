"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import styles from "./XIdSettingsClient.module.css";
import { Icon } from "@/components/ui/Icon";
import { requestXIdLink, setActiveXId } from "@/lib/actions/xid";

/** X ID 連携申請フォーム (Server Action `requestXIdLink`)。 */
export function XIdLinkForm(): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [okMsg, setOkMsg] = React.useState<string | null>(null);
  const [errMsg, setErrMsg] = React.useState<string | null>(null);

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setOkMsg(null);
    setErrMsg(null);
    startTransition(async () => {
      const r = await requestXIdLink(fd);
      if (r.ok) {
        setOkMsg(
          r.message ??
            "連携申請を受け付けました。承認後、一覧に表示されます。",
        );
        ev.currentTarget.reset();
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
