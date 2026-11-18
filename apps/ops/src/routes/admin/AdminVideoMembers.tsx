// MIG-0730 U02b candidate: unmounted read-only view; SA-085 write remains with MIG-0650.
import * as React from "react";
import { AdminVideoMembersResponseSchema, type AdminVideoMembersResponse } from "@flamenode/contracts";
import { MAX_VIDEO_MEMBERS } from "@flamenode/domain/video/atomicLimits";
import { readAdminVideoMembers } from "../../api/adminVideoMembers.js";
import type { OpsFetch, OpsResult } from "../../api/read.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { OpsLink } from "../../components/shared/OpsLink.js";
import { NotFoundView } from "../NotFoundView.js";
import { memberVideoPublicHref } from "./memberVideoPublicHref.js";

/**
 * Cross-PR MIG-0729 (#506) integration seam. The reviewed
 * AdminVideoTabs({ videoId, youtubeVideoId, active }) can be injected only
 * after its owner lands; duplicating six navigation routes here would drift.
 * Neither this optional visual component nor its absence authorizes writes.
 */
export type AdminVideoMembersTabsPort = React.ComponentType<{
  videoId: string;
  youtubeVideoId?: string | null;
  active?: "detail" | "members" | "edit" | "permissions" | "public" | "audit";
}>;

