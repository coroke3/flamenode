"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import { toggleVideoInteraction } from "@/lib/actions/video";
import { cn } from "@/lib/utils/cn";

interface InteractionButtonProps {
  videoId: string;
  kind: "like" | "bookmark";
  initialActive: boolean;
  count?: number;
  canInteract?: boolean;
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

/**
 * いいね・ブックマークのトグルボタン。
 * ログイン必須、`canInteract = false` のときはアラート文を出す。
 */
export function InteractionButton({
  videoId,
  kind,
  initialActive,
  count,
  canInteract = true,
  className,
}: InteractionButtonProps): React.ReactElement {
  const router = useRouter();
  const [active, setActive] = React.useState(initialActive);
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const meta = LABELS[kind];

  const onClick = () => {
    if (busy) return;
    if (!canInteract) {
      setError("ログインと X ID 選択が必要です。");
      return;
    }
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

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-pressed={active}
        aria-label={active ? meta.on : meta.off}
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
