import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";

import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, desc, eq, isNotNull, isNull, like, or, sql, inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  users as usersTable,
  systemSettings,
  xUserAccountLinks,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { formatRelative } from "@/lib/utils/format";
import { Icon } from "@/components/ui/Icon";
import { resolveMissingIcons } from "@/lib/db/iconResolution";
import { normalizeXId } from "@/lib/utils/xid";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AdminUserManagementTabs } from "@/components/admin/AdminUserManagementTabs";
import { GlobalEditableFieldsPanel } from "@/components/admin/GlobalEditableFieldsPanel";
import { Pagination } from "@/components/ui/Pagination";
import { clampPaging, escapeLike, totalPagesFor } from "@/lib/utils/sql";
import { AutoSubmitSelect } from "@/components/forms/AutoSubmitSelect";

const USERS_PAGE_SIZE = 50;

export const metadata: Metadata = { title: "ユーザー管理" };
export const dynamic = "force-dynamic";

type AdminUserRow = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: "user" | "admin" | "moderator" | null;
  is_banned: number | null;
  can_create_events: number | null;
  active_x_user_id: string | null;
  active_x_name: string | null;
  active_x_icon_url: string | null;
  created_at: number;
};

type AdminXUserRow = {
  id: string;
  x_name: string;
  icon_url: string | null;
  approval_status: "pending" | "approved" | "rejected" | "imported" | null;
  primary_auth_user_id: string | null;
  primary_auth_user_name: string | null;
  primary_auth_user_image: string | null;
  linked_auth_user_count: number;
  active_holder_count: number;
};

type CurrentLinkedXRow = {
  user_id: string | null;
  x_user_id: string;
  x_name: string | null;
  icon_url: string | null;
  approval_status: string | null;
};

