import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { historyLogs } from "@/lib/db/schema";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "監査ログ詳細" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminAuditDetailPage({
  params,
}: Props): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const db = getDatabase();
  if (!db) notFound();

  const row = (
    await db.select().from(historyLogs).where(eq(historyLogs.id, id)).limit(1)
  )[0];
  if (!row) notFound();

  const before = formatJson(row.before_data);
  const after = formatJson(row.after_data);

  // 同一 record_id の前後ナビ
  const [prevRow, nextRow] = await Promise.all([
    db
      .select({ id: historyLogs.id })
      .from(historyLogs)
      .where(
        and(eq(historyLogs.record_id, row.record_id), lt(historyLogs.id, row.id))!,
      )
      .orderBy(desc(historyLogs.id))
      .limit(1),
    db
      .select({ id: historyLogs.id })
      .from(historyLogs)
      .where(
        and(eq(historyLogs.record_id, row.record_id), gt(historyLogs.id, row.id))!,
      )
      .orderBy(asc(historyLogs.id))
      .limit(1),
  ]);

  return (
    <div>
      <p style={{ marginBottom: 8, fontSize: 12 }}>
        <Link href="/admin/audit">
          <Icon name="chevron-left" size={12} aria-hidden /> 監査ログ一覧へ
        </Link>
      </p>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>監査ログ #{row.id}</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>
        {formatUnix(row.created_at)} ({formatRelative(row.created_at)})
      </p>

      <nav
        aria-label="同 record_id の前後遷移"
        style={{
          marginTop: 10,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          fontSize: 12,
        }}
      >
        {prevRow[0] ? (
          <Link
            href={`/admin/audit/${prevRow[0].id}`}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            <Icon name="chevron-left" size={11} aria-hidden /> 前 (#{prevRow[0].id})
          </Link>
        ) : null}
        {nextRow[0] ? (
          <Link
            href={`/admin/audit/${nextRow[0].id}`}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            次 (#{nextRow[0].id}) <Icon name="chevron-right" size={11} aria-hidden />
          </Link>
        ) : null}
      </nav>

      <section style={{ marginTop: 20, display: "grid", gap: 10 }}>
        <Meta label="テーブル" value={row.table_name} mono />
        <Meta label="操作" value={row.action} />
        <Meta
          label="レコード ID"
          value={row.record_id}
          mono
          link={`/admin/audit?record=${encodeURIComponent(row.record_id)}`}
        />
        {(() => {
          // 表別に詳細ページへのジャンプリンクを出す
          const adminLink = (() => {
            switch (row.table_name) {
              case "videos":
                return `/admin/videos/${encodeURIComponent(row.record_id)}`;
              case "events":
                return `/admin/events/${encodeURIComponent(row.record_id)}`;
              case "users":
                return `/admin/users/${encodeURIComponent(row.record_id)}`;
              case "x_account_link_requests":
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
          return (
            <Meta
              label="詳細ページ"
              value="開く"
              link={adminLink}
            />
          );
        })()}
        <Meta
          label="実行者 (Discord)"
          value={row.operator_discord_id ?? "—"}
          link={
            row.operator_discord_id
              ? `/admin/users/${encodeURIComponent(row.operator_discord_id)}`
              : undefined
          }
        />
        <Meta label="retention_class" value={row.retention_class ?? "normal"} />
      </section>

      <section style={{ marginTop: 28 }}>
        <h2
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.18em",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          before
        </h2>
        <pre
          style={{
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
          }}
        >
          {before ?? "(null)"}
        </pre>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.18em",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          after
        </h2>
        <pre
          style={{
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
          }}
        >
          {after ?? "(null)"}
        </pre>
      </section>
    </div>
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
          minWidth: 140,
          color: "var(--text-muted)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span style={{ fontFamily: mono ? "monospace" : undefined, fontSize: mono ? 12 : 13 }}>
        {link ? <Link href={link}>{value}</Link> : value}
      </span>
    </div>
  );
}

function formatJson(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
