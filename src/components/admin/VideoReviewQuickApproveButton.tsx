"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { PublicReflectionDelayNotice } from "@/components/ui/PublicReflectionDelayNotice";

type QuickApproveResult = {
  ok: boolean;
  message?: string;
  pendingPublicReflection?: boolean;
  retryable?: boolean;
};

type QuickApproveAction = (formData: FormData) => Promise<QuickApproveResult>;

interface VideoReviewQuickApproveButtonProps {
  videoId: string;
  action: QuickApproveAction;
  hiddenFields?: Record<string, string>;
}

const COMMUNICATION_ERROR_MESSAGE =
  "通信エラーが発生しました。状態を再取得してもう一度お試しください。";

export function VideoReviewQuickApproveButton({
  videoId,
  action,
  hiddenFields,
}: VideoReviewQuickApproveButtonProps): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [pendingPublicReflection, setPendingPublicReflection] =
    React.useState(false);

  const onApprove = () => {
    if (pending) return;
    setError(null);
    setPendingPublicReflection(false);
    const fd = new FormData();
    for (const [key, value] of Object.entries(hiddenFields ?? {})) {
      fd.set(key, value);
    }
    fd.set("video_id", videoId);

    startTransition(async () => {
      try {
        const result = await action(fd);
        if (!result.ok) {
          setError(result.message ?? "承認に失敗しました。");
          if (result.retryable) {
            router.refresh();
          }
          return;
        }
        setPendingPublicReflection(result.pendingPublicReflection === true);
        router.refresh();
      } catch {
        setError(COMMUNICATION_ERROR_MESSAGE);
        router.refresh();
      }
    });
  };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <button
        type="button"
        className="fn-btn fn-btn-primary fn-btn-sm"
        disabled={pending}
        aria-busy={pending}
        onClick={onApprove}
      >
        <Icon name="check" size={11} aria-hidden /> 承認
      </button>
      {error ? (
        <span role="alert" style={{ color: "var(--accent-danger)", fontSize: 10 }}>
          {error}
        </span>
      ) : null}
      {pendingPublicReflection ? (
        <span style={{ maxWidth: 220 }}>
          <PublicReflectionDelayNotice />
        </span>
      ) : null}
    </span>
  );
}
