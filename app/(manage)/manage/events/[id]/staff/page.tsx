import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import {
  EventStaffManager,
  type EventStaffMemberRow,
} from "@/components/admin/EventStaffManager";
import { ManageEventTabs } from "@/components/manage/ManageEventTabs";
import { ConsolePageHeader as ManagePageHeader } from "@/components/layout/ConsolePageHeader";
import { Icon } from "@/components/ui/Icon";
import { requireSession } from "@/lib/auth/guard";
import { getCollaboratorPermissions } from "@/lib/auth/ownership";
import { getDatabase } from "@/lib/cloudflare";
import { PRESET_DEFINITIONS } from "@/lib/auth/permissions/presets";
import { resolveStaffPermissionKeys } from "@/lib/auth/permissions/permissionResolver";
import {
  eventStaff as eventStaffTable,
  events as eventsTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { manageEventAccentStyle } from "@/lib/utils/eventAccent";
import { formatUnix } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `運営メンバー (${id})` };
}

export default async function ManageEventStaffPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const guard = await requireSession({
    next: `/manage/events/${encodeURIComponent(id)}/staff`,
  });
  if (!guard.ok) return guard.element;
  const user = guard.user;
  const db = getDatabase();
  if (!db) notFound();

  const event = (
    await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
  )[0];
  if (!event) notFound();

  const isAdmin = user.role === "admin";
  const currentPermissions = isAdmin
    ? new Set<string>()
    : await getCollaboratorPermissions(db, user.id, id);
  if (!isAdmin && currentPermissions.size === 0) notFound();
  const canManageMembers =
    isAdmin || currentPermissions.has("event.members");

  const rows = await db
    .select({
      id: eventStaffTable.id,
      x_user_id: eventStaffTable.x_user_id,
      display_name: eventStaffTable.display_name,
      permission_preset: eventStaffTable.permission_preset,
      custom_permission_keys_json: eventStaffTable.custom_permission_keys_json,
      is_public: eventStaffTable.is_public,
      public_role_label: eventStaffTable.public_role_label,
      approved_at: eventStaffTable.approved_at,
      x_name: xUsersTable.x_name,
      icon_url: xUsersTable.icon_url,
      approval_status: xUsersTable.approval_status,
    })
    .from(eventStaffTable)
    .leftJoin(xUsersTable, eq(xUsersTable.id, eventStaffTable.x_user_id))
    .where(eq(eventStaffTable.event_id, id))
    .orderBy(asc(eventStaffTable.display_name));

  const members: EventStaffMemberRow[] = rows.map((row) => ({
    id: row.id,
    x_user_id: row.x_user_id,
    display_name: row.display_name,
    permission_preset: row.permission_preset,
    is_public: row.is_public,
    public_role_label: row.public_role_label,
    permission_keys: Array.from(resolveStaffPermissionKeys(row)),
    x_name: row.x_name,
    icon_url: row.icon_url,
  }));
  const ownerCount = rows.filter(
    (row) => row.permission_preset === "owner",
  ).length;
  const publicCount = rows.filter((row) => row.is_public === 1).length;
  const approvedCount = rows.filter(
    (row) => row.approval_status === "approved",
  ).length;

  return (
    <div style={manageEventAccentStyle(event.accent_color)}>
      <ManagePageHeader
        title={`${event.title} の運営メンバー`}
        description="権限は担当プリセット、公開ページの肩書は公開肩書から解決します。"
        backHref={`/manage/events/${id}`}
        backLabel="イベント運営トップへ"
        accent
        actions={[
          {
            href: `/event/${encodeURIComponent(id)}`,
            label: "公開ページを見る",
            icon: <Icon name="external" size={12} aria-hidden />,
            variant: "ghost",
          },
        ]}
      />
      <ManageEventTabs eventId={id} isAdmin={isAdmin} />

      <section className="fn-console-stat-grid fn-console-section--tight">
        <SummaryCard label="代表者" value={ownerCount} />
        <SummaryCard label="登録メンバー" value={rows.length} />
        <SummaryCard label="公開メンバー" value={publicCount} />
        <SummaryCard label="承認済みX名義" value={approvedCount} />
      </section>

      <section className="fn-console-section">
        <h2 className="fn-console-eyebrow">メンバー一覧</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
            gap: 10,
            marginTop: 12,
          }}
        >
          {rows.map((row) => {
            const name = row.x_name ?? row.display_name;
            const preset = row.permission_preset;
            const presetLabel =
              preset && preset in PRESET_DEFINITIONS
                ? PRESET_DEFINITIONS[
                    preset as keyof typeof PRESET_DEFINITIONS
                  ].label
                : "未設定";
            return (
              <article key={row.id} className="fn-card" style={{ padding: 12 }}>
                <strong>
                  <Link href={`/user/${row.x_user_id}`}>{name}</Link>
                </strong>
                <div className="fn-muted" style={{ fontSize: 11 }}>
                  @{row.x_user_id}
                </div>
                <div className="fn-console-badge-row" style={{ marginTop: 8 }}>
                  {preset === "owner" ? (
                    <span className="fn-badge fn-badge-warning">代表者</span>
                  ) : null}
                  <span className="fn-badge fn-badge-soft">{presetLabel}</span>
                  <span className="fn-badge fn-badge-neutral">
                    {row.is_public === 1 ? "公開" : "非公開"}
                  </span>
                </div>
                {row.public_role_label ? (
                  <p className="fn-console-note">
                    公開肩書: {row.public_role_label}
                  </p>
                ) : null}
                <p className="fn-console-note">
                  登録: {row.approved_at ? formatUnix(row.approved_at, { dateOnly: true }) : "未登録"}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      {canManageMembers ? (
        <section className="fn-card fn-console-card" style={{ padding: 20 }}>
          <EventStaffManager
            eventId={event.id}
            members={members}
            isSiteAdmin={isAdmin}
          />
        </section>
      ) : (
        <p className="fn-alert">この画面は閲覧のみです。</p>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number;
}): React.ReactElement {
  return (
    <article className="fn-card fn-console-stat">
      <div className="fn-console-stat-label">{label}</div>
      <div className="fn-console-stat-value">{value.toLocaleString()}</div>
    </article>
  );
}