type PermissionSettings = {
  default_editable_fields: string | null;
  upcoming_editable_fields: string | null;
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    view?: string;
    page?: string;
  }>;
}): Promise<React.ReactElement> {
  const {
    q = "",
    status = "",
    view = "discord",
    page: pageRaw = "1",
  } = await searchParams;
  if (view === "links") redirect("/admin/x-link-requests");
  const activeView =
    view === "xid" || view === "permissions" ? view : "discord";
  const { page, pageSize, offset } = clampPaging({
    page: pageRaw,
    pageSize: USERS_PAGE_SIZE,
    defaultPageSize: USERS_PAGE_SIZE,
    maxPageSize: USERS_PAGE_SIZE,
  });

  const db = getDatabase();
  let userRows: AdminUserRow[] = [];
  let xRows: AdminXUserRow[] = [];
  let linkedXRows: CurrentLinkedXRow[] = [];
  let permissionSettings: PermissionSettings = {
    default_editable_fields: null,
    upcoming_editable_fields: null,
  };
  let totalUsers = 0;
  let totalXUsers = 0;

  if (db) {
    try {
      const rawQuery = q.trim();
      const escapedRaw = escapeLike(rawQuery);
      const lowerTerm = `%${escapedRaw.toLowerCase()}%`;
      const normalizedXQuery = normalizeXId(rawQuery);
      const escapedX = escapeLike(normalizedXQuery || rawQuery);
      const xTerm = `%${escapedX.toLowerCase()}%`;
      const activeXJoin = and(
        sql`lower(${xUsersTable.id}) = lower(${usersTable.active_x_user_id})`,
        eq(xUsersTable.approval_status, "approved"),
        sql`EXISTS (
          SELECT 1 FROM ${xUserAccountLinks} active_link
          WHERE active_link.x_user_id = ${xUsersTable.id}
            AND active_link.auth_user_id = ${usersTable.id}
        )`,
      )!;

      const queryFilter = q
        ? or(
            like(sql<string>`lower(${usersTable.name})`, lowerTerm),
            like(sql<string>`lower(${usersTable.email})`, lowerTerm),
            eq(usersTable.id, q),
            like(sql<string>`lower(${xUsersTable.id})`, xTerm),
            like(sql<string>`lower(${xUsersTable.x_name})`, lowerTerm),
          )
        : undefined;
      const statusFilter =
        status === "banned"
          ? eq(usersTable.is_banned, 1)
          : status === "admin"
            ? eq(usersTable.role, "admin")
            : status === "moderator"
              ? eq(usersTable.role, "moderator")
              : status === "active"
                ? eq(usersTable.is_banned, 0)
                : status === "can_create_events"
                  ? eq(usersTable.can_create_events, 1)
                : status === "tos_not_accepted"
                  ? eq(usersTable.is_tos_accepted, 0)
                  : status === "no_active_x"
                    ? isNull(usersTable.active_x_user_id)
                    : undefined;
      // Discordタブは実Discordログイン済みだけ。旧形式インポートの空discord_idプレースホルダーはX IDタブ側。
      const discordPrincipalFilter = isNotNull(usersTable.discord_id);
      const where =
        queryFilter && statusFilter
          ? and(discordPrincipalFilter, queryFilter, statusFilter)
          : queryFilter
            ? and(discordPrincipalFilter, queryFilter)
            : statusFilter
              ? and(discordPrincipalFilter, statusFilter)
              : discordPrincipalFilter;
      const userOffset = activeView === "discord" ? offset : 0;
      const userLimit =
        activeView === "discord" || activeView === "permissions"
          ? pageSize
          : USERS_PAGE_SIZE;

      userRows = await db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          image: usersTable.image,
          role: usersTable.role,
          is_banned: usersTable.is_banned,
          can_create_events: usersTable.can_create_events,
          active_x_user_id: usersTable.active_x_user_id,
          active_x_name: xUsersTable.x_name,
          active_x_icon_url: xUsersTable.icon_url,
          created_at: usersTable.created_at,
        })
        .from(usersTable)
        .leftJoin(xUsersTable, activeXJoin)
        .where(where)
        .orderBy(desc(usersTable.created_at))
        .limit(userLimit)
        .offset(userOffset);

      if (activeView === "discord" || activeView === "permissions") {
        const countRow = (
          await db
            .select({ c: sql<number>`COUNT(DISTINCT ${usersTable.id})` })
            .from(usersTable)
            .leftJoin(xUsersTable, activeXJoin)
            .where(where)
            .limit(1)
        )[0];
        totalUsers = Number(countRow?.c ?? 0);
      }

      const userRowsWithIcons = await resolveMissingIcons(
        db,
        userRows.map((u) => ({
          ...u,
          creator_x_user_id: u.active_x_user_id,
          icon_url: u.active_x_icon_url,
        })),
      );
      userRows = userRowsWithIcons.map((u) => ({
        ...u,
        active_x_icon_url: u.icon_url,
      }));

      const xFilter = q
        ? or(
            like(sql<string>`lower(${xUsersTable.id})`, xTerm),
            like(sql<string>`lower(${xUsersTable.x_name})`, lowerTerm),
            sql`EXISTS (
              SELECT 1
              FROM ${xUserAccountLinks} link
              INNER JOIN ${usersTable} auth_user ON auth_user.id = link.auth_user_id
              WHERE link.x_user_id = ${xUsersTable.id}
                AND (
                  lower(COALESCE(auth_user.name, '')) LIKE ${lowerTerm}
                  OR auth_user.id = ${rawQuery}
                )
            )`,
          )
        : undefined;
      const xLimit = activeView === "xid" ? pageSize : USERS_PAGE_SIZE * 2;
      const xOffset = activeView === "xid" ? offset : 0;
      xRows = await db
        .select({
          id: xUsersTable.id,
          x_name: xUsersTable.x_name,
          icon_url: xUsersTable.icon_url,
          approval_status: xUsersTable.approval_status,
          primary_auth_user_id: sql<string | null>`(
            SELECT link.auth_user_id
            FROM ${xUserAccountLinks} link
            WHERE link.x_user_id = ${xUsersTable.id}
            ORDER BY CASE WHEN link.link_role = 'owner' THEN 0 ELSE 1 END, link.created_at, link.auth_user_id
            LIMIT 1
          )`,
          primary_auth_user_name: sql<string | null>`(
            SELECT auth_user.name
            FROM ${xUserAccountLinks} link
            INNER JOIN ${usersTable} auth_user ON auth_user.id = link.auth_user_id
            WHERE link.x_user_id = ${xUsersTable.id}
            ORDER BY CASE WHEN link.link_role = 'owner' THEN 0 ELSE 1 END, link.created_at, link.auth_user_id
            LIMIT 1
          )`,
          primary_auth_user_image: sql<string | null>`(
            SELECT auth_user.image
            FROM ${xUserAccountLinks} link
            INNER JOIN ${usersTable} auth_user ON auth_user.id = link.auth_user_id
            WHERE link.x_user_id = ${xUsersTable.id}
            ORDER BY CASE WHEN link.link_role = 'owner' THEN 0 ELSE 1 END, link.created_at, link.auth_user_id
            LIMIT 1
          )`,
          linked_auth_user_count: sql<number>`(
            SELECT COUNT(*) FROM ${xUserAccountLinks} link
            WHERE link.x_user_id = ${xUsersTable.id}
          )`,
          active_holder_count: sql<number>`(
            SELECT COUNT(*) FROM ${usersTable} active_holder
            WHERE lower(active_holder.active_x_user_id) = lower(${xUsersTable.id})
              AND EXISTS (
                SELECT 1 FROM ${xUserAccountLinks} active_link
                WHERE active_link.x_user_id = ${xUsersTable.id}
                  AND active_link.auth_user_id = active_holder.id
              )
          )`,
        })
        .from(xUsersTable)
        .where(xFilter)
        .orderBy(xUsersTable.id)
        .limit(xLimit)
        .offset(xOffset);
      if (activeView === "xid") {
        const countRow = (
          await db
            .select({ c: sql<number>`COUNT(*)` })
            .from(xUsersTable)
            .where(xFilter)
            .limit(1)
        )[0];
        totalXUsers = Number(countRow?.c ?? 0);
      }

      const xRowsWithIcons = await resolveMissingIcons(
        db,
        xRows.map((x) => ({
          ...x,
          creator_x_user_id: x.id,
          icon_url: x.icon_url,
        })),
      );
      xRows = xRowsWithIcons.map((x) => ({ ...x, icon_url: x.icon_url }));

      const visibleUserIds = userRows.map((u) => u.id);
      linkedXRows =
        visibleUserIds.length > 0
          ? await db
              .select({
                user_id: xUserAccountLinks.auth_user_id,
                x_user_id: xUsersTable.id,
                x_name: xUsersTable.x_name,
                icon_url: xUsersTable.icon_url,
                approval_status: xUsersTable.approval_status,
              })
              .from(xUserAccountLinks)
              .innerJoin(xUsersTable, eq(xUsersTable.id, xUserAccountLinks.x_user_id))
              .where(
                and(
                  inArray(xUserAccountLinks.auth_user_id, visibleUserIds),
                  eq(xUsersTable.approval_status, "approved"),
                )!,
              )
              .orderBy(xUsersTable.id)
          : [];

      permissionSettings =
        (
          await db
            .select({
              default_editable_fields: systemSettings.default_editable_fields,
              upcoming_editable_fields: systemSettings.upcoming_editable_fields,
            })
            .from(systemSettings)
            .where(eq(systemSettings.id, "default"))
            .limit(1)
        )[0] ?? permissionSettings;
    } catch (e) {
      console.error("[AdminUsersPage] fetch failed", e);
    }
  }

  const linkedXByUser = new Map<string, CurrentLinkedXRow[]>();
  for (const row of linkedXRows) {
    if (!row.user_id) continue;
    const rows = linkedXByUser.get(row.user_id) ?? [];
    rows.push(row);
    linkedXByUser.set(row.user_id, rows);
  }

  const currentTotal = activeView === "xid" ? totalXUsers : totalUsers;
  const totalPages = totalPagesFor(currentTotal, pageSize);
  const buildHref = (p: number) => {
    const sp = new URLSearchParams();
    sp.set("view", activeView);
    if (q) sp.set("q", q);
    if (status) sp.set("status", status);
    sp.set("page", String(p));
    return `/admin/users?${sp.toString()}`;
  };

  return (
    <div>
      <AdminPageHeader
        title={activeView === "permissions" ? "権限管理" : "ユーザー管理"}
        description={
          activeView === "permissions"
            ? "一般作品でユーザーに開放する編集項目を管理します。"
            : "Discordログイン済みユーザーと X ID の現在の紐付けを確認・管理します。"
        }
      />

      <AdminUserManagementTabs active={activeView} q={q} status={status} />

      {activeView !== "permissions" ? (
        <>
          <form
            action="/admin/users"
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}
          >
            <input type="hidden" name="view" value={activeView} />
            <input
              className="fn-input"
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Discord / X ID / 名前"
              style={{ minWidth: 240 }}
            />
            {activeView === "discord" ? (
              <AutoSubmitSelect className="fn-select" name="status" defaultValue={status}>
                <option value="">すべて</option>
                <option value="active">有効</option>
                <option value="banned">BAN</option>
                <option value="admin">admin</option>
                <option value="moderator">moderator</option>
                <option value="can_create_events">開催権限あり</option>
                <option value="tos_not_accepted">TOS未同意</option>
                <option value="no_active_x">active Xなし</option>
              </AutoSubmitSelect>
            ) : null}
            {(q || status) ? (
              <Link href={`/admin/users?view=${activeView}`} className="fn-btn fn-btn-ghost">
                解除
              </Link>
            ) : null}
          </form>
        </>
      ) : null}

      {activeView === "permissions" ? (
        <GlobalEditableFieldsPanel settings={permissionSettings} />
      ) : activeView === "xid" ? (
        <XIdTable rows={xRows} />
      ) : (
        <DiscordTable rows={userRows} linkedXByUser={linkedXByUser} />
      )}

      {activeView !== "permissions" ? (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          total={currentTotal}
          pageSize={pageSize}
          unitLabel="件"
          buildHref={buildHref}
        />
      ) : null}
    </div>
  );
}

