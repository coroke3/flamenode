import * as React from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  slots as slotsTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guard";
import { VideoForm } from "@/components/forms/VideoForm";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = { title: "スロット提出" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ slot?: string }>;
}

export default async function SlottedPostPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const guard = await requireSession();
  if (!guard.ok) return guard.element;
  const user = guard.user;
  const { slot: slotId = "" } = await searchParams;

  const db = getDatabase();
  if (!db) notFound();
  if (!slotId) redirect("/dashboard/post");
  const rows = await db
    .select()
    .from(slotsTable)
    .where(
      and(eq(slotsTable.id, slotId), eq(slotsTable.discord_user_id, user.id))!,
    )
    .limit(1);
  const slot = rows[0];
  if (!slot) notFound();
  if (slot.status === "submitted" && slot.video_id) {
    redirect(`/dashboard/edit/${slot.video_id}`);
  }
  if (slot.status !== "reserved") redirect("/dashboard/post");
  const ev = (
    await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, slot.event_id))
      .limit(1)
  )[0];
  if (!ev) notFound();
  const activeX = slot.x_user_id ?? user.active_x_user_id;
  const xRow = activeX
    ? (
        await db
          .select()
          .from(xUsersTable)
          .where(eq(xUsersTable.id, activeX))
          .limit(1)
      )[0]
    : null;
  const memberSuggestions = await db
    .select({ name: xUsersTable.x_name, x_user_id: xUsersTable.id })
    .from(xUsersTable)
    .orderBy(asc(xUsersTable.x_name))
    .limit(200);

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
          SLOT POST
        </p>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.04em" }}>
          スロット提出
        </h1>
        <p style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
          イベント:
          <Link href={`/event/${ev.id}`}>{ev.title}</Link>
          {slot.start_time ? (
            <>
              {" · "}
              {formatUnix(slot.start_time, { dateOnly: true })}{" "}
              {formatUnix(slot.start_time, { timeOnly: true })}
            </>
          ) : null}
        </p>
      </header>

      <section
        className="fn-card fn-mb-lg"
        style={{ borderColor: "var(--accent-primary)" }}
      >
        <div className="fn-card-body">
          <p className="fn-muted fn-text-xs fn-bold" style={{ letterSpacing: "0.14em" }}>
            RESERVED SLOT
          </p>
          <h2 style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>
            {slot.start_time ? (
              <>
                {formatUnix(slot.start_time, { dateOnly: true })}{" "}
                {formatUnix(slot.start_time, { timeOnly: true })}
                {slot.end_time ? ` - ${formatUnix(slot.end_time, { timeOnly: true })}` : ""}
              </>
            ) : (
              slot.slot_label ?? "時間指定なし枠"
            )}
          </h2>
          <p style={{ marginTop: 8, color: "var(--text-secondary)", fontSize: 13 }}>
            確保名: <strong>{slot.display_name ?? xRow?.x_name ?? user.name}</strong>
            {" / "}
            提出主体: <strong>@{activeX ?? "未設定"}</strong>
          </p>
          {slot.reservation_group_id ? (
            <p className="fn-muted fn-text-sm" style={{ marginTop: 6 }}>
              この枠は連続取得グループに含まれます。提出すると同じ連続枠に同じ作品が紐づきます。
            </p>
          ) : null}
        </div>
      </section>

      <VideoForm
        mode="slot"
        slotId={slot.id}
        initial={{
          contact_x_id: activeX ?? undefined,
          display_name: slot.display_name ?? xRow?.x_name ?? user.name,
          icon_url: xRow?.icon_url ?? user.image ?? undefined,
          profile_text: xRow?.profile_text ?? undefined,
          youtube_channel_url: xRow?.youtube_channel_url ?? undefined,
          other_social_links: xRow?.other_social_links ?? undefined,
        }}
        memberSuggestions={memberSuggestions}
      />

      <p
        style={{
          marginTop: 18,
          color: "var(--text-muted)",
          fontSize: 12,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Icon name="info" size={12} aria-hidden /> 提出した動画は、イベントの
        承認設定によって公開タイミングが変わります。
      </p>
    </div>
  );
}
