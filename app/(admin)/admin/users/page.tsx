import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, isNull, like, or, sql, inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  users as usersTable,
  systemSettings,
  xAccountLinkRequests,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { formatRelative } from "@/lib/utils/format";
import { Icon } from "@/components/ui/Icon";
import { resolveMissingIcons } from "@/lib/db/iconResolution";
import { normalizeXId } from "@/lib/utils/xid";
import { updateGlobalEditableFields } from "@/lib/actions/permissions-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { clampPaging, escapeLike, totalPagesFor } from "@/lib/utils/sql";

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
  active_x_user_id: string | null;
  active_x_name: string | null;
  active_x_icon_url: string | null;
  created_at: number;
};

type AdminXUserRow = {
  id: string;
  x_name: string;
  icon_url: string | null;
  approval_status: "pending" | "approved" | "rejected" | null;
  linked_discord_user_id: string | null;
  linked_discord_name: string | null;
  linked_discord_image: string | null;
  active_holder_id: string | null;
};

type LinkRequestRow = {
  id: string;
  discord_user_id: string;
  discord_name: string | null;
  discord_image: string | null;
  requested_x_id: string;
  link_type: "new" | "merge" | "alias";
  target_x_user_id: string | null;
  status: "pending" | "approved" | "rejected" | null;
  requested_at: number;
};

type CurrentLinkedXRow = {
  discord_user_id: string | null;
  x_user_id: string;
  x_name: string | null;
  icon_url: string | null;
  approval_status: string | null;
};

type PermissionSettings = {
  default_editable_fields: string | null;
  upcoming_editable_fields: string | null;
};

const EDITABLE_FIELD_OPTIONS = [
  ["title", "タイトル"],
  ["display_name", "表示名"],
  ["icon_url", "アイコン"],
  ["music", "楽曲"],
  ["credit", "クレジット"],
  ["intro_comment", "紹介コメント"],
  ["used_software", "使用ソフト"],
  ["highlights", "見どころ"],
  ["production_story", "制作エピソード"],
  ["closing_comment", "締めコメント"],
  ["members", "メンバー"],
  ["chapters", "チャプター"],
] as const;

const EDITABLE_FIELD_GROUPS: Array<{
  label: string;
  description: string;
  fields: ReadonlyArray<readonly [string, string]>;
}> = [
  {
    label: "基本情報",
    description: "作品の見出しや表示に関わる項目",
    fields: [
      ["title", "タイトル"],
      ["display_name", "表示名"],
      ["icon_url", "アイコン"],
    ],
  },
  {
    label: "本文・コメント",
    description: "作品の説明文・コメント類",
    fields: [
      ["music", "楽曲"],
      ["credit", "クレジット"],
      ["intro_comment", "紹介コメント"],
      ["used_software", "使用ソフト"],
      ["highlights", "見どころ"],
      ["production_story", "制作エピソード"],
      ["closing_comment", "締めコメント"],
    ],
  },
  {
    label: "構成情報",
    description: "メンバー・チャプターなど構造的な項目",
    fields: [
      ["members", "メンバー"],
      ["chapters", "チャプター"],
    ],
  },
];

