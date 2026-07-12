import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { FnTable } from "@/components/ui/FnTable";
import { Icon } from "@/components/ui/Icon";
import {
  buildEventApiPayload,
  EVENT_API_VIDEO_LIMIT,
} from "@/lib/api/eventEndpointPayload";
import {
  createApiEndpoint,
  setApiEndpointActive,
} from "@/lib/actions/api-endpoints";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  videoEvents as videoEventsTable,
  videos as videosTable,
} from "@/lib/db/schema";
import { formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Public API management" };
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
    public_api_enabled: number | null;
    created_at: number;
    event_title: string | null;
    event_visibility_status: string | null;
  }> = [];
  let eventOptions: Array<{ id: string; title: string }> = [];
  let preview: unknown = null;

  if (db) {
    rows = await db
      .select({
        id: eventsTable.id,
        event_id: eventsTable.id,
        public_api_enabled: eventsTable.public_api_enabled,
        created_at: eventsTable.created_at,
        event_title: eventsTable.title,
        event_visibility_status: eventsTable.visibility_status,
      })
      .from(eventsTable)
      .where(eq(eventsTable.public_api_enabled, 1))
      .orderBy(desc(eventsTable.created_at))
      .limit(100);

    eventOptions = await db
      .select({ id: eventsTable.id, title: eventsTable.title })
      .from(eventsTable)
      .where(eq(eventsTable.visibility_status, "public"))
      .orderBy(desc(eventsTable.created_at))
      .limit(100);

    const sample = rows.find(
      (row) =>
        row.public_api_enabled === 1 &&
        row.event_title &&
        row.event_visibility_status === "public",
    );
    if (sample) {
      const event = (
        await db
          .select({
            id: eventsTable.id,
            title: eventsTable.title,
            explanation: eventsTable.explanation,
            visibility_status: eventsTable.visibility_status,
            start_time: eventsTable.start_time,
            end_time: eventsTable.end_time,
            entry_start_time: eventsTable.entry_start_time,
            entry_end_time: eventsTable.entry_end_time,
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
        .where(
          and(
            eq(videoEventsTable.event_id, sample.event_id),
            eq(videosTable.visibility_status, "public"),
          ),
        )
        .limit(3);
      if (event) preview = buildEventApiPayload(event, videos, 3);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Public API management"
        description="Enable or disable the public event API with events.public_api_enabled as the source of truth."
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
          Enable event API
        </h2>
        <form action={createApiEndpointAction} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select name="event_id" className="fn-select" required>
            <option value="">Select event</option>
            {eventOptions.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title} ({event.id})
              </option>
            ))}
          </select>
          <button type="submit" className="fn-btn fn-btn-primary">
            <Icon name="plus" size={13} aria-hidden />
            Enable
          </button>
        </form>
        <p className="fn-muted fn-text-sm" style={{ marginTop: 10 }}>
          The public response includes only event basics and public video summaries. Each endpoint returns up to{" "}
          {EVENT_API_VIDEO_LIMIT} videos.
        </p>
      </section>

      <section style={{ marginTop: 22 }}>
        <FnTable>
          <thead>
            <tr>
              <th>Status</th>
              <th>Event</th>
              <th>Endpoint</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = `/api/event-endpoints/${encodeURIComponent(row.id)}`;
              return (
                <tr key={row.id}>
                  <td>
                    <span className="fn-badge fn-badge-accent">Enabled</span>
                    <span className="fn-badge fn-badge-soft" style={{ marginLeft: 6 }}>
                      {row.event_visibility_status ?? "unknown"}
                    </span>
                  </td>
                  <td>
                    <Link href={`/manage/events/${row.event_id}`}>
                      {row.event_title ?? row.event_id}
                    </Link>
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                    <Link href={href}>{href}</Link>
                  </td>
                  <td className="fn-muted">{formatUnix(row.created_at)}</td>
                  <td>
                    <form action={setApiEndpointActiveAction}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="public_api_enabled" value="0" />
                      <button type="submit" className="fn-btn fn-btn-sm fn-btn-ghost">
                        Disable
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 18, textAlign: "center" }}>
                  <span className="fn-muted fn-text-sm">No public event APIs are enabled.</span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </FnTable>
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
          API preview
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
                title: "Event title",
                explanation: "Short event summary",
                visibility_status: "public",
                start_time: null,
                end_time: null,
                entry_start_time: null,
                entry_end_time: null,
              },
              videos: [
                {
                  id: "video_id",
                  title: "Video title",
                  scheduled_time: null,
                  creator_display_name: "Creator",
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
