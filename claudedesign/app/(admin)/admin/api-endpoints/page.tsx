import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  apiEndpoints,
  events as eventsTable,
  videoEvents as videoEventsTable,
  videos as videosTable,
} from "@/lib/db/schema";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Icon } from "@/components/ui/Icon";
import {
  createApiEndpoint,
  setApiEndpointActive,
} from "@/lib/actions/api-endpoints";
import {
  buildEventApiPayload,
  EVENT_API_VIDEO_LIMIT,
} from "@/lib/api/eventEndpointPayload";
import { formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = { title: "公開API管理" };
export const dynamic = "force-dynamic";

async function createApiEndpointAction(formData: FormData): Promise<void> {
  "use server";
  await createApiEndpoint(formData);
}

async function setApiEndpointActiveAction(formData: FormData): Promise<void> {
  "use server";
  await setApiEndpointActive(formData);
}

export default async function AdminApiEndpointsPage(): Promise<React.ReactElement> {
  const db = getDatabase();
  let rows: Array<{
    id: string;
    event_id: string;
    is_active: number | null;
    created_at: number;
    event_title: string | null;
    event_active: number | null;
    event_archived: number | null;
  }> = [];
  let eventOptions: Array<{ id: string; title: string }> = [];
  let preview: unknown = null;

  if (db) {
    rows = await db
      .select({
        id: apiEndpoints.id,
        event_id: apiEndpoints.event_id,
        is_active: apiEndpoints.is_active,
        created_at: apiEndpoints.created_at,
        event_title: eventsTable.title,
        event_active: eventsTable.is_active,
        event_archived: eventsTable.is_archived,
      })
      .from(apiEndpoints)
      .leftJoin(eventsTable, eq(eventsTable.id, apiEndpoints.event_id))
      .orderBy(desc(apiEndpoints.created_at))
      .limit(100);

    eventOptions = await db
      .select({ id: eventsTable.id, title: eventsTable.title })
      .from(eventsTable)
      .orderBy(desc(eventsTable.created_at))
      .limit(100);

    const sample = rows.find((row) => row.is_active === 1 && row.event_title);
    if (sample) {
      const event = (
        await db
          .select({
            id: eventsTable.id,
            title: eventsTable.title,
            explanation: eventsTable.explanation,
            is_active: eventsTable.is_active,
            is_entry_open: eventsTable.is_entry_open,
            is_archived: eventsTable.is_archived,
          })
          .from(eventsTable)
          .where(eq(eventsTable.id, sample.event_id))
          .limit(1)
      )[0];
      const videos = await db
        .select({
          id: videosTable.id,
          title: videosTable.title,
          scheduled_time: videosTable.scheduled_time,
          creator_display_name: videosTable.creator_display_name,
          youtube_video_id: videosTable.youtube_video_id,
        })
        .from(videoEventsTable)
        .innerJoin(videosTable, eq(videosTable.id, videoEventsTable.video_id))
        .where(eq(videoEventsTable.event_id, sample.event_id))
        .limit(3);
      if (event) preview = buildEventApiPayload(event, videos, 3);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="公開API管理"
        description="イベントごとの軽量な公開 API endpoint を管理します。URL を知っている相手だけが使う MVP 形で、レスポンスは短期キャッシュ前提です。"
      />

      <section
        style={{
          marginTop: 18,
          padding: "16px 18px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          endpoint 作成
        </h2>
        <form action={createApiEndpointAction} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select name="event_id" className="fn-select" required>
            <option value="">イベントを選択</option>
            {eventOptions.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title} ({event.id})
              </option>
            ))}
          </select>
          <button type="submit" className="fn-btn fn-btn-primary">
            <Icon name="plus" size={13} aria-hidden />
            作成 / 有効化
          </button>
        </form>
        <p className="fn-muted fn-text-sm" style={{ marginTop: 10 }}>
          返す情報は event id / title / 短縮説明 / active 状態 / public videos の最小情報のみです。
          1 endpoint の動画は最大 {EVENT_API_VIDEO_LIMIT} 件、Cache-Control は 5〜10分です。
        </p>
      </section>

      <section style={{ marginTop: 22 }}>
        <table className="fn-table">
          <thead>
            <tr>
              <th>状態</th>
              <th>イベント</th>
              <th>endpoint</th>
              <th>作成</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = `/api/event-endpoints/${encodeURIComponent(row.id)}`;
              const active = row.is_active === 1 && row.event_title;
              return (
                <tr key={row.id}>
                  <td>
                    <span className={`fn-badge ${active ? "fn-badge-accent" : "fn-badge-soft"}`}>
                      {active ? "有効" : "無効"}
                    </span>
                  </td>
                  <td>
                    {row.event_title ? (
                      <Link href={`/admin/events/${row.event_id}`}>
                        {row.event_title}
                      </Link>
                    ) : (
                      <span style={{ color: "var(--accent-danger)" }}>
                        event 不明: {row.event_id}
                      </span>
                    )}
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                    <Link href={href}>{href}</Link>
                  </td>
                  <td className="fn-muted">{formatUnix(row.created_at)}</td>
                  <td>
                    <form action={setApiEndpointActiveAction}>
                      <input type="hidden" name="id" value={row.id} />
                      <input
                        type="hidden"
                        name="is_active"
                        value={row.is_active === 1 ? "0" : "1"}
                      />
                      <button
                        type="submit"
                        className={`fn-btn fn-btn-sm ${row.is_active === 1 ? "fn-btn-ghost" : "fn-btn-primary"}`}
                      >
                        {row.is_active === 1 ? "無効化" : "有効化"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 18, textAlign: "center" }}>
                  <span className="fn-muted fn-text-sm">API endpoint はまだありません。</span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section
        style={{
          marginTop: 22,
          padding: "16px 18px",
          background: "var(--bg-surface)",
          border: "1px dashed var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
          APIプレビュー
        </h2>
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 11,
            color: "var(--text-secondary)",
          }}
        >
          {JSON.stringify(
            preview ?? {
              event: {
                id: "event_id",
                title: "イベントタイトル",
                explanation: "短縮された説明",
                is_active: true,
                is_entry_open: true,
                is_archived: false,
              },
              videos: [
                {
                  id: "video_id",
                  title: "作品タイトル",
                  scheduled_time: null,
                  creator_display_name: "作者名",
                  youtube_video_id: "YouTube ID",
                },
              ],
              limit: EVENT_API_VIDEO_LIMIT,
            },
            null,
            2,
          )}
        </pre>
      </section>
    </div>
  );
}
