import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import type { VideoPublicMemberCandidate } from "@/components/admin/VideoCollabPermsManager";
import { AdminVideoTabs } from "@/components/admin/AdminVideoTabs";
import { VideoCollabPermsManager } from "@/components/admin/VideoCollabPermsManager";
import { getDatabase } from "@/lib/cloudflare";
import { videoMembers, videos as videosTable } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guard";
import {
  canEditVideo,
  canUseEventPrivilegeModeForVideo,
} from "@/lib/auth/ownership";
import { loadVideoCollabSubjects } from "@/lib/video/collabPerms";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "編集権限の管理" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ privileged?: string }>;
}

type PrivilegeMode = "normal" | "admin" | "event";

function normalizePrivilegeMode(raw: string | undefined): PrivilegeMode {
  return raw === "admin" || raw === "event" ? raw : "normal";
}

function privilegedQuery(mode: PrivilegeMode): string {
  return mode === "normal" ? "" : `?privileged=${mode}`;
}

export default async function EditVideoPermissionsPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const requestedMode = normalizePrivilegeMode(sp.privileged);
  const guard = await requireSession({
    next: `/dashboard/edit/${encodeURIComponent(id)}/permissions`,
  });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  if (!db) notFound();

  const video = (
    await db.select().from(videosTable).where(eq(videosTable.id, id)).limit(1)
  )[0];
  if (!video) notFound();

  const editUser = { id: user.id, role: user.role ?? null };
  const canOfferEventMode = await canUseEventPrivilegeModeForVideo({
    db,
    user: editUser,
    video,
  });

  // 管理者以外が ?privileged=admin を付けても normal にフォールバック。
  // event モードは canUseEventPrivilegeModeForVideo が true のときだけ。
  let privilegeMode: PrivilegeMode = "normal";
  if (requestedMode === "admin" && user.role === "admin") {
    privilegeMode = "admin";
  } else if (requestedMode === "event" && canOfferEventMode) {
    privilegeMode = "event";
  }

  const canEditPermissions = await canEditVideo({
    db,
    user: editUser,
    video,
    requiredKey: "video.permissions",
    privilegeMode,
  });
  if (!canEditPermissions) {
    return (
      <div className="fn-public-container fn-page fn-guard-shell">
        <div className="fn-empty fn-guard-card">
          <h1 className="fn-guard-title">編集権限がありません</h1>
          <p className="fn-empty-message">
            共同編集権限を管理する権限がありません。作品の作者、または
            video.permissions を持つ運営・管理者のみ設定できます。
          </p>
          <Link
            href={`/dashboard/edit/${id}${privilegedQuery(privilegeMode)}`}
            className="fn-btn fn-btn-ghost fn-btn-sm fn-mt-md"
          >
            作品編集へ戻る
          </Link>
        </div>
      </div>
    );
  }

  const memberRows = await db
    .select({
      x_user_id: videoMembers.x_user_id,
      name: videoMembers.name,
      role: videoMembers.role,
      can_edit: videoMembers.can_edit,
    })
    .from(videoMembers)
    .where(
      and(eq(videoMembers.video_id, video.id), eq(videoMembers.is_public_member, 1))!,
    )
    .orderBy(videoMembers.order_index);

  const publicMembersForCollab: VideoPublicMemberCandidate[] = memberRows.map(
    (m) => ({
      x_user_id: m.x_user_id,
      display_name: m.name,
      role: m.role,
      can_edit: m.can_edit,
    }),
  );

  const { subjects: videoCollabSubjects, tableAvailable: videoCollabTableAvailable } =
    await loadVideoCollabSubjects(db, video.id);

  const pq = privilegedQuery(privilegeMode);
  const editHref = `/dashboard/edit/${encodeURIComponent(id)}${pq}`;

  const showCollabSection =
    videoCollabTableAvailable &&
    (video.collaboration_type === "collab" || videoCollabSubjects.length > 0);

  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head">
        <p className="fn-eyebrow">
          <Link href={editHref}>← 作品編集へ戻る</Link>
        </p>
        <h1 className="fn-page-title fn-page-title--compact">編集できる人を管理</h1>
        <p className="fn-page-lead">
          作品「{video.title}」を編集できる人を設定します。
          公開メンバーとして表示するかどうかとは別です。
        </p>
      </header>

      {privilegeMode === "admin" && user.role === "admin" ? (
        <AdminVideoTabs
          videoId={video.id}
          youtubeVideoId={video.youtube_video_id}
          active="permissions"
        />
      ) : null}

      {!videoCollabTableAvailable ? (
        <section className="fn-card">
          <div className="fn-card-body">
            <p className="fn-text-muted-sm">
              ローカル DB に video_members.can_edit がありません。
              <code> npm run db:local-apply </code>
              で migration を適用してください。
            </p>
          </div>
        </section>
      ) : !showCollabSection ? (
        <section className="fn-card">
          <div className="fn-card-body">
            <p className="fn-text-muted-sm">
              この作品は個人投稿のため、合作向けの編集権限管理は不要です。
            </p>
          </div>
        </section>
      ) : (
        <section className="fn-card">
          <div className="fn-card-body">
            <VideoCollabPermsManager
              videoId={video.id}
              videoTitle={video.title}
              subjects={videoCollabSubjects}
              publicMembers={publicMembersForCollab}
              editPrivilegeMode={privilegeMode}
            />
          </div>
        </section>
      )}

      <p className="fn-page-footnote">
        <Icon name="info" size={12} aria-hidden />
        監査ログは管理者向け画面で確認できます。通常の作品編集は
        <Link href={editHref}>編集ページ</Link>
        から行ってください。
      </p>
    </div>
  );
}