/** Display only public participants in the Hono-admin-authorized DTO. Never mount an editor before SA-085 is ready. */
export function AdminVideoMembersReadView({ videoId, data, managementTabs }: {
  videoId: string;
  data: AdminVideoMembersResponse;
  managementTabs?: AdminVideoMembersTabsPort;
}): React.ReactElement {
  // This view can be called directly, bypassing the GET adapter. Validate the
  // path before reading injected data or constructing a back link.
  if (typeof videoId !== "string" || !videoId || videoId.length > 64 ||
      videoId.trim() !== videoId || videoId === "." || videoId === ".." ||
      /[\/\\\x00-\x1f]/.test(videoId)) {
    return <p role="alert">参加者データを表示できません。</p>;
  }
  let encodedVideoId: string;
  try { encodedVideoId = encodeURIComponent(videoId); }
  catch { return <p role="alert">参加者データを表示できません。</p>; }
  // Defense in depth: direct callers may inject objects with throwing
  // getters or revoked proxies instead of a JSON-decoded DTO. Keep those
  // malformed snapshots out of React's render-error path and out of the DOM.
  // Preserve the early 101-row cap before any nested member traversal.
  let parsed: ReturnType<typeof AdminVideoMembersResponseSchema.safeParse>;
  try {
    const rawMembers: unknown = data && typeof data === "object" && !Array.isArray(data)
      ? (data as { initialMembers?: unknown }).initialMembers
      : undefined;
    if (!Array.isArray(rawMembers) || rawMembers.length > MAX_VIDEO_MEMBERS) {
      return <p role="alert">参加者データを表示できません。</p>;
    }
    // Schema traversal must use the same bounded array checked above.
    parsed = AdminVideoMembersResponseSchema.safeParse({
      video: (data as { video?: unknown }).video,
      initialMembers: rawMembers,
    });
  } catch {
    return <p role="alert">参加者データを表示できません。</p>;
  }
  if (!parsed.success || parsed.data.video.id !== videoId ||
      parsed.data.initialMembers.some(member => member.is_public_member !== 1)) {
    return <p role="alert">参加者データを表示できません。</p>;
  }
  const verified = parsed.data;
  const detailHref = "/admin/videos/" + encodedVideoId;
  const isCollab = verified.video.collaboration_type === "collab" || verified.initialMembers.length > 0;
  return (
    <div className="fn-public-container fn-page">
      <ConsolePageHeader
        title={verified.video.title + " の参加者設定"}
        description="公開参加者と合作設定を確認します。既存のメンバーチャプターは読み取り専用で表示しています。"
        backHref={detailHref}
        backLabel="作品詳細へ"
      />
      {/* MIG-0729's six-tab component is injected by the authorized Ops
          parent only after cross-PR integration. Never render it for a
          401/403/404 or an invalid/private participant snapshot. */}
      {typeof managementTabs === "function" ? React.createElement(managementTabs, {
        videoId: verified.video.id,
        youtubeVideoId: verified.video.youtube_video_id,
        active: "members",
      }) : null}
      <section className="fn-card" aria-label="参加者設定" style={{ padding: 16 }}>
        <h2>参加者設定</h2>
        <p role="status">閲覧のみ：参加者の追加・編集・保存機能は移行中です。</p>
        <p>合作作品：{isCollab ? "ON" : "OFF"}</p>
        <h3>公開参加者（{verified.initialMembers.length}人）</h3>
        {verified.initialMembers.length === 0 ? (
          <p>公開参加者は登録されていません。</p>
        ) : (
          <ol>
            {verified.initialMembers.map((member, index) => (
              <li key={index}>
                <strong>{member.name || member.x_user_id || "名前未設定"}</strong>
                {member.x_user_id ? <span>（@{member.x_user_id}）</span> : null}
                {member.role ? <span> — {member.role}</span> : null}
                {member.comment ? <p>{member.comment}</p> : null}
                {member.chapters.length > 0 ? (
                  <ul aria-label="メンバーチャプター">
                    {member.chapters.map((chapter, chapterIndex) => (
                      <li key={chapterIndex}>{chapter.time} {chapter.label}
                        {chapter.note ? <span> — {chapter.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
      {/* CURRENT AdminVideoMembersForm footer: tabs are separately owned by MIG-0729. */}
      <footer style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <OpsLink href={detailHref} className="fn-btn fn-btn-ghost">詳細へ戻る</OpsLink>
        <a href={memberVideoPublicHref(verified.video)} className="fn-btn fn-btn-ghost"
          target="_blank" rel="noopener noreferrer">公開ページ</a>
      </footer>
    </div>
  );
}

export type AdminVideoMembersReadSnapshot = {
  videoId: string;
  fetchFn?: OpsFetch;
  epoch: number;
  result: OpsResult<AdminVideoMembersResponse>;
};

/** Must not show a previous private snapshot during same-frame A→B→A navigation. */
export function currentAdminVideoMembersResult(
  videoId: string, fetchFn: OpsFetch | undefined,
  epoch: number, snapshot: AdminVideoMembersReadSnapshot | null,
): OpsResult<AdminVideoMembersResponse> | null {
  return snapshot?.videoId === videoId &&
    snapshot.fetchFn === fetchFn &&
    snapshot.epoch === epoch ? snapshot.result : null;
}

export function AdminVideoMembersReadPage({ videoId, fetchFn, onNavigate, managementTabs }: {
  videoId: string;
  fetchFn?: OpsFetch;
  /** Testing port; the actual Ops navigation uses window.location.assign. */
  onNavigate?: (path: string) => void;
  /** Optional MIG-0729 #506 AdminVideoTabs injection, never a write capability. */
  managementTabs?: AdminVideoMembersTabsPort;
}): React.ReactElement {
  const [snapshot, setSnapshot] = React.useState<AdminVideoMembersReadSnapshot | null>(null);
  const identity = React.useRef({ videoId, fetchFn, epoch: 0 });
  if (identity.current.videoId !== videoId || identity.current.fetchFn !== fetchFn) {
    identity.current = { videoId, fetchFn, epoch: identity.current.epoch + 1 };
  }
  const epoch = identity.current.epoch;
  React.useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null);
    void readAdminVideoMembers(videoId, fetchFn, controller.signal).then((result) => {
      if (!controller.signal.aborted) setSnapshot({ videoId, fetchFn, epoch, result });
    });
    return () => controller.abort();
  }, [videoId, fetchFn, epoch]);

  const result = currentAdminVideoMembersResult(videoId, fetchFn, epoch, snapshot);
  // D-17-2: a private read's 401/403 is a navigation decision, not a
  // terminal in-page error. Never redirect from an obsolete A→B→A snapshot.
  // Only /dashboard is a valid admin-read 403 target, even if a generic
  // shared Ops GET client accepts additional redirect destinations.
  const redirectTo = result?.status === "anonymous" ? "/entry"
    : result?.status === "forbidden" ? "/dashboard" : null;
  React.useEffect(() => {
    if (!redirectTo) return;
    if (onNavigate) onNavigate(redirectTo);
    else window.location.assign(redirectTo);
  }, [redirectTo, onNavigate]);

  if (!result) return <p role="status" aria-busy="true">読み込み中...</p>;
  // D-17-2: CURRENT notFound() uses the shared 404 EmptyState, not a local alert.
  if (result.status === "notFound") return <NotFoundView />;
  if (result.status === "anonymous") return <p role="alert">再ログインが必要です。</p>;
  if (result.status === "forbidden") return <p role="alert">参加者設定を表示する権限がありません。</p>;
  if (result.status !== "ok") return <p role="alert">参加者設定を取得できませんでした。</p>;
  return <AdminVideoMembersReadView videoId={videoId} data={result.data} managementTabs={managementTabs} />;
}
