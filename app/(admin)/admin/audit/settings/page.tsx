import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getAuditLogSettings } from "@/lib/audit/settings";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AuditSettingsForm } from "@/components/admin/AuditSettingsForm";

export const metadata: Metadata = { title: "監査ログ設定" };
export const dynamic = "force-dynamic";

export default async function AdminAuditSettingsPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const db = getDatabase();
  if (!db) notFound();

  const settings = await getAuditLogSettings(db);

  return (
    <div>
      <AdminPageHeader
        title="監査ログ設定"
        description="監査ログの保持期間・ペイロードサイズ上限などを管理します。"
        backHref="/admin/audit"
        backLabel="監査ログ一覧へ"
      />

      <div
        style={{
          marginTop: 24,
          padding: 20,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <section style={{ marginBottom: 20 }}>
          <h2
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.14em",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              margin: "0 0 16px",
            }}
          >
            現在の設定
          </h2>
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "8px 16px",
              fontSize: 13,
              margin: 0,
            }}
          >
            <dt style={{ color: "var(--text-muted)", fontSize: 11 }}>通常ログ保持</dt>
            <dd style={{ margin: 0 }}>{settings.normal_retention_days} 日</dd>
            <dt style={{ color: "var(--text-muted)", fontSize: 11 }}>復元可能ログ保持</dt>
            <dd style={{ margin: 0 }}>{settings.restorable_retention_days} 日</dd>
            <dt style={{ color: "var(--text-muted)", fontSize: 11 }}>長期監査ログ保持</dt>
            <dd style={{ margin: 0 }}>{settings.long_audit_retention_days} 日</dd>
            <dt style={{ color: "var(--text-muted)", fontSize: 11 }}>最大ペイロード</dt>
            <dd style={{ margin: 0 }}>
              {settings.max_payload_bytes.toLocaleString()} bytes
            </dd>
            <dt style={{ color: "var(--text-muted)", fontSize: 11 }}>コンパクト化</dt>
            <dd style={{ margin: 0 }}>{settings.compact_after_days} 日後</dd>
          </dl>
        </section>

        <hr
          style={{
            border: "none",
            borderTop: "1px solid var(--border-subtle)",
            margin: "0 0 20px",
          }}
        />

        <section>
          <h2
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.14em",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              margin: "0 0 16px",
            }}
          >
            設定を変更
          </h2>
          <AuditSettingsForm initialSettings={settings} />
        </section>
      </div>
    </div>
  );
}
