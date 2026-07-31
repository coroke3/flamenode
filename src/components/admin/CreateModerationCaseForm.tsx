"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { SaveSuccessNotice } from "@/components/ui/SaveSuccessNotice";
import { createModerationCase } from "@/lib/actions/moderation-admin";

interface Props {
  videoId: string;
}

export function CreateModerationCaseForm({ videoId }: Props): React.ReactElement {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<{
    message: string;
    pendingPublicReflection?: boolean;
  } | null>(null);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createModerationCase(formData);
      if (!result.ok) {
        setError(result.message ?? "ケースの作成に失敗しました。");
        return;
      }
      setSuccess({
        message: result.message ?? "case を作成しました。",
        pendingPublicReflection: result.pendingPublicReflection,
      });
      formRef.current?.reset();
      router.refresh();
    });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} style={{ display: "grid", gap: 8 }}>
      <input type="hidden" name="video_id" value={videoId} />
      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        種別
        <select name="case_type" className="fn-select" defaultValue="rights" disabled={pending}>
          <option value="rights">rights: 権利・楽曲・素材確認</option>
          <option value="duplicate">duplicate: 重複投稿</option>
          <option value="void">void: 一時停止・確認中</option>
          <option value="x_reapply">x_reapply: X ID再申請</option>
          <option value="operator">operator: 運営判断</option>
        </select>
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        公開理由
        <textarea
          name="public_reason"
          className="fn-input"
          rows={2}
          maxLength={1000}
          placeholder="ユーザーに見せてもよい理由"
          disabled={pending}
        />
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        内部メモ
        <textarea
          name="private_note"
          className="fn-input"
          rows={2}
          maxLength={2000}
          placeholder="運営内メモ"
          disabled={pending}
        />
      </label>
      <div className="admin-video-review-meta-grid" style={{ display: "grid", gap: 8 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
          期限
          <input type="datetime-local" name="due_at" className="fn-input" disabled={pending} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
          関連X ID
          <input
            name="related_x_user_id"
            className="fn-input"
            placeholder="@x_id"
            maxLength={40}
            disabled={pending}
          />
        </label>
      </div>
      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        起票時の作品状態
        <select name="video_status" className="fn-select" defaultValue="" disabled={pending}>
          <option value="">変更しない</option>
          <option value="voided">voided: 一時的に公開停止</option>
          <option value="pending">pending: 再確認待ち</option>
        </select>
      </label>
      {error ? (
        <p
          role="alert"
          className="fn-badge fn-badge-danger"
          style={{ justifySelf: "start", whiteSpace: "pre-wrap" }}
        >
          {error}
        </p>
      ) : null}
      {success ? (
        <SaveSuccessNotice
          message={success.message}
          pendingPublicReflection={success.pendingPublicReflection}
          style={{ fontSize: 12 }}
        />
      ) : null}
      <button
        type="submit"
        className="fn-btn fn-btn-primary"
        aria-label="モデレーションケースを作成"
        disabled={pending}
      >
        <Icon name="warning" size={12} aria-hidden />{" "}
        {pending ? "作成中..." : "ケースを作成"}
      </button>
    </form>
  );
}
