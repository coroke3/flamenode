// MIG-0730 U02b candidate: unmounted read-only view; SA-085 write remains with MIG-0650.
import * as React from "react";
import { AdminVideoMembersResponseSchema, type AdminVideoMembersResponse } from "@flamenode/contracts";
import { MAX_VIDEO_MEMBERS } from "@flamenode/domain/video/atomicLimits";
import { readAdminVideoMembers } from "../../api/adminVideoMembers.js";
import type { OpsFetch, OpsResult } from "../../api/read.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";

/** Display only public participants in the Hono-admin-authorized DTO. Never mount an editor before SA-085 is ready. */
export function AdminVideoMembersReadView({ videoId, data }: {
  videoId: string;
  data: AdminVideoMembersResponse;
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
  // Defense in depth: callers must not be able to bypass the read adapter's
  // public-only verification by handing this view a forged or oversized DTO.
  const rawMembers: unknown = data && typeof data === "object" && !Array.isArray(data)
    ? (data as { initialMembers?: unknown }).initialMembers
    : undefined;
  if (!Array.isArray(rawMembers) || rawMembers.length > MAX_VIDEO_MEMBERS) {
    return <p role="alert">参加者データを表示できません。</p>;
  }
  const parsed = AdminVideoMembersResponseSchema.safeParse(data);
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

export function AdminVideoMembersReadPage({ videoId, fetchFn }: {
  videoId: string;
  fetchFn?: OpsFetch;
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
  if (!result) return <p role="status" aria-busy="true">読み込み中...</p>;
  if (result.status === "notFound") return <p role="alert">作品または公開参加者設定が見つかりません。</p>;
  if (result.status === "anonymous") return <p role="alert">再ログインが必要です。</p>;
  if (result.status === "forbidden") return <p role="alert">参加者設定を表示する権限がありません。</p>;
  if (result.status !== "ok") return <p role="alert">参加者設定を取得できませんでした。</p>;
  return <AdminVideoMembersReadView videoId={videoId} data={result.data} />;
}