async function updateGlobalEditableFieldsAction(formData: FormData): Promise<void> {
  "use server";
  await updateGlobalEditableFields(formData);
}

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
  const activeView = ["discord", "xid", "links", "permissions"].includes(view)
    ? view
    : "discord";
  const { page, pageSize, offset } = clampPaging({
    page: pageRaw,
    pageSize: USERS_PAGE_SIZE,
    defaultPageSize: USERS_PAGE_SIZE,
    maxPageSize: USERS_PAGE_SIZE,
  });

  const db = getDatabase();
  let userRows: AdminUserRow[] = [];
  let xRows: AdminXUserRow[] = [];
  let linkRows: LinkRequestRow[] = [];
  let approvedLinkRows: LinkRequestRow[] = [];
  let linkedXRows: CurrentLinkedXRow[] = [];
  let permissionSettings: PermissionSettings = {
    default_editable_fields: null,
    upcoming_editable_fields: null,
  };
  let totalUsers = 0;
  let totalXUsers = 0;
  let totalLinks = 0;

  if (db) {
    try {
      const rawQuery = q.trim();
      const escapedRaw = escapeLike(rawQuery);
      const term = `%${escapedRaw}%`;
      const lowerTerm = `%${escapedRaw.toLowerCase()}%`;
      const normalizedXQuery = normalizeXId(rawQuery);
      const escapedX = escapeLike(normalizedXQuery || rawQuery);
      const xTerm = `%${escapedX.toLowerCase()}%`;
      const activeXJoin = and(
        sql`lower(${xUsersTable.id}) = lower(${usersTable.active_x_user_id})`,
        eq(xUsersTable.linked_discord_user_id, usersTable.id),
        eq(xUsersTable.approval_status, "approved"),
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
                : status === "tos_not_accepted"
                  ? eq(usersTable.is_tos_accepted, 0)
                  : status === "no_active_x"
                    ? isNull(usersTable.active_x_user_id)
                    : undefined;
      const where =
        queryFilter && statusFilter
          ? and(queryFilter, statusFilter)
          : (queryFilter ?? statusFilter);
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
            like(sql<string>`lower(${usersTable.name})`, lowerTerm),
            eq(xUsersTable.linked_discord_user_id, q),
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
          linked_discord_user_id: xUsersTable.linked_discord_user_id,
          linked_discord_name: usersTable.name,
          linked_discord_image: usersTable.image,
          active_holder_id: usersTable.active_x_user_id,
        })
        .from(xUsersTable)
        .leftJoin(usersTable, eq(usersTable.id, xUsersTable.linked_discord_user_id))
        .where(xFilter)
        .orderBy(xUsersTable.id)
        .limit(xLimit)
        .offset(xOffset);
      if (activeView === "xid") {
        const countRow = (
          await db
            .select({ c: sql<number>`COUNT(*)` })
            .from(xUsersTable)
            .leftJoin(usersTable, eq(usersTable.id, xUsersTable.linked_discord_user_id))
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

      const requestFilter = q
        ? or(
            like(sql<string>`lower(${xAccountLinkRequests.requested_x_id})`, xTerm),
            like(xAccountLinkRequests.discord_user_id, term),
            like(sql<string>`lower(${usersTable.name})`, lowerTerm),
          )
        : undefined;
      const linkLimit = activeView === "links" ? pageSize : USERS_PAGE_SIZE * 2;
      const linkOffset = activeView === "links" ? offset : 0;
      linkRows = await db
        .select({
          id: xAccountLinkRequests.id,
          discord_user_id: xAccountLinkRequests.discord_user_id,
          discord_name: usersTable.name,
          discord_image: usersTable.image,
          requested_x_id: xAccountLinkRequests.requested_x_id,
          link_type: xAccountLinkRequests.link_type,
          target_x_user_id: xAccountLinkRequests.target_x_user_id,
          status: xAccountLinkRequests.status,
          requested_at: xAccountLinkRequests.requested_at,
        })
        .from(xAccountLinkRequests)
        .leftJoin(usersTable, eq(usersTable.id, xAccountLinkRequests.discord_user_id))
        .where(requestFilter)
        .orderBy(desc(xAccountLinkRequests.requested_at))
        .limit(linkLimit)
        .offset(linkOffset);
      if (activeView === "links") {
        const countRow = (
          await db
            .select({ c: sql<number>`COUNT(*)` })
            .from(xAccountLinkRequests)
            .leftJoin(usersTable, eq(usersTable.id, xAccountLinkRequests.discord_user_id))
            .where(requestFilter)
            .limit(1)
        )[0];
        totalLinks = Number(countRow?.c ?? 0);
      }

      const visibleDiscordIds = userRows.map((u) => u.id);
      linkedXRows =
        visibleDiscordIds.length > 0
          ? await db
              .select({
                discord_user_id: xUsersTable.linked_discord_user_id,
                x_user_id: xUsersTable.id,
                x_name: xUsersTable.x_name,
                icon_url: xUsersTable.icon_url,
                approval_status: xUsersTable.approval_status,
              })
              .from(xUsersTable)
              .where(
                and(
                  inArray(xUsersTable.linked_discord_user_id, visibleDiscordIds),
                  eq(xUsersTable.approval_status, "approved"),
                )!,
              )
              .orderBy(xUsersTable.id)
          : [];

      approvedLinkRows =
        visibleDiscordIds.length > 0
          ? await db
              .select({
                id: xAccountLinkRequests.id,
                discord_user_id: xAccountLinkRequests.discord_user_id,
                discord_name: usersTable.name,
                discord_image: usersTable.image,
                requested_x_id: xAccountLinkRequests.requested_x_id,
                link_type: xAccountLinkRequests.link_type,
                target_x_user_id: xAccountLinkRequests.target_x_user_id,
                status: xAccountLinkRequests.status,
                requested_at: xAccountLinkRequests.requested_at,
              })
              .from(xAccountLinkRequests)
              .leftJoin(usersTable, eq(usersTable.id, xAccountLinkRequests.discord_user_id))
              .where(
                and(
                  eq(xAccountLinkRequests.status, "approved"),
                  inArray(xAccountLinkRequests.discord_user_id, visibleDiscordIds),
                )!,
              )
              .orderBy(desc(xAccountLinkRequests.requested_at))
          : [];

      permissionSettings =
        (
          await db
            .select({
              default_editable_fields: systemSettings.default_editable_fields,
              upcoming_editable_fields: systemSettings.upcoming_editable_fields,
            })
            .from(systemSettings)
            .where(eq(systemSettings.id, "global"))
            .limit(1)
        )[0] ?? permissionSettings;
    } catch (e) {
      console.error("[AdminUsersPage] fetch failed", e);
    }
  }

  const linkedXByDiscord = new Map<string, CurrentLinkedXRow[]>();
  for (const row of linkedXRows) {
    if (!row.discord_user_id) continue;
    const rows = linkedXByDiscord.get(row.discord_user_id) ?? [];
    rows.push(row);
    linkedXByDiscord.set(row.discord_user_id, rows);
  }

  const currentTotal =
    activeView === "xid" ? totalXUsers : activeView === "links" ? totalLinks : totalUsers;
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
        title="ユーザー管理"
        description="Discord と X ID の現在の紐付け、連携申請、編集権限を管理します。"
      />

      <nav style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 16 }}>
        {[
          ["discord", "Discord軸"],
          ["xid", "X ID軸"],
          ["links", "連携申請"],
          ["permissions", "権限"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={`/admin/users?view=${key}${q ? `&q=${encodeURIComponent(q)}` : ""}${status ? `&status=${encodeURIComponent(status)}` : ""}`}
            className={`fn-btn fn-btn-sm ${activeView === key ? "fn-btn-primary" : "fn-btn-ghost"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

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
        {activeView === "discord" || activeView === "permissions" ? (
          <select className="fn-select" name="status" defaultValue={status}>
            <option value="">すべて</option>
            <option value="active">有効</option>
            <option value="banned">BAN</option>
            <option value="admin">admin</option>
            <option value="moderator">moderator</option>
            <option value="tos_not_accepted">TOS未同意</option>
            <option value="no_active_x">active Xなし</option>
          </select>
        ) : null}
        <button type="submit" className="fn-btn fn-btn-primary">
          <Icon name="search" size={12} aria-hidden />
          検索
        </button>
        {(q || status) ? (
          <Link href={`/admin/users?view=${activeView}`} className="fn-btn fn-btn-ghost">
            解除
          </Link>
        ) : null}
      </form>

      {activeView === "discord" ? (
        <DiscordTable rows={userRows} linkedXByDiscord={linkedXByDiscord} />
      ) : activeView === "xid" ? (
        <XIdTable rows={xRows} links={approvedLinkRows} />
      ) : activeView === "links" ? (
        <LinkRequestTable rows={linkRows} />
      ) : (
        <PermissionsPanel settings={permissionSettings} />
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
  linkedXByDiscord,
}: {
  rows: AdminUserRow[];
  linkedXByDiscord: Map<string, CurrentLinkedXRow[]>;
}): React.ReactElement {
  return (
    <table className="fn-table" style={{ marginTop: 18 }}>
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
                const links = linkedXByDiscord.get(u.id) ?? [];
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
    </table>
  );
}

function XIdTable({
  rows,
  links,
}: {
  rows: AdminXUserRow[];
  links: LinkRequestRow[];
}): React.ReactElement {
  const linksForXid = (x: AdminXUserRow) =>
    x.linked_discord_user_id
      ? links.filter(
          (link) =>
            link.discord_user_id === x.linked_discord_user_id &&
            normalizeXId(link.target_x_user_id ?? link.requested_x_id) === normalizeXId(x.id),
        )
      : [];

  return (
    <table className="fn-table" style={{ marginTop: 18 }}>
      <thead>
        <tr>
          <th>X ID</th>
          <th>Discord連携</th>
          <th>状態</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((x, index) => {
          const linkedRequests = linksForXid(x);
          return (
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
                {x.linked_discord_user_id ? (
                  <span>
                    <strong>{x.linked_discord_name ?? "Discord user"}</strong>
                    <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                      {x.linked_discord_user_id.slice(0, 14)}...
                    </span>
                  </span>
                ) : (
                  <span className="fn-badge fn-badge-warning">Discord未連携</span>
                )}
                {linkedRequests.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                    {linkedRequests.map((link) => (
                      <span key={link.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {link.discord_image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={link.discord_image}
                            alt=""
                            width={22}
                            height={22}
                            style={{ borderRadius: 999, objectFit: "cover" }}
                          />
                        ) : (
                          <span
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: 999,
                              display: "grid",
                              placeItems: "center",
                              background: "var(--bg-elevated)",
                              color: "var(--text-muted)",
                            }}
                          >
                            <Icon name="discord" size={10} aria-hidden />
                          </span>
                        )}
                        <span>
                          <strong>{link.discord_name ?? "Discord user"}</strong>
                          <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                            {link.discord_user_id.slice(0, 14)}...
                          </span>
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}
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
                {normalizeXId(x.active_holder_id) === normalizeXId(x.id) ? (
                  <span className="fn-badge fn-badge-soft" style={{ marginLeft: 6 }}>
                    active
                  </span>
                ) : null}
              </td>
              <td>
                {x.linked_discord_user_id ? (
                  <Link
                    href={`/admin/users/${x.linked_discord_user_id}`}
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
          );
        })}
      </tbody>
    </table>
  );
}

function LinkRequestTable({ rows }: { rows: LinkRequestRow[] }): React.ReactElement {
  return (
    <table className="fn-table" style={{ marginTop: 18 }}>
      <thead>
        <tr>
          <th>Discord</th>
          <th>X ID</th>
          <th>種別</th>
          <th>状態</th>
          <th>申請</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <strong>{r.discord_name ?? "Discord user"}</strong>
              <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                {r.discord_user_id}
              </span>
            </td>
            <td>@{normalizeXId(r.target_x_user_id ?? r.requested_x_id)}</td>
            <td>{r.link_type}</td>
            <td>
              <span
                className={`fn-badge ${
                  r.status === "approved"
                    ? "fn-badge-accent"
                    : r.status === "rejected"
                      ? "fn-badge-danger"
                      : "fn-badge-warning"
                }`}
              >
                {approvalStatusLabel(r.status)}
              </span>
            </td>
            <td>{formatRelative(r.requested_at)}</td>
          </tr>
        ))}
        {rows.length === 0 ? (
          <tr>
            <td colSpan={5}>
              <p className="fn-empty-message" style={{ padding: 16, textAlign: "center" }}>
                連携申請が見つかりません。
              </p>
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function PermissionsPanel({
  settings,
}: {
  settings: PermissionSettings;
}): React.ReactElement {
  const defaultSet = new Set((settings.default_editable_fields ?? "").split(",").filter(Boolean));
  const upcomingSet = new Set((settings.upcoming_editable_fields ?? "").split(",").filter(Boolean));
  const totalFields = EDITABLE_FIELD_OPTIONS.length;
  const scopes = [
    {
      key: "default",
      name: "default_editable_fields",
      label: "通常作品",
      badge: "通常",
      selected: defaultSet,
      tone: "primary" as const,
      description: "公開済み・通常状態の作品に適用します。",
    },
    {
      key: "upcoming",
      name: "upcoming_editable_fields",
      label: "公開前作品",
      badge: "公開前",
      selected: upcomingSet,
      tone: "warning" as const,
      description: "公開前・予約中の作品に適用します。",
    },
  ];

  return (
    <section
      className="fn-card"
      style={{
        marginTop: 18,
        padding: 24,
        background:
          "linear-gradient(135deg, var(--bg-surface), var(--bg-elevated) 72%, var(--accent-primary-soft))",
      }}
    >
      <header
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr)",
          gap: 14,
          alignItems: "flex-start",
          marginBottom: 18,
        }}
      >
        <span
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 40,
            height: 40,
            border: "1px solid var(--accent-primary)",
            borderRadius: 12,
            color: "var(--accent-primary)",
            background: "var(--accent-primary-soft)",
          }}
        >
          <Icon name="settings" size={18} aria-hidden />
        </span>
        <div>
          <p
            style={{
              margin: "0 0 4px",
              color: "var(--accent-primary)",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.12em",
            }}
          >
            GENERAL VIDEO PERMISSIONS
          </p>
          <h2 style={{ margin: 0, fontSize: 20 }}>一般作品権限(イベント毎)</h2>
          <p className="fn-muted" style={{ marginTop: 8, marginBottom: 0, lineHeight: 1.7 }}>
            一般ユーザーに開放する作品編集範囲を、通常作品と公開前作品で分けて設定します。
            チェックを入れた項目だけが、イベント単位の許可対象になります。
          </p>
        </div>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 10,
          marginBottom: 18,
        }}
      >
        {scopes.map((scope) => (
          <StatusSummary
            key={scope.key}
            label={scope.label}
            tone={scope.tone}
            selected={scope.selected}
            total={totalFields}
            description={scope.description}
          />
        ))}
      </div>

      <form action={updateGlobalEditableFieldsAction} style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gap: 12 }}>
          {EDITABLE_FIELD_GROUPS.map((group) => (
            <section
              key={group.label}
              style={{
                border: "1px solid var(--border-subtle)",
                borderRadius: 12,
                background: "var(--bg-surface)",
                overflow: "hidden",
              }}
            >
              <header
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "12px 14px",
                  borderBottom: "1px solid var(--border-subtle)",
                  background: "var(--bg-base)",
                }}
              >
                <div>
                  <strong style={{ fontSize: 13 }}>{group.label}</strong>
                  <p className="fn-muted" style={{ margin: "3px 0 0", fontSize: 11.5 }}>
                    {group.description}
                  </p>
                </div>
                <span className="fn-badge fn-badge-soft">{group.fields.length}項目</span>
              </header>
              <div style={{ display: "grid" }}>
                {group.fields.map(([value, label]) => (
                  <div
                    key={value}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                      padding: "12px 14px",
                      borderTop: "1px solid var(--border-subtle)",
                    }}
                  >
                    <div style={{ minWidth: 180 }}>
                      <span style={{ display: "block", fontWeight: 800, fontSize: 13 }}>
                        {label}
                      </span>
                      <span className="fn-muted" style={{ display: "block", fontSize: 11 }}>
                        {value}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {scopes.map((scope) => (
                        <PermissionCheckbox
                          key={`${scope.key}-${value}`}
                          name={scope.name}
                          value={value}
                          checked={scope.selected.has(value)}
                          label={`${scope.label}で${label}を許可`}
                          scopeLabel={scope.badge}
                          tone={scope.tone}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <p className="fn-muted" style={{ margin: 0, fontSize: 12 }}>
            チェックを外した項目は、作者または管理者だけが編集できます。
          </p>
          <button type="submit" className="fn-btn fn-btn-primary">
            <Icon name="check" size={12} aria-hidden />
            保存
          </button>
        </div>
      </form>
    </section>
  );
}

function StatusSummary({
  label,
  tone,
  selected,
  total,
  description,
}: {
  label: string;
  tone: "primary" | "warning";
  selected: Set<string>;
  total: number;
  description: string;
}): React.ReactElement {
  const accentColor =
    tone === "warning" ? "var(--accent-warning, #d97706)" : "var(--accent-primary)";
  const ratio = total > 0 ? Math.round((selected.size / total) * 100) : 0;
  const enabledLabels = EDITABLE_FIELD_OPTIONS.filter(([value]) => selected.has(value)).map(
    ([, label]) => label,
  );
  return (
    <div
      style={{
        padding: 14,
        border: "1px solid var(--border-subtle)",
        borderTop: `3px solid ${accentColor}`,
        borderRadius: 12,
        background: "var(--bg-surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <strong style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <Icon name={tone === "warning" ? "clock" : "check"} size={13} aria-hidden />
          {label}
        </strong>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
            {selected.size}
          </span>
          {" / "}
          {total}
        </span>
      </div>
      <p className="fn-muted" style={{ margin: "4px 0 6px", fontSize: 11 }}>
        {description}
      </p>
      <div
        aria-hidden
        style={{
          height: 6,
          margin: "8px 0 10px",
          borderRadius: 999,
          background: "var(--bg-elevated)",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            display: "block",
            width: `${ratio}%`,
            height: "100%",
            borderRadius: 999,
            background: accentColor,
          }}
        />
      </div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>
        現在の許可項目
      </div>
      {enabledLabels.length === 0 ? (
        <span className="fn-muted" style={{ fontSize: 11 }}>
          オーナー以外は編集不可
        </span>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {enabledLabels.map((name) => (
            <span
              key={name}
              className="fn-badge fn-badge-soft"
              style={{
                fontSize: 10,
                padding: "2px 7px",
                borderColor: `color-mix(in srgb, ${accentColor} 40%, transparent)`,
                color: accentColor,
              }}
            >
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PermissionCheckbox({
  name,
  value,
  checked,
  label,
  scopeLabel,
  tone,
}: {
  name: string;
  value: string;
  checked: boolean;
  label: string;
  scopeLabel: string;
  tone: "primary" | "warning";
}): React.ReactElement {
  const accentColor =
    tone === "warning" ? "var(--accent-warning, #d97706)" : "var(--accent-primary)";
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        minHeight: 32,
        padding: "6px 9px",
        border: `1px solid ${checked ? accentColor : "var(--border-subtle)"}`,
        borderRadius: 999,
        background: checked ? "var(--accent-primary-soft)" : "var(--bg-base)",
        color: checked ? "var(--text-primary)" : "var(--text-muted)",
        fontSize: 11,
        fontWeight: 800,
        cursor: "pointer",
      }}
      title={label}
    >
      <span className="fn-sr-only">{label}</span>
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={checked}
        style={{ width: 14, height: 14, accentColor }}
      />
      {scopeLabel}
    </label>
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
