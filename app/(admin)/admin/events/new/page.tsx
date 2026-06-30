import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { EventForm } from "@/components/admin/EventForm";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Icon } from "@/components/ui/Icon";
import { getDatabase } from "@/lib/cloudflare";
import {
  parseEventTemplateSnapshot,
  snapshotToFormInitial,
} from "@/lib/admin/eventTemplateSettings";
import { eventTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { listEventTemplatesForAdmin } from "@/lib/actions/event-template-admin";

export const metadata: Metadata = { title: "新規イベント作成" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams?: Promise<{ template?: string }>;
}

export default async function AdminNewEventPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const sp = (await searchParams) ?? {};
  const templateId =
    typeof sp.template === "string" && sp.template.trim().length > 0
      ? sp.template.trim()
      : "";

  const templates = await listEventTemplatesForAdmin();

  let templateName: string | null = null;
  let formInitial = undefined;

  if (templateId) {
    const db = getDatabase();
    const row = db
      ? (
          await db
            .select()
            .from(eventTemplates)
            .where(eq(eventTemplates.id, templateId))
            .limit(1)
        )[0]
      : undefined;
    if (row) {
      templateName = row.name;
      const snapshot = parseEventTemplateSnapshot(row.settings_json);
      if (snapshot) {
        formInitial = snapshotToFormInitial(snapshot);
      }
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="新規イベント作成"
        description={
          templateName
            ? `テンプレート「${templateName}」の設定を読み込みました。開催日時は空欄のまま入力してください。`
            : "イベント本体を作成します。枠とイベント管理者は作成後に追加します。"
        }
        backHref="/admin/events"
        backLabel="イベント一覧へ"
        actions={[
          {
            href: "/admin/events/templates",
            label: "テンプレート一覧",
            icon: <Icon name="list" size={12} aria-hidden />,
          },
        ]}
      />

      {templates.length > 0 ? (
        <section
          className="fn-card"
          style={{ marginTop: 16, padding: "14px 18px" }}
        >
          <p className="fn-label" style={{ margin: "0 0 8px" }}>
            テンプレートから作成
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {templates.map((t) => (
              <Link
                key={t.id}
                href={`/admin/events/new?template=${encodeURIComponent(t.id)}`}
                className={
                  t.id === templateId
                    ? "fn-btn fn-btn-primary fn-btn-sm"
                    : "fn-btn fn-btn-ghost fn-btn-sm"
                }
              >
                {t.name}
              </Link>
            ))}
            {templateId ? (
              <Link href="/admin/events/new" className="fn-btn fn-btn-ghost fn-btn-sm">
                テンプレートなし
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      <section
        style={{
          marginTop: 18,
          padding: "20px 22px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <EventForm
          mode="create"
          initial={formInitial}
          templateId={templateId || undefined}
        />
      </section>

      <p style={{ marginTop: 22 }}>
        <Link href="/admin/events" className="fn-btn fn-btn-ghost">
          <Icon name="chevron-left" size={12} aria-hidden /> イベント管理に戻る
        </Link>
      </p>
    </div>
  );
}
