import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, eq, like, or, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { events as eventsTable, videos, xUsers } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";

export const metadata: Metadata = { title: "検索" };
export const dynamic = "force-dynamic";

const VIDEO_LIMIT = 18;
const CREATOR_LIMIT = 12;
const EVENT_LIMIT = 8;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<React.ReactElement> {
  const { q = "" } = await searchParams;
  const keyword = q.trim();
  const db = getDatabase();

  let foundVideos: VideoCardData[] = [];
  let foundCreators: {
    id: string;
    x_name: string;
    icon_url: string | null;
  }[] = [];
  let foundEvents: { id: string; title: string; explanation: string | null }[] =
    [];

  if (db && keyword) {
    const term = `%${keyword.replace(/[%_]/g, (m) => "\\" + m)}%`;
    const publicBase = and(
      eq(videos.status, "public"),
      eq(videos.is_deleted, 0),
      eq(videos.is_manual_hidden, 0),
    );
    try {
      foundVideos = (await db
        .select({
          id: videos.id,
          title: videos.title,
          youtube_video_id: videos.youtube_video_id,
          display_name: sql<string>`COALESCE(${xUsers.x_name}, ${videos.display_name}, ${videos.contact_x_id})`,
          icon_url: sql<string | null>`COALESCE(${videos.icon_url}, ${xUsers.icon_url})`,
          creator_id: videos.creator_id,
          primary_event_id: videos.primary_event_id,
          scheduled_time: videos.scheduled_time,
          status: videos.status,
        })
        .from(videos)
        .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
        .where(
          and(
            publicBase,
            or(
              like(videos.title, term),
              like(videos.display_name, term),
              like(videos.music, term),
            )!,
          )!,
        )
        .limit(VIDEO_LIMIT)) as VideoCardData[];

      foundCreators = await db
        .select({
          id: xUsers.id,
          x_name: xUsers.x_name,
          icon_url: xUsers.icon_url,
        })
        .from(xUsers)
        .where(
          and(
            or(eq(xUsers.approval_status, "approved"), eq(xUsers.approval_status, "pending"))!,
            or(like(xUsers.x_name, term), like(xUsers.id, term))!,
          )!,
        )
        .limit(CREATOR_LIMIT);

      foundEvents = await db
        .select({
          id: eventsTable.id,
          title: eventsTable.title,
          explanation: eventsTable.explanation,
        })
        .from(eventsTable)
        .where(
          or(like(eventsTable.title, term), like(eventsTable.explanation, term))!,
        )
        .limit(EVENT_LIMIT);
    } catch (e) {
      console.error("[SearchPage] failed", e);
    }
  }

  const totalHits =
    foundVideos.length + foundCreators.length + foundEvents.length;

  return (
    <div
      style={{
        width: "min(96%, var(--content-max))",
        margin: "0 auto",
        padding: "28px 16px 64px",
      }}
    >
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.04em" }}>
          検索
        </h1>
        <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
          作品・クリエイター・イベントを横断検索します。
        </p>
      </header>

      <form
        method="get"
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <label
          style={{
            flex: 1,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-surface)",
          }}
        >
          <Icon name="search" size={14} aria-hidden />
          <input
            type="search"
            name="q"
            defaultValue={keyword}
            placeholder="作品・楽曲・クリエイター・イベント名"
            autoComplete="off"
            style={{
              flex: 1,
              background: "transparent",
              border: 0,
              outline: 0,
              fontSize: 14,
            }}
          />
        </label>
        <button type="submit" className="fn-btn fn-btn-primary">
          検索
        </button>
      </form>

      {!keyword ? (
        <p
          className="fn-empty-message"
          style={{ padding: "32px 0", textAlign: "center" }}
        >
          キーワードを入力してください。
        </p>
      ) : totalHits === 0 ? (
        <p
          className="fn-empty-message"
          style={{ padding: "32px 0", textAlign: "center" }}
        >
          「{keyword}」に一致する結果はありませんでした。
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {foundVideos.length > 0 ? (
            <section>
              <h2
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                作品 ({foundVideos.length})
              </h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: 16,
                }}
              >
                {foundVideos.map((v) => (
                  <div key={v.id}>
                    <VideoCard video={v} />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {foundCreators.length > 0 ? (
            <section>
              <h2
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                クリエイター ({foundCreators.length})
              </h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: 12,
                }}
              >
                {foundCreators.map((c) => (
                  <Link
                    key={c.id}
                    href={`/user/${c.id}`}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: 10,
                      alignItems: "center",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--bg-surface)",
                    }}
                  >
                    {c.icon_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={c.icon_url}
                        alt=""
                        width={36}
                        height={36}
                        style={{ borderRadius: 999, objectFit: "cover" }}
                      />
                    ) : (
                      <span
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 999,
                          background: "var(--bg-elevated)",
                          display: "grid",
                          placeItems: "center",
                          color: "var(--text-muted)",
                        }}
                      >
                        <Icon name="user" size={16} aria-hidden />
                      </span>
                    )}
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 13,
                          fontWeight: 700,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.x_name}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                        }}
                      >
                        @{c.id}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {foundEvents.length > 0 ? (
            <section>
              <h2
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                イベント ({foundEvents.length})
              </h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 12,
                }}
              >
                {foundEvents.map((ev) => (
                  <Link
                    key={ev.id}
                    href={`/event/${ev.id}`}
                    style={{
                      display: "block",
                      padding: 14,
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--bg-surface)",
                    }}
                  >
                    <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>
                      {ev.title}
                    </strong>
                    {ev.explanation ? (
                      <p
                        style={{
                          marginTop: 4,
                          fontSize: 12,
                          color: "var(--text-muted)",
                          display: "-webkit-box",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: 2,
                          overflow: "hidden",
                        }}
                      >
                        {ev.explanation}
                      </p>
                    ) : null}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
