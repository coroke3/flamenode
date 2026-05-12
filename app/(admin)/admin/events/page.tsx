import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { events as eventsTable } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  isAcceptingEntries,
} from "@/lib/utils/eventStatus";

export const metadata: Metadata = { title: "イベント管理" };
export const dynamic = "force-dynamic";

export default async function AdminEventsPage(): Promise<React.ReactElement> {
  const db = getDatabase();
  const rows = db
    ? await db
        .select()
        .from(eventsTable)
        .orderBy(desc(eventsTable.start_time))
        .limit(60)
    : [];

  return (
    <div>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>イベント管理</h1>
        <Link href="/admin/events/new" className="fn-btn fn-btn-primary fn-btn-sm">
          <Icon name="plus" size={12} aria-hidden /> 新規イベント
        </Link>
      </header>

      <table className="fn-table" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>イベント名</th>
            <th>期間</th>
            <th>状態</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((ev) => {
            const status = computeEventStatus(ev);
            return (
              <tr key={ev.id}>
                <td>
                  <strong>{ev.title}</strong>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {ev.id}
                  </div>
                </td>
                <td>
                  {formatUnix(ev.start_time, { dateOnly: true })}
                  {ev.end_time
                    ? ` 〜 ${formatUnix(ev.end_time, { dateOnly: true })}`
                    : ""}
                </td>
                <td>
                  <span className={`fn-badge ${eventStatusBadgeClass(status)}`}>
                    {eventStatusLabel(status)}
                  </span>
                  {isAcceptingEntries(ev) ? (
                    <span
                      className="fn-badge fn-badge-soft"
                      style={{ marginLeft: 6 }}
                    >
                      受付中
                    </span>
                  ) : null}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Link
                      href={`/admin/events/${ev.id}`}
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                    >
                      詳細
                    </Link>
                    <Link
                      href={`/admin/events/${ev.id}/staff`}
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                    >
                      権限
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4}>
                <p
                  className="fn-empty-message"
                  style={{ padding: 16, textAlign: "center" }}
                >
                  まだイベントがありません。
                </p>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