function DiscordTable({
  rows,
  linkedXByUser,
}: {
  rows: AdminUserRow[];
  linkedXByUser: Map<string, CurrentLinkedXRow[]>;
}): React.ReactElement {
  return (
    <FnTable style={{ marginTop: 18 }}>
      <thead>
        <tr>
          <th>Discord</th>
          <th>Active X ID</th>
          <th>ロール</th>
          <th>登録</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((u) => (
          <tr key={u.id}>
            <td>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {u.image ?? u.active_x_icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={u.image ?? u.active_x_icon_url ?? ""}
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
                    <Icon name="user" size={12} aria-hidden />
                  </span>
                )}
                <div>
                  <div>{u.name ?? "-"}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {u.id.slice(0, 12)}...
                  </div>
                </div>
              </div>
            </td>
            <td>
              {u.active_x_user_id ? (
                <span>
                  <span style={{ fontWeight: 600 }}>
                    {u.active_x_name ?? `@${u.active_x_user_id}`}
                  </span>
                  <Link
                    href={`/user/${u.active_x_user_id}`}
                    style={{
                      display: "block",
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    @{u.active_x_user_id}
                  </Link>
                </span>
              ) : (
                "-"
              )}
              {(() => {
                const links = linkedXByUser.get(u.id) ?? [];
                const xids = Array.from(
                  new Set(links.map((link) => normalizeXId(link.x_user_id)).filter(Boolean)),
                );
                if (xids.length === 0) return null;
                return (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                    {xids.map((xid) => (
                      <span key={xid} className="fn-badge fn-badge-soft">
                        @{xid}
                      </span>
                    ))}
                  </div>
                );
              })()}
            </td>
            <td>
              {u.is_banned === 1 ? (
                <span className="fn-badge fn-badge-danger">BAN</span>
              ) : u.role === "admin" ? (
                <span className="fn-badge fn-badge-accent">ADMIN</span>
              ) : u.role === "moderator" ? (
                <span className="fn-badge fn-badge-warning">MOD</span>
              ) : (
                <span className="fn-badge fn-badge-soft">USER</span>
              )}
              {u.can_create_events === 1 ? (
                <span className="fn-badge fn-badge-accent" style={{ marginLeft: 4 }}>
                  開催可
                </span>
              ) : null}
            </td>
            <td>{formatRelative(u.created_at)}</td>
            <td>
              <div style={{ display: "inline-flex", gap: 4 }}>
                <Link href={`/admin/users/${u.id}`} className="fn-btn fn-btn-ghost fn-btn-sm">
                  詳細
                </Link>
                <Link
                  href={`/admin/audit?operator=${encodeURIComponent(u.id)}`}
                  className="fn-btn fn-btn-ghost fn-btn-sm"
                  title="このユーザーが実行した管理操作の監査ログ"
                >
                  監査
                </Link>
              </div>
            </td>
          </tr>
        ))}
        {rows.length === 0 ? (
          <tr>
            <td colSpan={5}>
              <p className="fn-empty-message" style={{ padding: 16, textAlign: "center" }}>
                対象ユーザーが見つかりません。
              </p>
            </td>
          </tr>
        ) : null}
      </tbody>
    </FnTable>
  );
}

