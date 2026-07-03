import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { EventStaffManager, type CollaboratorRow } from "@/components/admin/EventStaffManager";
import { ManageEventTabs } from "@/components/manage/ManageEventTabs";
import { ManagePageHeader } from "@/components/manage/ManagePageHeader";
import { Icon } from "@/components/ui/Icon";
import { requireSession } from "@/lib/auth/guard";
import { getCollaboratorPermissions } from "@/lib/auth/ownership";
import { getDatabase } from "@/lib/cloudflare";
import { COLLABORATOR_PERMISSION_LABELS } from "@/lib/constants/collaborator-permissions";
import { resolveStaffPermissionKeys } from "@/lib/auth/permissions/mask";
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

type StaffRow = {
  id: string;
  x_user_id: string | null;
  discord_user_id: string | null;
  display_name: string | null;
  role: string | null;
  permission_preset: string | null;
  permission_mask: number | null;
  custom_permission_keys_json: string | null;
  is_public: number | null;
  public_role_label: string | null;
  internal_note: string | null;
  approved_at: number | null;
  approved_by_user_id: string | null;
  x_name: string | null;
  icon_url: string | null;
  approval_status: string | null;
};

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

  const ev = (
    await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
  )[0];
  if (!ev) notFound();

  const isAdmin = user.role === "admin";
  const permissionsForCurrentUser = isAdmin
    ? new Set<string>()
    : await getCollaboratorPermissions(db, user.id, id);
  if (!isAdmin && permissionsForCurrentUser.size === 0) notFound();
  const canManageMembers =
    isAdmin || permissionsForCurrentUser.has("event.members");

  const staff = await db
    .select({
      id: eventStaffTable.id,
      x_user_id: eventStaffTable.x_user_id,
      discord_user_id: eventStaffTable.discord_user_id,
      display_name: eventStaffTable.display_name,
      role: eventStaffTable.role,
      permission_preset: eventStaffTable.permission_preset,
      permission_mask: eventStaffTable.permission_mask,
      custom_permission_keys_json: eventStaffTable.custom_permission_keys_json,
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

  const permissionKeysByStaffId = new Map<string, string[]>();
  for (const row of staff) {
    permissionKeysByStaffId.set(
      row.id,
      Array.from(resolveStaffPermissionKeys(row)),
    );
  }

  const editors = staff
    .filter((s) => s.x_user_id && (s.role === "editor" || s.role === "representative"))
    .map((s) => ({
      x_user_id: s.x_user_id ?? "",
      role: (s.role ?? "editor") as "editor" | "representative",
      is_public: s.is_public,
      public_role_label: s.public_role_label,
      internal_note: s.internal_note,
      x_name: s.x_name,
      icon_url: s.icon_url,
    }));

  const collabMap = new Map<string, CollaboratorRow>();
  for (const row of staff) {
    const permissionKeys = permissionKeysByStaffId.get(row.id) ?? [];
    if (permissionKeys.length === 0) continue;
    const existing = collabMap.get(row.id);
    if (existing) {
      existing.permission_keys.push(...permissionKeys);
    } else {
      collabMap.set(row.id, {
        key: row.id,
        x_user_id: row.x_user_id,
        discord_user_id: row.discord_user_id,
        display_name:
          row.display_name ?? row.x_user_id ?? row.discord_user_id ?? "未設定",
        is_public_staff: row.is_public,
        public_role_label: row.public_role_label,
        permission_keys: permissionKeys,
      });
    }
  }

  const collaboratorRows = Array.from(collabMap.values());
  const publicStaffCount = staff.filter((s) => s.is_public === 1).length;
  const permissionCount = Array.from(permissionKeysByStaffId.values()).reduce(
    (sum, keys) => sum + keys.length,
    0,
  );
  const approvedXCount = staff.filter((s) => s.approval_status === "approved").length;

  return (
    <div style={manageEventAccentStyle(ev.accent_color)}>
      <ManagePageHeader
        title={`${ev.title} の運営メンバー`}
        description="公開ページに表示する運営メンバーと、内部で編集できる権限を同じ画面で管理します。"
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

      <ManageEventTabs eventId={id} active="staff" isAdmin={isAdmin} />

      <section className="fn-console-stat-grid fn-console-section--tight">
        <SummaryCard label="登録メンバー" value={staff.length} note="公開・非公開を含む総数" />
        <SummaryCard label="公開メンバー" value={publicStaffCount} note="イベントページに掲載" />
        <SummaryCard label="権限保持者" value={collaboratorRows.length} note="部分的な編集権限あり" />
        <SummaryCard label="許可項目" value={permissionCount} note={`承認済みX ID ${approvedXCount}件`} />
      </section>

      <section className="fn-console-section">
        <div className="fn-console-badge-row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2 className="fn-console-eyebrow">メンバー構成</h2>
            <p className="fn-console-note">
              公開表示、内部権限、承認状態をまとめて確認できます。
            </p>
          </div>
          {!canManageMembers ? (
            <span className="fn-badge fn-badge-neutral">閲覧のみ</span>
          ) : null}
        </div>
        <StaffOverview rows={staff} permissionKeysByStaffId={permissionKeysByStaffId} />
      </section>

      {canManageMembers ? (
        <section className="fn-card fn-console-card" style={{ padding: 20 }}>
          <div style={{ marginBottom: 18 }}>
            <h2 className="fn-console-card-title">メンバーと権限を編集</h2>
            <p className="fn-console-note">
              代表・運営は全体権限、共同編集権限は必要な項目だけを付与します。
            </p>
          </div>
          <EventStaffManager
            eventId={ev.id}
            editors={editors}
            collaborators={collaboratorRows}
          />
        </section>
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note: string;
}): React.ReactElement {
  return (
    <article className="fn-card fn-console-stat">
      <div className="fn-console-stat-label">{label}</div>
      <div className="fn-console-stat-value">{value.toLocaleString()}</div>
      <p className="fn-console-note">{note}</p>
    </article>
  );
}

function StaffOverview({
  rows,
  permissionKeysByStaffId,
}: {
  rows: StaffRow[];
  permissionKeysByStaffId: Map<string, string[]>;
}): React.ReactElement {
  if (rows.length === 0) {
    return (
      <div className="fn-card fn-console-card" style={{ padding: 18 }}>
        <p className="fn-muted fn-text-sm">運営メンバーはまだ登録されていません。</p>
      </div>
    );
  }

  const representatives = rows.filter((row) => row.role === "representative");
  const editors = rows.filter((row) => row.role === "editor");
  const editorIds = new Set([...representatives, ...editors].map((r) => r.id));

  const collaborators = rows.filter(
    (row) =>
      !editorIds.has(row.id) &&
      (permissionKeysByStaffId.get(row.id)?.length ?? 0) > 0,
  );
  const others = rows.filter(
    (row) =>
      !editorIds.has(row.id) &&
      (permissionKeysByStaffId.get(row.id)?.length ?? 0) === 0,
  );

  return (
    <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
      <StaffGroup
        title="代表・運営"
        rows={[...representatives, ...editors]}
        showPermissions={false}
      />
      {collaborators.length > 0 ? (
        <StaffGroup
          title="共同編集権限"
          rows={collaborators}
          permissionKeysByStaffId={permissionKeysByStaffId}
          showPermissions
        />
      ) : null}
      {others.length > 0 ? (
        <StaffGroup
          title="その他の登録"
          rows={others}
        />
      ) : null}
    </div>
  );
}

function StaffGroup({
  title,
  rows,
  permissionKeysByStaffId,
  showPermissions = false,
}: {
  title: string;
  rows: StaffRow[];
  permissionKeysByStaffId?: Map<string, string[]>;
  showPermissions?: boolean;
}): React.ReactElement {
  return (
    <section className="fn-card" style={{ padding: 16 }}>
      <div className="fn-console-badge-row" style={{ justifyContent: "space-between" }}>
        <h3 className="fn-console-card-title" style={{ margin: 0 }}>{title}</h3>
        <span className="fn-badge fn-badge-soft">{rows.length}件</span>
      </div>
      {rows.length === 0 ? (
        <p className="fn-console-note">該当するメンバーはいません。</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
            gap: 10,
            marginTop: 12,
          }}
        >
          {rows.map((row) => (
            <StaffCard
              key={row.id}
              row={row}
              permissionKeys={showPermissions ? (permissionKeysByStaffId?.get(row.id) ?? []) : []}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function StaffCard({
  row,
  permissionKeys,
}: {
  row: StaffRow;
  permissionKeys: string[];
}): React.ReactElement {
  const name = row.x_name ?? row.display_name ?? row.x_user_id ?? "未設定";
  return (
    <article
      style={{
        display: "grid",
        gap: 10,
        padding: 12,
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-base)",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
        <StaffAvatar iconUrl={row.icon_url} name={name} />
        <div style={{ minWidth: 0 }}>
          {row.x_user_id ? (
            <Link
              href={`/user/${row.x_user_id}`}
              style={{ fontWeight: 700, overflowWrap: "anywhere" }}
            >
              {name}
            </Link>
          ) : (
            <strong style={{ overflowWrap: "anywhere" }}>{name}</strong>
          )}
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {row.x_user_id ? `@${row.x_user_id}` : row.discord_user_id ?? row.id}
          </div>
        </div>
      </div>

      <div className="fn-console-badge-row">
        <span className={row.role === "representative" ? "fn-badge fn-badge-accent" : "fn-badge fn-badge-soft"}>
          {roleLabel(row.role)}
        </span>
        <span className={row.is_public === 1 ? "fn-badge fn-badge-soft" : "fn-badge fn-badge-neutral"}>
          {row.is_public === 1 ? "公開" : "非公開"}
        </span>
        {row.approval_status ? (
          <span className="fn-badge fn-badge-neutral">{row.approval_status}</span>
        ) : null}
      </div>

      {row.public_role_label ? (
        <p className="fn-console-note">公開ラベル: {row.public_role_label}</p>
      ) : null}

      {permissionKeys.length > 0 ? (
        <div className="fn-console-badge-row">
          {permissionKeys.map((key) => (
            <span key={key} className="fn-badge fn-badge-soft" title={key}>
              {permissionLabel(key)}
            </span>
          ))}
        </div>
      ) : null}

      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {row.approved_at ? (
          <>承認: {formatUnix(row.approved_at, { dateOnly: true })}</>
        ) : (
          "未承認"
        )}
      </div>
      {row.internal_note ? (
        <p className="fn-console-note" style={{ overflowWrap: "anywhere" }}>
          {row.internal_note}
        </p>
      ) : null}
    </article>
  );
}

function StaffAvatar({
  iconUrl,
  name,
}: {
  iconUrl: string | null;
  name: string;
}): React.ReactElement {
  if (iconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconUrl}
        alt=""
        width={40}
        height={40}
        style={{ borderRadius: 999, objectFit: "cover", flex: "0 0 auto" }}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: 40,
        height: 40,
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        flex: "0 0 auto",
        background: "var(--bg-elevated)",
        color: "var(--text-secondary)",
        fontWeight: 800,
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function roleLabel(role: string | null): string {
  if (role === "representative") return "代表";
  if (role === "editor") return "運営";
  return "スタッフ";
}

function permissionLabel(key: string): string {
  return (
    COLLABORATOR_PERMISSION_LABELS[
      key as keyof typeof COLLABORATOR_PERMISSION_LABELS
    ]?.label ?? key
  );
}
