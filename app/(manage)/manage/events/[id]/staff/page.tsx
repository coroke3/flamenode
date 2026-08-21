import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import {
  EventStaffManager,
  type EventStaffMemberRow,
} from "@/components/admin/EventStaffManager";
import { EventStaffReadOnlyList } from "@/components/admin/EventStaffReadOnlyList";
import { requireSession } from "@/lib/auth/guard";
import {
  getEventPermissionsFromSnapshot,
  getManageAuthorizationSnapshot,
} from "@/lib/auth/manageAuthorization";
import { getDatabase, getEnv } from "@/lib/cloudflare";
import { resolveStaffPermissionKeys } from "@/lib/auth/permissions/permissionResolver";
import {
  eventStaff as eventStaffTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { manageEventAccentStyle } from "@/lib/utils/eventAccent";
import { ManageEventPageShell } from "@/components/manage/ManageEventPageShell";
import { getManageNavigationSnapshot } from "@/lib/manage/navigationEvents";
import { resolveManageXIconUrl } from "@/lib/media/manageXIcon";

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

  const isAdmin = user.role === "admin";
  const authorization = await getManageAuthorizationSnapshot(
    user.id,
    user.role ?? null,
  );
  const navigation = await getManageNavigationSnapshot(user.id, user.role ?? null);
  const event = navigation.events.find((item) => item.id === id);
  if (!event) notFound();
  const eventHrefId = encodeURIComponent(id);
  const currentPermissions = isAdmin
    ? new Set<string>()
    : getEventPermissionsFromSnapshot(authorization, id);
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

  // Internal profile icons are signed only after the canonical X account has
  // been approved. External HTTPS URLs remain unchanged; malformed/internal
  // URLs and missing secrets resolve to null so the avatar falls back safely.
  let authSecret: string | undefined;
  try {
    authSecret = getEnv().AUTH_SECRET;
  } catch {
    authSecret = undefined;
  }
  const members: EventStaffMemberRow[] = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      x_user_id: row.x_user_id,
      display_name: row.display_name,
      permission_preset: row.permission_preset,
      is_public: row.is_public,
      public_role_label: row.public_role_label,
      permission_keys: Array.from(resolveStaffPermissionKeys(row)),
      x_name: row.x_name,
      icon_url: await resolveManageXIconUrl({
        iconUrl: row.icon_url,
        approvalStatus: row.approval_status,
        authSecret,
      }),
    })),
  );
  const ownerCount = rows.filter(
    (row) => row.permission_preset === "owner",
  ).length;
  const publicCount = rows.filter((row) => row.is_public === 1).length;
  const approvedCount = rows.filter(
    (row) => row.approval_status === "approved",
  ).length;
  const pendingCount = navigation.pendingByEvent.get(id) ?? 0;

  return (
    <ManageEventPageShell
      eventId={id}
      title={event.title}
      description="権限は担当プリセット、公開ページの肩書は公開肩書から解決します。"
      backHref={`/manage/events/${eventHrefId}`}
      backLabel="イベント概要へ"
      isAdmin={isAdmin}
      pendingCount={pendingCount}
      accentStyle={manageEventAccentStyle(event.accent_color)}
      actions={[
        { href: `/event/${eventHrefId}`, label: "公開ページを見る", variant: "primary" },
      ]}
    >
      <section
        className="fn-console-stat-grid fn-console-section--tight"
        aria-label="運営メンバー概要"
      >
        <SummaryCard label="代表者" value={ownerCount} />
        <SummaryCard label="登録メンバー" value={rows.length} />
        <SummaryCard label="公開メンバー" value={publicCount} />
        <SummaryCard label="承認済みX名義" value={approvedCount} />
      </section>

      {canManageMembers ? (
        <section className="manage-section">
          <EventStaffManager
            eventId={event.id}
            members={members}
            isSiteAdmin={isAdmin}
            variant="manage"
          />
        </section>
      ) : (
        <section className="manage-section">
          <div className="manage-permission-panel">
            <section className="manage-permission-members">
              <div className="manage-staff-list-head">
                <h3 className="fn-console-card-title">
                  登録メンバー ({members.length})
                </h3>
                <span className="fn-badge fn-badge-neutral">閲覧のみ</span>
              </div>
              <EventStaffReadOnlyList members={members} />
            </section>
          </div>
          <p className="fn-alert manage-readonly-alert">
            この画面は閲覧のみです。メンバーの追加・編集には event.members 権限が必要です。
          </p>
        </section>
      )}
    </ManageEventPageShell>
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