function XIdTable({ rows }: { rows: AdminXUserRow[] }): React.ReactElement {
  return (
    <FnTable style={{ marginTop: 18 }}>
      <thead>
        <tr>
          <th>X ID</th>
          <th>Discord連携</th>
          <th>状態</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((x, index) => (
            <tr key={`${x.id}-x-row-${index}`}>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {x.icon_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={x.icon_url}
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
                      <Icon name="user" size={12} aria-hidden />
                    </span>
                  )}
                  <span>
                    <strong>{x.x_name}</strong>
                    <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                      @{x.id}
                    </span>
                  </span>
                </div>
              </td>
              <td>
                {x.primary_auth_user_id ? (
                  <span>
                    <strong>{x.primary_auth_user_name ?? "認証ユーザー"}</strong>
                    <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                      {x.primary_auth_user_id.slice(0, 14)}...
                      {x.linked_auth_user_count > 1
                        ? ` ほか ${x.linked_auth_user_count - 1}件`
                        : ""}
                    </span>
                  </span>
                ) : (
                  <span className="fn-badge fn-badge-warning">Discord未連携</span>
                )}
              </td>
              <td>
                <span
                  className={`fn-badge ${
                    x.approval_status === "approved"
                      ? "fn-badge-accent"
                      : x.approval_status === "rejected"
                        ? "fn-badge-danger"
                        : "fn-badge-warning"
                  }`}
                >
                  {approvalStatusLabel(x.approval_status)}
                </span>
                {x.active_holder_count > 0 ? (
                  <span className="fn-badge fn-badge-soft" style={{ marginLeft: 6 }}>
                    active
                  </span>
                ) : null}
              </td>
              <td>
                {x.primary_auth_user_id ? (
                  <Link
                    href={`/admin/users/${x.primary_auth_user_id}`}
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                  >
                    詳細
                  </Link>
                ) : (
                  <Link href="/admin/x-link-requests" className="fn-btn fn-btn-ghost fn-btn-sm">
                    申請を見る
                  </Link>
                )}
              </td>
            </tr>
        ))}
      </tbody>
    </FnTable>
  );
}

function approvalStatusLabel(status: string | null): string {
  switch (status) {
    case "approved":
      return "承認済み";
    case "rejected":
      return "却下";
    case "pending":
      return "承認待ち";
    default:
      return "未設定";
  }
}
