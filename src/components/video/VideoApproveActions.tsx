"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { PublicReflectionDelayNotice } from "@/components/ui/PublicReflectionDelayNotice";

type ApproveActionResult = {
  ok: boolean;
  message?: string;
  pendingPublicReflection?: boolean;
  nextHref?: string;
  retryable?: boolean;
};

type ApproveAction = (formData: FormData) => Promise<ApproveActionResult>;

interface VideoApproveActionsProps {
  videoId: string;
  currentStatus: string;
  sourceType?: string | null;
  youtubeVideoId?: string | null;
  approveAction: ApproveAction;
  approveAndNextAction: ApproveAction;
  hiddenFields?: Record<string, string>;
}

const COMMUNICATION_ERROR_MESSAGE =
  "通信エラーが発生しました。状態を再取得してもう一度お試しください。";

export function VideoApproveActions({
  videoId,
  currentStatus,
  sourceType,
  youtubeVideoId = null,
  approveAction,
  approveAndNextAction,
  hiddenFields,
}: VideoApproveActionsProps): React.ReactElement | null {
  const router = useRouter();
  const [pendingMode, setPendingMode] = React.useState<"approve" | "next" | null>(
    null,
  );
  const pendingModeRef = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [pendingPublicReflection, setPendingPublicReflection] =
    React.useState(false);

  if (currentStatus !== "pending") return null;

  const youtubeRequired = sourceType === "youtube" && !youtubeVideoId?.trim();
  if (youtubeRequired) {
    return (
      <p role="status" style={{ color: "var(--accent-warning)", fontSize: 12 }}>
        YouTube URL未設定のため公開できません。投稿者に追加を依頼してください。
      </p>
    );
  }

  const run = (mode: "approve" | "next") => {
    if (pendingMode || pendingModeRef.current) return;
    pendingModeRef.current = true;
    setPendingMode(mode);
    setError(null);
    setSuccess(false);
    setPendingPublicReflection(false);

    const fd = new FormData();
    for (const [key, value] of Object.entries(hiddenFields ?? {})) {
      fd.set(key, value);
    }
    fd.set("video_id", videoId);

    const action = mode === "next" ? approveAndNextAction : approveAction;

    void (async () => {
      try {
        const result = await action(fd);
        if (!result.ok) {
          setError(result.message ?? "承認に失敗しました。");
          if (result.retryable) {
            router.refresh();
          }
          return;
        }
        setSuccess(true);
        setPendingPublicReflection(result.pendingPublicReflection === true);
        if (result.nextHref) {
          router.push(result.nextHref);
        } else {
          router.refresh();
        }
      } catch {
        setError(COMMUNICATION_ERROR_MESSAGE);
        router.refresh();
      } finally {
        pendingModeRef.current = false;
        setPendingMode(null);
      }
    })();
  };

  const pending = pendingMode !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="fn-btn fn-btn-primary fn-btn-sm"
          disabled={pending}
          aria-busy={pendingMode === "approve"}
          onClick={() => run("approve")}
        >
          <Icon name="check" size={12} aria-hidden /> 承認
        </button>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          disabled={pending}
          aria-busy={pendingMode === "next"}
          onClick={() => run("next")}
        >
          <Icon name="chevron-right" size={12} aria-hidden /> 承認して次へ
        </button>
      </div>
      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 12 }}>
          {error}
        </p>
      ) : null}
      {success ? (
        <div role="status" style={{ color: "var(--accent-primary)", fontSize: 12 }}>
          承認しました。
          {pendingPublicReflection ? (
            <div style={{ marginTop: 8 }}>
              <PublicReflectionDelayNotice />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
