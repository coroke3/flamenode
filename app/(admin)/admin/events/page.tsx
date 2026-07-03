import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";

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
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AutoSubmitSelect } from "@/components/forms/AutoSubmitSelect";

export const metadata: Metadata = { title: "全イベント管理" };
export const dynamic = "force-dynamic";

type SortKey = "newest" | "oldest" | "upcoming";
type FilterKey = "all" | "public" | "private" | "archived" | "accepting" | "draft";

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
      case "public":
      case "private":
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
      <AdminPageHeader
        title="全イベント管理"
        description="イベントの作成・公開設定・運営メンバー管理を行います。"
        actions={[
          {
            href: "/admin/events/new",
            label: "新規イベント",
            icon: <Icon name="plus" size={12} aria-hidden />,
            variant: "primary",
          },
        ]}
      />

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
        <AutoSubmitSelect name="filter" className="fn-select" defaultValue={filter}>
          <option value="all">全イベント</option>
          <option value="public">public</option>
          <option value="private">private</option>
          <option value="draft">draft</option>
          <option value="archived">アーカイブ</option>
          <option value="accepting">受付中のみ</option>
        </AutoSubmitSelect>
        <AutoSubmitSelect name="sort" className="fn-select" defaultValue={sort}>
          <option value="newest">開催日 新→旧</option>
          <option value="oldest">開催日 旧→新</option>
          <option value="upcoming">開催日 早い順</option>
        </AutoSubmitSelect>
      </form>

      <p style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
        {rows.length} 件表示中 (上限 60)
      </p>

      {rows.length === 0 ? (
        <EmptyState
          tone="neutral"
          title="まだイベントがありません"
          description="最初のイベントを作成すると、募集・投稿枠・運営メンバーを管理できるようになります。"
          actions={[
            { href: "/admin/events/new", label: "新規イベントを作成", variant: "primary" },
            { href: "/admin/events/templates", label: "テンプレートを見る", variant: "ghost" },
          ]}
        />
      ) : (
      <FnTable style={{ marginTop: 8 }}>
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
                  <div className="fn-console-row-actions">
                    <Link
                      href={`/manage/events/${ev.id}/edit`}
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                    >
                      運営設定を開く
                    </Link>
                    <Link
                      href={`/manage/events/${ev.id}`}
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                    >
                      運営ビュー
                    </Link>
                    <Link
                      href={`/manage/events/${ev.id}/staff`}
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                    >
                      運営権限を編集
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
        </tbody>
      </FnTable>
      )}
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
    filter === "public" ||
    filter === "private" ||
    filter === "archived" ||
    filter === "draft"
      ? eq(eventsTable.visibility_status, filter)
      : undefined,
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
