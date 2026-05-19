"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import { toggleVideoInteraction } from "@/lib/actions/video";
import { cn } from "@/lib/utils/cn";

interface InteractionButtonProps {
  videoId: string;
  kind: "like" | "bookmark";
  initialActive: boolean;
  count?: number;
  /**
   * いいね・セーブが実行可能か。サーバー側 writeGuard は承認済み Active X ID を要求するため、
   * `viewerXApproved` を渡すのが正しい。`!!viewerActiveX` で渡すと未承認 X ID の状態で
   * 「押せるけど失敗する」になるので注意。
   */
  canInteract?: boolean;
  /**
   * 押せない理由文。`canInteract = false` のときボタン下に出る (未指定なら出さない)。
   */
  disabledReason?: string;
  /**
   * 押せないときの CTA リンク先。未ログインなら `/entry?next=...`、未承認なら
   * `/dashboard/settings?next=...` を渡す想定。
   */
  actionHref?: string;
  /** CTA リンクのラベル (省略時は actionHref から自動推定)。 */
  actionLabel?: string;
  className?: string;
}

const LABELS: Record<InteractionButtonProps["kind"], { on: string; off: string; icon: IconName; iconOn: IconName }> = {
  like: { on: "いいね済", off: "いいね", icon: "heart", iconOn: "heart-filled" },
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
  if (href.startsWith("/dashboard/settings")) return "X ID設定へ";
  return "詳細";
}

/**
 * いいね・ブックマークのトグルボタン。
 * `canInteract = false` のときはボタンを disabled にし、必要に応じて CTA リンクを出す。
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
  const router = useRouter();
  const [active, setActive] = React.useState(initialActive);
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const meta = LABELS[kind];

  const onClick = () => {
    if (busy) return;
    if (!canInteract) return;
    setError(null);
    const fd = new FormData();
    fd.set("video_id", videoId);
    fd.set("kind", kind);
    const previous = active;
    setActive((a) => !a);
    startTransition(async () => {
      const r = await toggleVideoInteraction(fd);
      if (!r.ok) {
        setActive(previous);
        setError(r.message ?? "操作に失敗しました。");
      } else {
        if (typeof r.active === "boolean") setActive(r.active);
        router.refresh();
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
        {typeof count === "number" ? (
          <span style={{ marginLeft: 4, opacity: 0.7 }}>{count}</span>
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
            >
              {label}
            </Link>
          ) : null}
        </span>
      ) : null}
      {error ? (
        <span
          role="alert"
          style={{
            fontSize: 11,
            color: "var(--accent-danger)",
          }}
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}
