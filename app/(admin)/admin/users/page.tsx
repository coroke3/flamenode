import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, isNull, like, or } from "drizzle-orm";
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

type PermissionSettings = {
  default_editable_fields: string | null;
  upcoming_editable_fields: string | null;
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; view?: string }>;
}): Promise<React.ReactElement> {
  const { q = "", status = "", view = "discord" } = await searchParams;
  const activeView = ["discord", "xid", "links", "permissions"].includes(view)
    ? view
    : "discord";
  const db = getDatabase();

  let userRows: AdminUserRow[] = [];
  let xRows: AdminXUserRow[] = [];
  let linkRows: LinkRequestRow[] = [];
  let approvedLinkRows: LinkRequestRow[] = [];
  let permissionSettings: PermissionSettings = {
    default_editable_fields: null,
    upcoming_editable_fields: null,
  };
  if (db) {
    try {
      const term = `%${q}%`;
      const queryFilter = q
        ? or(
            like(usersTable.name, term),
            like(usersTable.email, term),
            eq(usersTable.id, q),
            like(xUsersTable.id, term),
            like(xUsersTable.x_name, term),
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
        .leftJoin(xUsersTable, eq(xUsersTable.id, usersTable.active_x_user_id))
        .where(where)
        .orderBy(desc(usersTable.created_at))
        .limit(80);
      const userRowsWithIcons = await resolveMissingIcons(
        db,
        userRows.map((u) => ({
          ...u,
          creator_id: u.active_x_user_id,
          icon_url: u.active_x_icon_url,
        })),
      );
      userRows = userRowsWithIcons.map((u) => ({
        ...u,
        active_x_icon_url: u.icon_url,
      }));

      const xFilter = q
        ? or(
            like(xUsersTable.id, term),
            like(xUsersTable.x_name, term),
            like(usersTable.name, term),
            eq(xUsersTable.linked_discord_user_id, q),
          )
        : undefined;
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
        .limit(120);
      const xRowsWithIcons = await resolveMissingIcons(
        db,
        xRows.map((x) => ({
          ...x,
          creator_id: x.id,
          icon_url: x.icon_url,
        })),
      );
      xRows = xRowsWithIcons.map((x) => ({ ...x, icon_url: x.icon_url }));

      const requestFilter = q
        ? or(
            like(xAccountLinkRequests.requested_x_id, term),
            like(xAccountLinkRequests.discord_user_id, term),
            like(usersTable.name, term),
          )
        : undefined;
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
        .limit(120);

      approvedLinkRows = await db
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
        .where(eq(xAccountLinkRequests.status, "approved"))
        .orderBy(desc(xAccountLinkRequests.requested_at))
        .limit(500);

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

  const approvedByDiscord = new Map<string, LinkRequestRow[]>();
  for (const link of approvedLinkRows) {
    const rows = approvedByDiscord.get(link.discord_user_id) ?? [];
    rows.push(link);
    approvedByDiscord.set(link.discord_user_id, rows);
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>ユーザー管理</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        Discord アカウントを軸に、X ID 連携・BAN 状態・管理権限を管理します。
      </p>

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
        method="get"
        style={{
          marginTop: 18,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <input type="hidden" name="view" value={activeView} />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="名前 / メール / ID で検索"
          className="fn-input"
          style={{ maxWidth: 320 }}
        />
        <select name="status" className="fn-select" defaultValue={status}>
          <option value="">すべて</option>
          <option value="active">通常 (BAN 解除済)</option>
          <option value="banned">BAN</option>
          <option value="admin">管理者</option>
          <option value="moderator">モデレーター</option>
          <option value="tos_not_accepted">TOS 未同意</option>
          <option value="no_active_x">active X ID 未設定</option>
        </select>
        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm">
          検索
        </button>
      </form>

      {activeView === "xid" ? (
        <XIdTable rows={xRows} links={approvedLinkRows} />
      ) : activeView === "links" ? (
        <LinkRequestTable rows={linkRows} />
      ) : activeView === "permissions" ? (
        <PermissionsTable rows={userRows} settings={permissionSettings} />
      ) : (
      <table className="fn-table" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>ユーザー</th>
            <th>X ID</th>
            <th>権限</th>
            <th>登録日</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {userRows.map((u) => (
            <tr key={u.id}>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {u.image ?? u.active_x_icon_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
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
                    <div>{u.name ?? "—"}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {u.id.slice(0, 12)}…
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
                  "—"
                )}
                {(() => {
                  const links = approvedByDiscord.get(u.id) ?? [];
                  const xids = Array.from(
                    new Set(
                      links
                        .map((link) =>
                          normalizeXId(link.target_x_user_id ?? link.requested_x_id),
                        )
                        .filter(Boolean),
                    ),
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
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                  >
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
          {userRows.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <p
                  className="fn-empty-message"
                  style={{ padding: 16, textAlign: "center" }}
                >
                  対象ユーザーが見つかりません。
                </p>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      )}
    </div>
  );
}

function XIdTable({
  rows,
  links,
}: {
  rows: AdminXUserRow[];
  links: LinkRequestRow[];
}): React.ReactElement {
  const linksForXid = (xid: string) =>
    links.filter(
      (link) =>
        normalizeXId(link.target_x_user_id ?? link.requested_x_id) ===
        normalizeXId(xid),
    );

  return (
    <table className="fn-table" style={{ marginTop: 18 }}>
      <thead>
        <tr>
          <th>X ID</th>
          <th>Discord 連携</th>
          <th>状態</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((x) => (
          <tr key={x.id}>
            <td>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {x.icon_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={x.icon_url} alt="" width={28} height={28} style={{ borderRadius: 999, objectFit: "cover" }} />
                ) : (
                  <span style={{ width: 28, height: 28, borderRadius: 999, display: "grid", placeItems: "center", background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                    <Icon name="user" size={12} aria-hidden />
                  </span>
                )}
                <span>
                  <strong>{x.x_name}</strong>
                  <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>@{x.id}</span>
                </span>
              </div>
            </td>
            <td>
              {x.linked_discord_user_id ? (
                <span>
                  <strong>{x.linked_discord_name ?? "Discord user"}</strong>
                  <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                    {x.linked_discord_user_id.slice(0, 14)}…
                  </span>
                </span>
              ) : (
                <span className="fn-badge fn-badge-warning">Discord未連携</span>
              )}
              {linksForXid(x.id).length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                  {linksForXid(x.id).map((link) => (
                    <span key={link.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {link.discord_image ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={link.discord_image} alt="" width={22} height={22} style={{ borderRadius: 999, objectFit: "cover" }} />
                      ) : (
                        <span style={{ width: 22, height: 22, borderRadius: 999, display: "grid", placeItems: "center", background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                          <Icon name="discord" size={10} aria-hidden />
                        </span>
                      )}
                      <span>
                        <strong>{link.discord_name ?? "Discord user"}</strong>
                        <span style={{ display: "block", fontSize: 10, color: "var(--text-muted)" }}>
                          {link.discord_user_id}
                        </span>
                      </span>
                    </span>
                  ))}
                </div>
              ) : null}
            </td>
            <td>
              <span className={`fn-badge ${x.approval_status === "approved" ? "fn-badge-accent" : x.approval_status === "rejected" ? "fn-badge-danger" : "fn-badge-warning"}`}>
                {x.approval_status ?? "pending"}
              </span>
              {x.active_holder_id === x.id ? (
                <span className="fn-badge fn-badge-soft" style={{ marginLeft: 6 }}>active</span>
              ) : null}
            </td>
            <td>
              {x.linked_discord_user_id ? (
                <Link href={`/admin/users/${x.linked_discord_user_id}`} className="fn-btn fn-btn-ghost fn-btn-sm">
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
        {rows.length === 0 ? <EmptyRow colSpan={4} /> : null}
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
          <th>申請 X ID</th>
          <th>種別</th>
          <th>状態</th>
          <th>申請日</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <strong>{r.discord_name ?? "Discord user"}</strong>
              <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                {r.discord_user_id.slice(0, 14)}…
              </span>
            </td>
            <td>
              <strong>@{r.requested_x_id}</strong>
              {r.target_x_user_id ? (
                <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                  target @{r.target_x_user_id}
                </span>
              ) : null}
            </td>
            <td>{r.link_type}</td>
            <td>
              <span className={`fn-badge ${r.status === "approved" ? "fn-badge-accent" : r.status === "rejected" ? "fn-badge-danger" : "fn-badge-warning"}`}>
                {r.status ?? "pending"}
              </span>
            </td>
            <td>{formatRelative(r.requested_at)}</td>
            <td>
              <Link href="/admin/x-link-requests" className="fn-btn fn-btn-ghost fn-btn-sm">
                処理
              </Link>
            </td>
          </tr>
        ))}
        {rows.length === 0 ? <EmptyRow colSpan={6} /> : null}
      </tbody>
    </table>
  );
}

const EDITABLE_FIELD_OPTIONS = [
  ["title", "タイトル"],
  ["display_name", "表示名"],
  ["icon_url", "アイコン"],
  ["music", "使用楽曲"],
  ["credit", "クレジット"],
  ["intro_comment", "投稿コメント"],
  ["used_software", "使用ソフト"],
  ["highlights", "見どころ"],
  ["production_story", "制作メモ"],
  ["closing_comment", "締めコメント"],
  ["members", "合作メンバー"],
  ["chapters", "チャプターコメント"],
] as const;

function parseFieldSet(value: string | null): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function PermissionsTable({
  rows,
  settings,
}: {
  rows: AdminUserRow[];
  settings: PermissionSettings;
}): React.ReactElement {
  const defaultSet = parseFieldSet(settings.default_editable_fields);
  const upcomingSet = parseFieldSet(settings.upcoming_editable_fields);
  return (
    <>
    <section className="fn-card" style={{ marginTop: 18, padding: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700 }}>@everyone の作品編集許可</h2>
      <p className="fn-muted fn-text-sm" style={{ marginTop: 4 }}>
        個別のイベント権限がない一般ユーザーに、どの作品情報の編集を許可するかを保存します。イベント側の許可がある場合は、全体設定との和集合で扱う前提です。
      </p>
      <form
        action={async (formData) => {
          "use server";
          await updateGlobalEditableFields(formData);
        }}
        style={{ marginTop: 14, display: "grid", gap: 14 }}
      >
        <fieldset style={{ border: "1px solid var(--border-subtle)", padding: 12 }}>
          <legend style={{ padding: "0 6px", fontWeight: 700 }}>全体の既定</legend>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
            {EDITABLE_FIELD_OPTIONS.map(([value, label]) => (
              <label key={`default-${value}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  name="default_editable_fields"
                  value={value}
                  defaultChecked={defaultSet.has(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset style={{ border: "1px solid var(--border-subtle)", padding: 12 }}>
          <legend style={{ padding: "0 6px", fontWeight: 700 }}>開催前・募集中イベント用</legend>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
            {EDITABLE_FIELD_OPTIONS.map(([value, label]) => (
              <label key={`upcoming-${value}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  name="upcoming_editable_fields"
                  value={value}
                  defaultChecked={upcomingSet.has(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm">
          保存
        </button>
      </form>
    </section>

    <table className="fn-table" style={{ marginTop: 18 }}>
      <thead>
        <tr>
          <th>ユーザー</th>
          <th>一般権限</th>
          <th>状態</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((u) => (
          <tr key={u.id}>
            <td>
              <strong>{u.name ?? "—"}</strong>
              <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>{u.id.slice(0, 14)}…</span>
            </td>
            <td>
              <span className={`fn-badge ${u.role === "admin" ? "fn-badge-accent" : u.role === "moderator" ? "fn-badge-warning" : "fn-badge-soft"}`}>
                {u.role ?? "user"}
              </span>
            </td>
            <td>{u.is_banned === 1 ? <span className="fn-badge fn-badge-danger">BAN</span> : <span className="fn-badge fn-badge-soft">通常</span>}</td>
            <td>
              <Link href={`/admin/users/${u.id}/edit`} className="fn-btn fn-btn-primary fn-btn-sm">
                権限変更
              </Link>
            </td>
          </tr>
        ))}
        {rows.length === 0 ? <EmptyRow colSpan={4} /> : null}
      </tbody>
    </table>
    </>
  );
}

function EmptyRow({ colSpan }: { colSpan: number }): React.ReactElement {
  return (
    <tr>
      <td colSpan={colSpan}>
        <p className="fn-empty-message" style={{ padding: 16, textAlign: "center" }}>
          対象が見つかりません。
        </p>
      </td>
    </tr>
  );
}
