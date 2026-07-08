import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";
import Link from "next/link";
import type { Metadata } from "next";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { eventGroupEvents, eventGroups } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminSectionTabs } from "@/components/admin/AdminSectionTabs";
import { AutoSubmitSelect } from "@/components/forms/AutoSubmitSelect";
import { eventGroupPublicHref } from "@/lib/eventGroupRoutes";

export const metadata: Metadata = { title: "イベントグループ管理" };
export const dynamic = "force-dynamic";

const GROUP_TYPE_LABELS = {
  series: "系列",
  genre: "ジャンル",
  related: "関連",
  collection: "コレクション",
  other: "その他",
} as const;

const VISIBILITY_LABELS = {
  public: "公開",
  private: "非公開",
  archived: "アーカイブ",
} as const;

type GroupType = keyof typeof GROUP_TYPE_LABELS;
type VisibilityType = keyof typeof VISIBILITY_LABELS;

interface Props {
  searchParams?: Promise<{ visibility?: string; type?: string }>;
}

export default async function AdminEventGroupsPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const sp = (await searchParams) ?? {};
  const visibilityFilter: VisibilityType | "any" =
    sp.visibility === "public" ||
    sp.visibility === "private" ||
    sp.visibility === "archived"
      ? sp.visibility
      : "any";
  const typeFilter: GroupType | "any" =
    sp.type && sp.type in GROUP_TYPE_LABELS ? (sp.type as GroupType) : "any";

  const db = getDatabase();
  const conds = [
    visibilityFilter !== "any"
      ? eq(eventGroups.visibility_status, visibilityFilter)
      : undefined,
    typeFilter !== "any" ? eq(eventGroups.group_type, typeFilter) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  const where =
    conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

  const rows = db
    ? await (where
        ? db
            .select({
              id: eventGroups.id,
              name: eventGroups.name,
              slug: eventGroups.slug,
              group_type: eventGroups.group_type,
              visibility_status: eventGroups.visibility_status,
              event_count: sql<number>`count(${eventGroupEvents.event_id})`.as(
                "event_count",
              ),
            })
            .from(eventGroups)
            .leftJoin(
              eventGroupEvents,
              eq(eventGroupEvents.event_group_id, eventGroups.id),
            )
            .where(where)
            .groupBy(eventGroups.id)
            .orderBy(asc(eventGroups.name))
            .limit(100)
        : db
            .select({
              id: eventGroups.id,
              name: eventGroups.name,
              slug: eventGroups.slug,
              group_type: eventGroups.group_type,
              visibility_status: eventGroups.visibility_status,
              event_count: sql<number>`count(${eventGroupEvents.event_id})`.as(
                "event_count",
              ),
            })
            .from(eventGroups)
            .leftJoin(
              eventGroupEvents,
              eq(eventGroupEvents.event_group_id, eventGroups.id),
            )
            .groupBy(eventGroups.id)
            .orderBy(asc(eventGroups.name))
            .limit(100))
    : [];

  return (
    <div>
      <AdminPageHeader
        title="イベントグループ管理"
        description="系列・ジャンルなどのイベントグループと所属イベントを管理します。"
        actions={[
          {
            href: "/admin/event-groups/new",
            label: "新規グループ",
            icon: <Icon name="plus" size={12} aria-hidden />,
            variant: "primary",
          },
        ]}
      />

      <AdminSectionTabs hub="events" />

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
        <AutoSubmitSelect name="visibility" className="fn-select" defaultValue={visibilityFilter}>
          <option value="any">公開状態すべて</option>
          <option value="public">公開</option>
          <option value="private">非公開</option>
          <option value="archived">アーカイブ</option>
        </AutoSubmitSelect>
        <AutoSubmitSelect name="type" className="fn-select" defaultValue={typeFilter}>
          <option value="any">種別すべて</option>
          {Object.entries(GROUP_TYPE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </AutoSubmitSelect>
      </form>

      <FnTable style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>名前</th>
            <th>種別</th>
            <th>公開状態</th>
            <th>イベント数</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.id}>
              <td>
                <strong>{g.name}</strong>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {eventGroupPublicHref(g.slug)}
                </div>
              </td>
              <td>{GROUP_TYPE_LABELS[g.group_type] ?? g.group_type}</td>
              <td>
                {g.visibility_status === "public" ? (
                  <span className="fn-badge fn-badge-accent">公開</span>
                ) : g.visibility_status === "private" ? (
                  <span className="fn-badge fn-badge-soft">非公開</span>
                ) : (
                  <span className="fn-badge fn-badge-soft">アーカイブ</span>
                )}
              </td>
              <td>{g.event_count}</td>
              <td>
                <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                  <Link
                    href={`/admin/event-groups/${g.id}/edit`}
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                  >
                    編集
                  </Link>
                  {g.visibility_status === "public" ? (
                    <Link
                      href={eventGroupPublicHref(g.slug)}
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                      target="_blank"
                    >
                      公開ページ
                    </Link>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6}>
                <p
                  className="fn-empty-message"
                  style={{ padding: 16, textAlign: "center" }}
                >
                  イベントグループはまだありません。
                </p>
              </td>
            </tr>
          ) : null}
        </tbody>
      </FnTable>
    </div>
  );
}
