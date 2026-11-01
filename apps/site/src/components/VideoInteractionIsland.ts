import React from "react";
import { toggleInteraction, type InteractionKind } from "../lib/videoInteraction.ts";
import { useVideoViewerOverlay, notifyVideoViewerOverlayChanged } from "../lib/viewerOverlay.ts";

const h = React.createElement;
const ERROR_NETWORK = "操作に失敗しました。通信状態を確認してもう一度お試しください。";
const labels = {
  like: { on: "いいね済", off: "いいね" },
  bookmark: { on: "セーブ済", off: "セーブ" },
} as const;

export interface InteractionPolicy {
  canInteract: boolean;
  disabledReason?: string;
  actionHref?: string;
}

export function interactionPolicy(
  overlay: {
    loggedIn: boolean; isBanned: boolean; isTosAccepted: boolean;
    termsReacceptRequired: boolean; authUnavailable: boolean;
  },
  loading: boolean,
  currentPath: string,
): InteractionPolicy {
  const needsTerms = overlay.loggedIn && (!overlay.isTosAccepted || overlay.termsReacceptRequired);
  const canInteract = !loading && overlay.loggedIn && !overlay.isBanned && !needsTerms && !overlay.authUnavailable;
  if (loading) return { canInteract, disabledReason: "ログイン状態を確認中です。" };
  if (overlay.authUnavailable) return { canInteract, disabledReason: "ログイン状態を一時的に確認できません。時間をおいて再読み込みしてください。" };
  if (!overlay.loggedIn) return { canInteract, disabledReason: "ログインするといいね、セーブができます。", actionHref: `/entry?next=${encodeURIComponent(currentPath)}` };
  if (overlay.isBanned) return { canInteract, disabledReason: "現在、このアカウントは利用停止中です。" };
  if (needsTerms) return { canInteract, disabledReason: "利用規約に同意するといいね、セーブができます。", actionHref: `/rules?next=${encodeURIComponent(currentPath)}` };
  return { canInteract };
}
function actionLabel(href: string | undefined): string {
  if (!href) return "";
  if (href.startsWith("/entry")) return "ログイン";
  if (href.startsWith("/rules")) return "利用規約へ";
  if (href.startsWith("/onboarding")) return "初期設定へ";
  if (href.startsWith("/dashboard/settings")) return "X ID設定へ";
  return "詳細";
}

function InteractionIcon({ kind, active }: { kind: InteractionKind; active: boolean }): React.ReactElement {
  // Same paths and stroke attributes as CURRENT Icon (heart / heart-filled / bookmark / bookmark-filled).
  const path = kind === "like"
    ? "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
    : "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z";
  return h("svg", { width: 13, height: 13, viewBox: "0 0 24 24", "aria-hidden": true, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" },
    h("path", { d: path, ...(active ? { fill: "currentColor" } : {}) }));
}

export function InteractionButton({
  videoId, kind, initialActive, count, policy,
}: {
  videoId: string; kind: InteractionKind; initialActive: boolean;
  count?: number; policy: InteractionPolicy;
}): React.ReactElement {
  const [active, setActive] = React.useState(initialActive);
  const [displayCount, setDisplayCount] = React.useState(count);
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const inFlight = React.useRef(false);
  React.useEffect(() => { setActive(initialActive); }, [initialActive]);
  React.useEffect(() => { setDisplayCount(count); }, [count]);

  const click = () => {
    if (inFlight.current || busy || !policy.canInteract) return;
    inFlight.current = true;
    setError(null);
    const before = active;
    const beforeCount = displayCount;
    const optimistic = !before;
    setActive(optimistic);
    if (kind === "like" && typeof beforeCount === "number") {
      setDisplayCount(Math.max(0, beforeCount + (optimistic ? 1 : -1)));
    }
    startTransition(async () => {
      try {
        const result = await toggleInteraction(videoId, kind);
        if (!result.ok) {
          setActive(before);
          setDisplayCount(beforeCount);
          setError(result.message ?? "操作に失敗しました。");
          return;
        }
        if (typeof result.active === "boolean") {
          setActive(result.active);
          if (kind === "like" && typeof beforeCount === "number" && result.active !== optimistic) {
            setDisplayCount(Math.max(0, beforeCount + Number(result.active) - Number(before)));
          }
        }
        notifyVideoViewerOverlayChanged(videoId);
      } catch (failure) {
        setActive(before);
        setDisplayCount(beforeCount);
        setError(ERROR_NETWORK);
        console.warn("[video-interaction] client write failed", {
          kind, error: failure instanceof Error ? failure.name : "unknown",
        });
      } finally { inFlight.current = false; }
    });
  };

  const meta = labels[kind];
  return h("div", { style: { display: "inline-flex", flexDirection: "column", gap: 2 } },
    h("button", {
      type: "button", onClick: click, disabled: busy || !policy.canInteract,
      "aria-pressed": active, "aria-label": active ? meta.on : meta.off,
      title: !policy.canInteract ? policy.disabledReason : undefined,
      className: `fn-btn ${active ? "fn-btn-primary" : "fn-btn-ghost"} fn-btn-sm`,
    }, h(InteractionIcon, { kind, active }), active ? meta.on : meta.off,
    typeof displayCount === "number" ? h("span", { style: { marginLeft: 4, opacity: 0.7 } }, displayCount) : null),
    !policy.canInteract && (policy.disabledReason || policy.actionHref)
      ? h("span", { style: { fontSize: 11, color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" } },
          policy.disabledReason ? h("span", null, policy.disabledReason) : null,
          policy.actionHref ? h("a", { href: policy.actionHref, style: { color: "var(--accent-primary)", fontWeight: 600, textDecoration: "underline" } }, actionLabel(policy.actionHref)) : null)
      : null,
    error ? h("span", { role: "alert", style: { fontSize: 11, color: "var(--accent-danger)" } }, error) : null);
}

/** Browser-only; parent does not render this subtree into SSG/no-JS HTML. */
export function VideoInteractionIsland({ videoId, likeCount }: { videoId: string; likeCount: number }): React.ReactElement {
  const { overlay, loading } = useVideoViewerOverlay(videoId);
  const currentPath = typeof window === "undefined" ? "/" : window.location.pathname; // CURRENT uses `/${rawId}` (no query) for next=
  const policy = interactionPolicy(overlay, loading, currentPath);
  return h(React.Fragment, null,
    h(InteractionButton, { videoId, kind: "like", initialActive: overlay.likeActive, count: likeCount, policy }),
    h(InteractionButton, { videoId, kind: "bookmark", initialActive: overlay.bookmarkActive, policy }));
}
