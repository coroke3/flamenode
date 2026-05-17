import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, asc, desc, eq, like, or } from "drizzle-orm";
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

type SortKey = "newest" | "oldest" | "upcoming";
type FilterKey = "all" | "active" | "archived" | "accepting" | "draft";

interface Props {
  searchParams?: Promise<{
    sort?: string;
    filter?: string;
    q?: string;
  }>;
}

export default async function AdminEventsPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const sp = (await searchParams) ?? {};
  const sort: SortKey = (() => {
    switch (sp.sort) {
      case "oldest":
      case "upcoming":
        return sp.sort;
      default:
        return "newest";
    }
  })();
  const filter: FilterKey = (() => {
    switch (sp.filter) {
      case "active":
      case "archived":
      case "accepting":
      case "draft":
        return sp.filter;
      default:
        return "all";
    }
  })();
  const q = (sp.q ?? "").trim();

  const db = getDatabase();
  const allRows = await loadEvents(db, filter, sort, q);

  // accepting フィルタはアプリ側で時刻判定
  const rows =
    filter === "accepting"
      ? allRows.filter((ev) => isAcceptingEntries(ev))
      : allRows;

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

      <form
        method="get"
        style={{
          marginTop: 14,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="タイトル / ID で検索"
          className="fn-input"
          style={{ maxWidth: 240 }}
        />
        <select name="filter" className="fn-select" defaultValue={filter}>
          <option value="all">全イベント</option>
          <option value="active">is_active=1</option>
          <option value="draft">下書き (is_active=0)</option>
          <option value="archived">アーカイブ</option>
          <option value="accepting">受付中のみ</option>
        </select>
        <select name="sort" className="fn-select" defaultValue={sort}>
          <option value="newest">開催日 新→旧</option>
          <option value="oldest">開催日 旧→新</option>
          <option value="upcoming">開催日 早い順</option>
        </select>
        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm">
          適用
        </button>
      </form>

      <p style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
        {rows.length} 件表示中 (上限 60)
      </p>

      <table className="fn-table" style={{ marginTop: 8 }}>
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
                    <Link
                      href={`/admin/audit?table=events&record=${encodeURIComponent(ev.id)}`}
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                      title="このイベントの監査ログ"
                    >
                      監査
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

async function loadEvents(
  db: ReturnType<typeof getDatabase>,
  filter: FilterKey,
  sort: SortKey,
  q: string,
): Promise<(typeof eventsTable.$inferSelect)[]> {
  if (!db) return [];
  const term = `%${q}%`;
  const conds = [
    filter === "active" ? eq(eventsTable.is_active, 1) : undefined,
    filter === "archived" ? eq(eventsTable.is_archived, 1) : undefined,
    filter === "draft" ? eq(eventsTable.is_active, 0) : undefined,
    q ? or(like(eventsTable.title, term), like(eventsTable.id, term)) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
  const order =
    sort === "oldest" || sort === "upcoming"
      ? asc(eventsTable.start_time)
      : desc(eventsTable.start_time);
  const base = db.select().from(eventsTable);
  return where
    ? await base.where(where).orderBy(order).limit(60)
    : await base.orderBy(order).limit(60);
}
