import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth/guard";
import { getDatabase } from "@/lib/cloudflare";
import { xUsers as xUsersTable } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { VideoForm } from "@/components/forms/VideoForm";

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
        .limit(200)
    : [];

  return (
    <div
      style={{
        width: "min(96%, 960px)",
        margin: "0 auto",
        padding: "28px 16px 64px",
      }}
    >
      <header style={{ marginBottom: 22 }}>
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          UNSLOTTED POST
        </p>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.04em" }}>
          枠なしで作品を投稿
        </h1>
        <p style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
          イベント枠に紐づかない通常投稿です。枠を確保済みの場合は{" "}
          <Link href="/dashboard/post">投稿方法の選択</Link> から枠あり提出を選んでください。
        </p>
      </header>
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
    </div>
  );
}
