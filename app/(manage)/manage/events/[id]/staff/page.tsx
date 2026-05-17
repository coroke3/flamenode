import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import {
  events as eventsTable,
  eventEditors as eventEditorsTable,
  eventCollaboratorPermissions as eventCollaboratorPermissionsTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
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
  const guard = await requireSession();
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

  const permissions = await db
    .select()
    .from(eventCollaboratorPermissionsTable)
    .where(eq(eventCollaboratorPermissionsTable.event_id, id))
    .orderBy(eventCollaboratorPermissionsTable.display_name);

  const staff = await db
    .select({
      x_user_id: eventEditorsTable.x_user_id,
      role: eventEditorsTable.role,
      is_public: eventEditorsTable.is_public,
      public_role_label: eventEditorsTable.public_role_label,
      internal_note: eventEditorsTable.internal_note,
      approved_at: eventEditorsTable.approved_at,
      approved_by_user_id: eventEditorsTable.approved_by_user_id,
      x_name: xUsersTable.x_name,
      icon_url: xUsersTable.icon_url,
      approval_status: xUsersTable.approval_status,
    })
    .from(eventEditorsTable)
    .leftJoin(xUsersTable, eq(xUsersTable.id, eventEditorsTable.x_user_id))
    .where(eq(eventEditorsTable.event_id, id));

  return (
    <div>
      <p style={{ marginBottom: 8, fontSize: 12 }}>
        <Link href={`/manage/events/${id}`}>← イベント運営トップへ</Link>
      </p>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>
        運営メンバー: {ev.title}
      </h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>
        {staff.length} 名の運営者を表示しています。読み取り専用。
      </p>

      {isAdmin ? (
        <div style={{ marginTop: 14 }}>
          <Link
            href={`/admin/events/${id}/staff`}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            <Icon name="settings" size={11} aria-hidden /> 管理者で編集
          </Link>
        </div>
      ) : null}

      <table className="fn-table" style={{ marginTop: 14 }}>
        <thead>
          <tr>
            <th>X ID / 名前</th>
            <th>役割</th>
            <th>公開設定</th>
            <th>承認</th>
            <th>備考</th>
          </tr>
        </thead>
        <tbody>
          {staff.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                運営メンバーは登録されていません。
              </td>
            </tr>
          ) : (
            staff.map((s) => (
              <tr key={s.x_user_id}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {s.icon_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
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
                      <Link
                        href={`/user/${s.x_user_id}`}
                        style={{ fontWeight: 600 }}
                      >
                        {s.x_name ?? s.x_user_id}
                      </Link>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                        @{s.x_user_id}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <span
                    className={`fn-badge ${
                      s.role === "representative" ? "fn-badge-accent" : "fn-badge-soft"
                    }`}
                  >
                    {s.role === "representative" ? "代表" : "運営"}
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
                <td style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  {s.approved_at ? (
                    <>
                      <div>{formatUnix(s.approved_at, { dateOnly: true })}</div>
                      {s.approved_by_user_id ? (
                        <div style={{ color: "var(--text-muted)" }}>
                          by{" "}
                          {isAdmin ? (
                            <Link
                              href={`/admin/users/${encodeURIComponent(s.approved_by_user_id)}`}
                            >
                              {s.approved_by_user_id}
                            </Link>
                          ) : (
                            s.approved_by_user_id
                          )}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 220 }}>
                  {s.internal_note ?? "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {permissions.length > 0 ? (
        <section style={{ marginTop: 28 }}>
          <h2
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.18em",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            個別編集権限 ({permissions.length})
          </h2>
          <table className="fn-table">
            <thead>
              <tr>
                <th>display_name</th>
                <th>X / Discord</th>
                <th>permission_key</th>
                <th>allowed</th>
                <th>公開</th>
              </tr>
            </thead>
            <tbody>
              {permissions.map((p) => (
                <tr key={p.id}>
                  <td>{p.display_name}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                    {p.x_user_id ? `@${p.x_user_id}` : null}
                    {p.x_user_id && p.discord_user_id ? " / " : ""}
                    {p.discord_user_id ?? null}
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                    {p.permission_key}
                  </td>
                  <td>
                    <span
                      className={`fn-badge ${p.allowed === 1 ? "fn-badge-accent" : "fn-badge-soft"}`}
                    >
                      {p.allowed === 1 ? "ON" : "OFF"}
                    </span>
                  </td>
                  <td>
                    {p.is_public_staff === 1 ? (
                      <span className="fn-badge fn-badge-soft">公開</span>
                    ) : (
                      <span className="fn-badge fn-badge-neutral">非公開</span>
                    )}
                    {p.public_role_label ? (
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                        {p.public_role_label}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
