"use client";

import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";
import { toggleVideoInteraction } from "@/lib/actions/video";
import { notifyVideoViewerOverlayChanged } from "@/lib/video/videoViewerOverlayClient";
import { cn } from "@/lib/utils/cn";

interface InteractionButtonProps {
  videoId: string;
  kind: "like" | "bookmark";
  initialActive: boolean;
  count?: number;
  /**
   * いいね・セーブが実行可能か。サーバー側 writeGuard はログインと TOS 同意を要求し、
   * Auth user 単位の `video_interactions_auth` へ保存する (Active X ID は不要)。
   * 未ログイン / 規約未同意のときは false。
   */
  canInteract?: boolean;
  disabledReason?: string;
  actionHref?: string;
  actionLabel?: string;
  className?: string;
}

const LABELS: Record<
  InteractionButtonProps["kind"],
  { on: string; off: string; icon: IconName; iconOn: IconName }
> = {
  like: {
    on: "いいね済",
    off: "いいね",
    icon: "heart",
    iconOn: "heart-filled",
  },
  bookmark: {
    on: "セーブ済",
    off: "セーブ",
    icon: "bookmark",
    iconOn: "bookmark-filled",
  },
};

function inferActionLabel(href: string | undefined): string {
  if (!href) return "";
  if (href.startsWith("/entry")) return "ログイン";
  if (href.startsWith("/rules")) return "利用規約へ";
  if (href.startsWith("/onboarding")) return "初期設定へ";
  if (href.startsWith("/dashboard/settings")) return "X ID設定へ";
  return "詳細";
}

/**
 * いいね・ブックマークのトグルボタン。
 * 成功後にrouter.refresh()を行わず、server action結果でローカル状態を更新する。
 * viewer overlayは狭いAPIだけを共有再取得し、library playlist等も同期する。
 */
export function InteractionButton({
  videoId,
  kind,
  initialActive,
  count,
  canInteract = true,
  disabledReason,
  actionHref,
  actionLabel,
  className,
}: InteractionButtonProps): React.ReactElement {
  const [active, setActive] = React.useState(initialActive);
  const [displayCount, setDisplayCount] = React.useState(count);
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const actionInFlightRef = React.useRef(false);

  React.useEffect(() => {
    setActive(initialActive);
  }, [initialActive]);
  React.useEffect(() => {
    setDisplayCount(count);
  }, [count]);

  const meta = LABELS[kind];

  const onClick = () => {
    // transitionのbusy反映前にdouble clickされてもserver actionを二重送信しない。
    if (actionInFlightRef.current || busy || !canInteract) return;
    actionInFlightRef.current = true;
    setError(null);
    const fd = new FormData();
    fd.set("video_id", videoId);
    fd.set("kind", kind);

    const previousActive = active;
    const previousCount = displayCount;
    const optimisticActive = !previousActive;
    setActive(optimisticActive);
    if (kind === "like" && typeof previousCount === "number") {
      setDisplayCount(
        Math.max(0, previousCount + (optimisticActive ? 1 : -1)),
      );
    }

    startTransition(async () => {
      try {
        const result = await toggleVideoInteraction(fd);
        if (!result.ok) {
          setActive(previousActive);
          setDisplayCount(previousCount);
          setError(result.message ?? "操作に失敗しました。");
          return;
        }

        if (typeof result.active === "boolean") {
          setActive(result.active);
          if (
            kind === "like" &&
            typeof previousCount === "number" &&
            result.active !== optimisticActive
          ) {
            // server確定状態と操作前状態の差分だけを件数へ反映する。
            // 例: 操作前ON→楽観OFF→server ONなら元件数へ戻す（+1しない）。
            setDisplayCount(
              Math.max(
                0,
                previousCount +
                  (result.active ? 1 : 0) -
                  (previousActive ? 1 : 0),
              ),
            );
          }
        }

        notifyVideoViewerOverlayChanged(videoId);
      } catch (writeError) {
        setActive(previousActive);
        setDisplayCount(previousCount);
        setError("操作に失敗しました。通信状態を確認してもう一度お試しください。");
        console.warn("[video-interaction] client write failed", {
          kind,
          error: writeError instanceof Error ? writeError.name : "unknown",
        });
      } finally {
        actionInFlightRef.current = false;
      }
    });
  };

  const label = actionLabel ?? inferActionLabel(actionHref);

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy || !canInteract}
        aria-pressed={active}
        aria-label={active ? meta.on : meta.off}
        title={!canInteract ? disabledReason : undefined}
        className={cn(
          "fn-btn",
          active ? "fn-btn-primary" : "fn-btn-ghost",
          "fn-btn-sm",
          className,
        )}
      >
        <Icon name={active ? meta.iconOn : meta.icon} size={13} aria-hidden />
        {active ? meta.on : meta.off}
        {typeof displayCount === "number" ? (
          <span style={{ marginLeft: 4, opacity: 0.7 }}>{displayCount}</span>
        ) : null}
      </button>
      {!canInteract && (disabledReason || actionHref) ? (
        <span
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            flexWrap: "wrap",
          }}
        >
          {disabledReason ? <span>{disabledReason}</span> : null}
          {actionHref ? (
            <Link
              href={actionHref}
              style={{
                color: "var(--accent-primary)",
                fontWeight: 600,
                textDecoration: "underline",
              }}
              prefetch={false}
            >
              {label}
            </Link>
          ) : null}
        </span>
      ) : null}
      {error ? (
        <span
          role="alert"
          style={{ fontSize: 11, color: "var(--accent-danger)" }}
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}
