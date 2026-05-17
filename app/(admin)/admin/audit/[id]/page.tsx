import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
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

      <section style={{ marginTop: 20, display: "grid", gap: 10 }}>
        <Meta label="テーブル" value={row.table_name} mono />
        <Meta label="操作" value={row.action} />
        <Meta
          label="レコード ID"
          value={row.record_id}
          mono
          link={`/admin/audit?record=${encodeURIComponent(row.record_id)}`}
        />
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
