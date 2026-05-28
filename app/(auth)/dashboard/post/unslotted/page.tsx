import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth/guard";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";
import { Icon } from "@/components/ui/Icon";
import { VideoForm } from "@/components/forms/VideoForm";
import { getUsedSoftwareSuggestions } from "@/lib/db/videoFormSuggestions";
import { getXIconCandidates } from "@/lib/db/xIconResolution";
import { AppShell } from "@/components/ui/AppShell";
import { PageHero } from "@/components/ui/PageHero";
import { StatusPanel } from "@/components/ui/StatusPanel";

export const metadata: Metadata = { title: "枠なし投稿" };
export const dynamic = "force-dynamic";

export default async function UnslottedPostPage(): Promise<React.ReactElement> {
  const guard = await requireSession({ next: "/dashboard/post/unslotted" });
  if (!guard.ok) return guard.element;
  const user = guard.user;
  const db = getDatabase();
  const activeX = user.active_x_user_id;
  const xRow =
    db && activeX
      ? (
          await db
            .select()
            .from(xUsersTable)
            .where(eq(xUsersTable.id, activeX))
            .limit(1)
        )[0]
      : null;
  const xIdOptions = db
    ? await db
        .select({ id: xUsersTable.id, x_name: xUsersTable.x_name })
        .from(xUsersTable)
        .where(
          and(
            eq(xUsersTable.linked_discord_user_id, user.id),
            eq(xUsersTable.approval_status, "approved"),
          )!,
        )
        .orderBy(asc(xUsersTable.x_name))
    : [];
  const memberSuggestions = db
    ? await db
        .select({ name: xUsersTable.x_name, x_user_id: xUsersTable.id })
        .from(xUsersTable)
        .orderBy(asc(xUsersTable.x_name))
        .limit(2000)
    : [];
  const softwareSuggestions = db ? await getUsedSoftwareSuggestions(db) : [];
  // 所属イベント候補: 受付中かつ「一般ユーザーの追加紐付け = 許可」のイベントのみ。
  // 投稿者が能動的に複数所属を選べるように。
  // admin / event_editor は本ピッカー経由でなく admin / manage UI から追加するため、
  // ここではフラグでフィルタする (シンプル化)。
  const eventOptions = db
    ? await db
        .select()
        .from(eventsTable)
        .where(eq(eventsTable.is_archived, 0))
        .then((rows) =>
          rows
            .filter(
              (ev) =>
                isAcceptingEntries(ev) && ev.allow_user_video_event_links === 1,
            )
            .map((ev) => ({
              id: ev.id,
              title: ev.title,
              video_form_settings_json: ev.video_form_settings_json,
              parts_json: ev.parts_json,
            })),
        )
    : [];
  const iconCandidates =
    db && activeX ? await getXIconCandidates(db, activeX) : [];

  // 投稿は writeGuard で active_x_user_id が approved であることを要求するため、
  // フォーム送信前に同じ条件を判定して「押せるけど失敗する」状態を防ぐ。
  const activeXApprovalStatus = xRow?.approval_status ?? null;
  const submitBlockedReason: string | undefined = !activeX
    ? "投稿にはActive X IDの選択が必要です。設定画面から連携・選択してください。"
    : activeXApprovalStatus === "pending"
      ? "選択中のActive X IDは承認待ちです。承認後に投稿できます。"
      : activeXApprovalStatus === "rejected"
        ? "選択中のActive X IDは却下されています。設定画面で別のX IDを選択してください。"
        : activeXApprovalStatus !== "approved"
          ? "投稿には承認済みのActive X IDが必要です。設定画面で承認状態を確認してください。"
          : undefined;
  const canPost = !submitBlockedReason;

  return (
    <AppShell size="default">
      <PageHero
        eyebrow="Unslotted Post"
        title="作品を投稿する"
        description="イベント枠に紐づかない通常投稿です。投稿者X IDとYouTube IDを確認してから公開します。"
        actions={
          <Link href="/dashboard/post" className="fn-btn fn-btn-ghost">
            投稿方法を選択
          </Link>
        }
      />

      <StatusPanel
        title={canPost ? "投稿前チェック" : "まだ投稿できません"}
        tone={canPost ? "success" : "warning"}
        action={
          !canPost ? (
            <Link
              href={`/dashboard/settings?next=${encodeURIComponent("/dashboard/post/unslotted")}`}
              className="fn-btn fn-btn-primary"
            >
              X ID設定を確認
            </Link>
          ) : null
        }
      >
        {canPost
          ? `投稿者X ID: @${activeX} / 表示名: ${xRow?.x_name ?? user.name ?? "未設定"}`
          : submitBlockedReason}
      </StatusPanel>
      <VideoForm
        mode="free"
        xIdOptions={xIdOptions}
        activeXId={activeX ?? undefined}
        initial={{
          creator_x_user_id: activeX ?? undefined,
          display_name: xRow?.x_name ?? user.name,
          icon_url: xRow?.icon_url ?? user.image ?? undefined,
          profile_text: xRow?.profile_text ?? undefined,
          youtube_channel_url: xRow?.youtube_channel_url ?? undefined,
          other_social_links: xRow?.other_social_links ?? undefined,
        }}
        memberSuggestions={memberSuggestions}
        softwareSuggestions={softwareSuggestions}
        submitBlockedReason={submitBlockedReason}
        iconCandidates={iconCandidates}
        eventOptions={eventOptions}
      />
      <p
        style={{
          marginTop: 20,
          color: "var(--text-muted)",
          fontSize: 12,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Icon name="info" size={12} aria-hidden />
        利用規約への再同意は提出時に確認します。
      </p>
    </AppShell>
  );
}
