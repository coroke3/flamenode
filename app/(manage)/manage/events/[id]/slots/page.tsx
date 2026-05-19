import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import {
  events as eventsTable,
  eventEditors as eventEditorsTable,
  slots as slotsTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ status?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `スロット運営 (${id})` };
}

export default async function ManageEventSlotsPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const statusFilter: "all" | "available" | "reserved" | "submitted" =
    sp.status === "available" ||
    sp.status === "reserved" ||
    sp.status === "submitted"
      ? sp.status
      : "all";

  const guard = await requireSession({
    next: `/manage/events/${encodeURIComponent(id)}/slots`,
  });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  if (!db) notFound();

  const ev = (
    await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
  )[0];
  if (!ev) notFound();

  const activeX = user.active_x_user_id;
  const isAdmin = user.role === "admin";
  if (activeX) {
    const editor = (
      await db
        .select()
        .from(eventEditorsTable)
        .where(
          and(
            eq(eventEditorsTable.event_id, id),
            eq(eventEditorsTable.x_user_id, activeX),
          )!,
        )
        .limit(1)
    )[0];
    if (!editor && !isAdmin) notFound();
  } else if (!isAdmin) {
    notFound();
  }

  const where =
    statusFilter === "all"
      ? eq(slotsTable.event_id, id)
      : and(
          eq(slotsTable.event_id, id),
          eq(slotsTable.status, statusFilter),
        )!;
  const rows = await db
    .select({
      id: slotsTable.id,
      slot_kind: slotsTable.slot_kind,
      slot_label: slotsTable.slot_label,
      start_time: slotsTable.start_time,
      end_time: slotsTable.end_time,
      sort_order: slotsTable.sort_order,
      status: slotsTable.status,
      display_name: slotsTable.display_name,
      x_user_id: slotsTable.x_user_id,
      x_name: xUsersTable.x_name,
      reservation_group_id: slotsTable.reservation_group_id,
    })
    .from(slotsTable)
    .leftJoin(xUsersTable, eq(xUsersTable.id, slotsTable.x_user_id))
    .where(where)
    .orderBy(asc(slotsTable.start_time), asc(slotsTable.sort_order))
    .limit(500);

  const countRows = await db
    .select({
      status: slotsTable.status,
      c: sql<number>`COUNT(*)`,
    })
    .from(slotsTable)
    .where(eq(slotsTable.event_id, id))
    .groupBy(slotsTable.status);
  const counts: Record<string, number> = {};
  for (const r of countRows) counts[r.status ?? "unknown"] = Number(r.c ?? 0);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div>
      <p style={{ marginBottom: 8, fontSize: 12 }}>
        <Link href={`/manage/events/${id}`}>← イベント運営トップへ</Link>
      </p>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>
        スロット運営: {ev.title}
      </h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>
        {total} 件のスロットを表示します (最大 500)。読み取り専用。
      </p>

      <nav
        aria-label="状態フィルタ"
        style={{
          marginTop: 16,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        {(
          [
            ["all", "すべて"],
            ["available", "空き"],
            ["reserved", "確保済"],
            ["submitted", "提出済"],
          ] as const
        ).map(([key, label]) => {
          const count = key === "all" ? total : (counts[key] ?? 0);
          const href =
            key === "all"
              ? `/manage/events/${id}/slots`
              : `/manage/events/${id}/slots?status=${key}`;
          return (
            <Link
              key={key}
              href={href}
              className={`fn-btn fn-btn-sm ${statusFilter === key ? "fn-btn-primary" : "fn-btn-ghost"}`}
            >
              {label} ({count})
            </Link>
          );
        })}
      </nav>

      <div style={{ marginTop: 14 }}>
        {isAdmin ? (
          <Link
            href={`/admin/events/${id}/slots`}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            <Icon name="settings" size={11} aria-hidden /> 管理者でスロット編集
          </Link>
        ) : null}
      </div>

      <table className="fn-table" style={{ marginTop: 14 }}>
        <thead>
          <tr>
            <th>枠</th>
            <th>状態</th>
            <th>表示名</th>
            <th>X ID</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                該当するスロットはありません。
              </td>
            </tr>
          ) : (
            rows.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.start_time ? (
                    <span>
                      {formatUnix(s.start_time)}
                      {s.end_time ? ` - ${formatUnix(s.end_time, { timeOnly: true })}` : ""}
                    </span>
                  ) : (
                    <span>{s.slot_label ?? `#${s.sort_order ?? "?"}`}</span>
                  )}
                </td>
                <td>
                  <span
                    className={`fn-badge ${
                      s.status === "submitted"
                        ? "fn-badge-accent"
                        : s.status === "reserved"
                          ? "fn-badge-warning"
                          : "fn-badge-soft"
                    }`}
                  >
                    {s.status}
                  </span>
                </td>
                <td>{s.display_name ?? "—"}</td>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                  {s.x_user_id ? (
                    <Link href={`/user/${s.x_user_id}`}>@{s.x_user_id}</Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
