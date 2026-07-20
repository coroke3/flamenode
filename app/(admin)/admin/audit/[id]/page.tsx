import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { auditLogs } from "@/lib/db/schema";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { Icon } from "@/components/ui/Icon";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AuditDiffDetail } from "@/components/admin/AuditDiffDetail";
import { AuditRestoreForm } from "@/components/admin/AuditRestoreForm";

export const metadata: Metadata = { title: "監査ログ詳細" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

const RESTORE_STATUS_LABELS: Record<string, string> = {
  restorable: "復元可能",
  restored: "復元済み",
  expired: "期限切れ",
  not_restorable: "復元不可",
  blocked: "競合",
  failed: "失敗",
};

const RESTORE_STATUS_CLASS: Record<string, string> = {
  restorable: "fn-badge-accent",
  restored: "fn-badge-soft",
  expired: "fn-badge-warning",
  not_restorable: "",
  blocked: "fn-badge-warning",
  failed: "fn-badge-danger",
};

export default async function AdminAuditDetailPage({
  params,
}: Props): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const { id: auditId } = await params;
  if (!auditId || auditId.length === 0) notFound();

  const db = getDatabase();
  if (!db) notFound();

  const row = (
    await db.select().from(auditLogs).where(eq(auditLogs.id, auditId)).limit(1)
  )[0];
  if (!row) notFound();

  const targetId = row.target_id;

  // 同一 target_id の前後ナビ（created_at 順）
  const [prevRows, nextRows] = await Promise.all([
    db
      .select({ id: auditLogs.id, created_at: auditLogs.created_at })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.target_id, targetId),
          lt(auditLogs.created_at, row.created_at),
        ),
      )
      .orderBy(desc(auditLogs.created_at))
      .limit(1),
    db
      .select({ id: auditLogs.id, created_at: auditLogs.created_at })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.target_id, targetId),
          gt(auditLogs.created_at, row.created_at),
        ),
      )
      .orderBy(asc(auditLogs.created_at))
      .limit(1),
  ]);

  const prevRow = prevRows[0];
  const nextRow = nextRows[0];

  const actorSnapshot = (() => {
    if (!row.actor_snapshot_json) return null;
    try {
      return JSON.parse(row.actor_snapshot_json) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  const changedKeys = (() => {
    if (!row.changed_keys_json) return null;
    try {
      const parsed = JSON.parse(row.changed_keys_json);
      if (Array.isArray(parsed)) return parsed as string[];
      return null;
    } catch {
      return null;
    }
  })();

  const restoreStatusLabel =
    RESTORE_STATUS_LABELS[row.restore_status] ?? row.restore_status;
  const restoreStatusClass =
    RESTORE_STATUS_CLASS[row.restore_status] ?? "fn-badge-soft";

  return (
    <div>
      <AdminPageHeader
        title={`監査ログ ${row.id}`}
        description={`${formatUnix(row.created_at)} (${formatRelative(row.created_at)})`}
        backHref="/admin/audit"
        backLabel="監査ログ一覧へ"
      />

      <nav
        aria-label="同 target_id の前後遷移"
        style={{
          marginTop: 10,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          fontSize: 12,
        }}
      >
        {prevRow ? (
          <Link
            href={`/admin/audit/${prevRow.id}`}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            <Icon name="chevron-left" size={11} aria-hidden /> 前 ({formatUnix(prevRow.created_at)})
          </Link>
        ) : null}
        {nextRow ? (
          <Link
            href={`/admin/audit/${nextRow.id}`}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            次 ({formatUnix(nextRow.created_at)}) <Icon name="chevron-right" size={11} aria-hidden />
          </Link>
        ) : null}
        <Link
          href={`/admin/audit?record=${encodeURIComponent(targetId)}`}
          className="fn-btn fn-btn-ghost fn-btn-sm"
        >
          同じ target_id を一覧表示
        </Link>
      </nav>

      <section style={{ marginTop: 20, display: "grid", gap: 10 }}>
        <Meta label="ID" value={row.id} mono />
        <Meta label="テーブル" value={row.table_name} mono />
        <Meta label="操作種別" value={row.operation} />
        <Meta
          label="対象レコード ID"
          value={targetId}
          mono
          link={`/admin/audit?record=${encodeURIComponent(targetId)}`}
        />
        <Meta
          label="実行者 user_id"
          value={row.actor_user_id}
          mono
          link={`/admin/users/${encodeURIComponent(row.actor_user_id)}`}
        />
        {row.context ? <Meta label="コンテキスト" value={row.context} /> : null}
        {row.reason ? <Meta label="理由" value={row.reason} /> : null}
        <div style={{ display: "flex", gap: 12, alignItems: "baseline", fontSize: 13 }}>
          <span
            style={{
              minWidth: 160,
              color: "var(--text-muted)",
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            復元ステータス
          </span>
          <span className={`fn-badge ${restoreStatusClass}`}>
            {restoreStatusLabel}
          </span>
        </div>
        {row.restore_unavailable_message ? (
          <Meta
            label="復元不可理由"
            value={row.restore_unavailable_message}
          />
        ) : null}

        {row.restore_unavailable_reason_code ? (
          <Meta
            label="理由コード"
            value={
              row.restore_unavailable_reason_code
            }
            mono
          />
        ) : null}
        <Meta label="復元戦略" value={row.restore_strategy} mono />
        <Meta label="retention_class" value={row.retention_class} />
        <Meta label="payload_size_bytes" value={String(row.payload_size_bytes)} mono />
        {row.expires_at ? (
          <Meta
            label="有効期限"
            value={`${formatUnix(row.expires_at)} (${formatRelative(row.expires_at)})`}
          />
        ) : null}

        {(() => {
          const adminLink = (() => {
            switch (row.table_name) {
              case "videos":
                return `/admin/videos/${encodeURIComponent(targetId)}`;
              case "events":
                return `/manage/events/${encodeURIComponent(targetId)}/edit`;
              case "users":
                return `/admin/users/${encodeURIComponent(targetId)}`;
              case "x_identity_requests":
                return `/admin/x-link-requests`;
              case "notification_outbox":
                return `/admin/notifications?status=failed`;
              case "system_settings":
                return `/admin/cost-guard`;
              default:
                return null;
            }
          })();
          if (!adminLink) return null;
          return <Meta label="詳細ページ" value="開く" link={adminLink} />;
        })()}
      </section>

      {/* アクタースナップショット */}
      {actorSnapshot && (
        <section style={{ marginTop: 24 }}>
          <SectionHeading>実行者スナップショット (当時)</SectionHeading>
          <pre style={preStyle}>
            {JSON.stringify(actorSnapshot, null, 2)}
          </pre>
        </section>
      )}

      {/* 変更キー */}
      {changedKeys && changedKeys.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <SectionHeading>変更されたキー ({changedKeys.length})</SectionHeading>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginTop: 8,
            }}
          >
            {changedKeys.map((k) => (
              <code
                key={k}
                className="fn-badge fn-badge-soft"
                style={{ fontFamily: "monospace", fontSize: 11 }}
              >
                {k}
              </code>
            ))}
          </div>
        </section>
      )}

      {/* 差分 */}
      <section style={{ marginTop: 24 }}>
        <SectionHeading>差分</SectionHeading>
        <AuditDiffDetail before={row.before_json} after={row.after_json} />
      </section>

      {/* before / after JSON */}
      <section style={{ marginTop: 24 }}>
        <SectionHeading>before</SectionHeading>
        <pre style={preStyle}>{formatJson(row.before_json) ?? "(null)"}</pre>
      </section>

      <section style={{ marginTop: 20 }}>
        <SectionHeading>after</SectionHeading>
        <pre style={preStyle}>{formatJson(row.after_json) ?? "(null)"}</pre>
      </section>

      {/* inverse_patch_json */}
      {row.inverse_patch_json && (
        <section style={{ marginTop: 20 }}>
          <SectionHeading>inverse_patch_json</SectionHeading>
          <pre style={preStyle}>{formatJson(row.inverse_patch_json) ?? "(null)"}</pre>
        </section>
      )}

      {/* リストア */}
      <section style={{ marginTop: 32 }}>
        <SectionHeading>リストア</SectionHeading>
        <AuditRestoreForm
          auditId={row.id}
          restoreStatus={row.restore_status}
          restoreUnavailableReasonCode={
            row.restore_unavailable_reason_code
          }
          restoreUnavailableMessage={
            row.restore_unavailable_message
          }
        />
      </section>
    </div>
  );
}

function SectionHeading({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <h2
      style={{
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.18em",
        color: "var(--text-muted)",
        textTransform: "uppercase",
        marginBottom: 8,
        marginTop: 0,
      }}
    >
      {children}
    </h2>
  );
}

function Meta({
  label,
  value,
  mono,
  link,
}: {
  label: string;
  value: string;
  mono?: boolean;
  link?: string;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "baseline", fontSize: 13 }}>
      <span
        style={{
          minWidth: 160,
          color: "var(--text-muted)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{ fontFamily: mono ? "monospace" : undefined, fontSize: mono ? 12 : 13 }}
      >
        {link ? <Link href={link}>{value}</Link> : value}
      </span>
    </div>
  );
}

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: 14,
  background: "var(--bg-surface)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-md)",
  fontSize: 12,
  lineHeight: 1.55,
  overflow: "auto",
  fontFamily: "monospace",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  maxHeight: 480,
};

function formatJson(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
