import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  slots as slotsTable,
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
  if (!db || !slotId) notFound();
  const rows = await db
    .select()
    .from(slotsTable)
    .where(
      and(eq(slotsTable.id, slotId), eq(slotsTable.discord_user_id, user.id))!,
    )
    .limit(1);
  const slot = rows[0];
  if (!slot) notFound();
  const ev = (
    await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, slot.event_id))
      .limit(1)
  )[0];
  if (!ev) notFound();

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

      <VideoForm mode="slot" slotId={slot.id} />

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
