import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth/guard";
import { getDatabase } from "@/lib/cloudflare";
import { xUsers as xUsersTable } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { VideoForm } from "@/components/forms/VideoForm";
import { getUsedSoftwareSuggestions } from "@/lib/db/videoFormSuggestions";
import { AppShell } from "@/components/ui/AppShell";
import { PageHero } from "@/components/ui/PageHero";
import { StatusPanel } from "@/components/ui/StatusPanel";

export const metadata: Metadata = { title: "枠なし投稿" };
export const dynamic = "force-dynamic";

export default async function UnslottedPostPage(): Promise<React.ReactElement> {
  const guard = await requireSession();
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
        title={activeX ? "投稿前チェック" : "まだ投稿できません"}
        tone={activeX ? "success" : "warning"}
        action={
          !activeX ? (
            <Link href="/dashboard/settings" className="fn-btn fn-btn-primary">
              X IDを設定
            </Link>
          ) : null
        }
      >
        {activeX
          ? `投稿者X ID: @${activeX} / 表示名: ${xRow?.x_name ?? user.name ?? "未設定"}`
          : "投稿には承認済みのActive X IDが必要です。"}
      </StatusPanel>
      <VideoForm
        mode="free"
        xIdOptions={xIdOptions}
        activeXId={activeX ?? undefined}
        initial={{
          contact_x_id: activeX ?? undefined,
          display_name: xRow?.x_name ?? user.name,
          icon_url: xRow?.icon_url ?? user.image ?? undefined,
          profile_text: xRow?.profile_text ?? undefined,
          youtube_channel_url: xRow?.youtube_channel_url ?? undefined,
          other_social_links: xRow?.other_social_links ?? undefined,
        }}
        memberSuggestions={memberSuggestions}
        softwareSuggestions={softwareSuggestions}
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
