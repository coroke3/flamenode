import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import { getCollaboratorPermissions } from "@/lib/auth/ownership";
import {
  eventStaff as eventStaffTable,
  eventStaffPermissions as eventStaffPermissionsTable,
  events as eventsTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import { COLLABORATOR_PERMISSION_LABELS } from "@/lib/constants/collaborator-permissions";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `イベント管理者 (${id})` };
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

  const ev = (
    await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
  )[0];
  if (!ev) notFound();

  const isAdmin = user.role === "admin";
  const permissionsForCurrentUser = isAdmin
    ? new Set<string>()
    : await getCollaboratorPermissions(db, user.id, id);
  if (!isAdmin && permissionsForCurrentUser.size === 0) notFound();

  const staff = await db
    .select({
      id: eventStaffTable.id,
      x_user_id: eventStaffTable.x_user_id,
      discord_user_id: eventStaffTable.discord_user_id,
      display_name: eventStaffTable.display_name,
      role: eventStaffTable.role,
      is_public: eventStaffTable.is_public,
      public_role_label: eventStaffTable.public_role_label,
      internal_note: eventStaffTable.internal_note,
      approved_at: eventStaffTable.approved_at,
      approved_by_user_id: eventStaffTable.approved_by_user_id,
      x_name: xUsersTable.x_name,
      icon_url: xUsersTable.icon_url,
      approval_status: xUsersTable.approval_status,
    })
    .from(eventStaffTable)
    .leftJoin(xUsersTable, eq(xUsersTable.id, eventStaffTable.x_user_id))
    .where(eq(eventStaffTable.event_id, id))
    .orderBy(asc(eventStaffTable.display_name));

  const permissionRows = await db
    .select({
      id: eventStaffPermissionsTable.id,
      event_staff_id: eventStaffPermissionsTable.event_staff_id,
      permission_key: eventStaffPermissionsTable.permission_key,
      allowed: eventStaffPermissionsTable.allowed,
    })
    .from(eventStaffPermissionsTable)
    .innerJoin(
      eventStaffTable,
      eq(eventStaffTable.id, eventStaffPermissionsTable.event_staff_id),
    )
    .where(eq(eventStaffTable.event_id, id))
    .orderBy(asc(eventStaffPermissionsTable.permission_key));

  const permissionMap = new Map<string, typeof permissionRows>();
  for (const permission of permissionRows) {
    const list = permissionMap.get(permission.event_staff_id) ?? [];
    list.push(permission);
    permissionMap.set(permission.event_staff_id, list);
  }

  return (
    <div>
      <p style={{ marginBottom: 8, fontSize: 12 }}>
        <Link href={`/manage/events/${id}`}>イベント運営トップへ</Link>
      </p>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>
        イベント管理者: {ev.title}
      </h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>
        表示メンバー、内部メンバー、付与されている操作範囲を確認できます。
      </p>

      {isAdmin ? (
        <div style={{ marginTop: 14 }}>
          <Link
            href={`/admin/events/${id}/staff`}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            <Icon name="settings" size={11} aria-hidden /> 管理画面で編集
          </Link>
        </div>
      ) : null}

      <table className="fn-table" style={{ marginTop: 14 }}>
        <thead>
          <tr>
            <th>名前</th>
            <th>役割</th>
            <th>公開</th>
            <th>権限</th>
            <th>承認</th>
            <th>備考</th>
          </tr>
        </thead>
        <tbody>
          {staff.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                スタッフは登録されていません。
              </td>
            </tr>
          ) : (
            staff.map((s) => {
              const keys = permissionMap.get(s.id)?.filter((p) => p.allowed === 1) ?? [];
              return (
                <tr key={s.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {s.icon_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.icon_url}
                          alt=""
                          width={28}
                          height={28}
                          style={{ borderRadius: 999, objectFit: "cover" }}
                        />
                      ) : (
                        <span
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 999,
                            display: "grid",
                            placeItems: "center",
                            background: "var(--bg-elevated)",
                            color: "var(--text-muted)",
                          }}
                        >
                          <Icon name="user" size={13} aria-hidden />
                        </span>
                      )}
                      <div>
                        {s.x_user_id ? (
                          <Link href={`/user/${s.x_user_id}`} style={{ fontWeight: 600 }}>
                            {s.x_name ?? s.display_name}
                          </Link>
                        ) : (
                          <strong>{s.display_name}</strong>
                        )}
                        <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                          {s.x_user_id ? `@${s.x_user_id}` : s.discord_user_id ?? s.id}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`fn-badge ${s.role === "representative" ? "fn-badge-accent" : "fn-badge-soft"}`}>
                      {s.role === "representative" ? "代表" : s.role === "editor" ? "運営" : "スタッフ"}
                    </span>
                  </td>
                  <td>
                    {s.is_public === 1 ? (
                      <>
                        <span className="fn-badge fn-badge-soft">公開</span>
                        {s.public_role_label ? (
                          <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)" }}>
                            {s.public_role_label}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="fn-badge fn-badge-neutral">非公開</span>
                    )}
                  </td>
                  <td style={{ maxWidth: 260 }}>
                    {keys.length === 0 ? (
                      <span className="fn-muted fn-text-sm">なし</span>
                    ) : (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {keys.map((p) => (
                          <span key={p.id} className="fn-badge fn-badge-soft">
                            {COLLABORATOR_PERMISSION_LABELS[
                              p.permission_key as keyof typeof COLLABORATOR_PERMISSION_LABELS
                            ]?.label ?? p.permission_key}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    {s.approved_at ? (
                      <>
                        <div>{formatUnix(s.approved_at, { dateOnly: true })}</div>
                        {s.approved_by_user_id ? (
                          <div style={{ color: "var(--text-muted)" }}>
                            by {s.approved_by_user_id}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 220 }}>
                    {s.internal_note ?? "-"}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
