import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";

import Link from "next/link";
import type { Metadata } from "next";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AdminSectionTabs } from "@/components/admin/AdminSectionTabs";
import { DeleteEventTemplateButton } from "@/components/admin/DeleteEventTemplateButton";
import { Icon } from "@/components/ui/Icon";
import { listEventTemplatesForAdmin } from "@/lib/actions/event-template-admin";
import { formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = { title: "イベントテンプレート" };
export const dynamic = "force-dynamic";

export default async function AdminEventTemplatesPage(): Promise<React.ReactElement> {
  const templates = await listEventTemplatesForAdmin();

  return (
    <div>
      <AdminPageHeader
        title="イベントテンプレート"
        description="イベントの枠・フォーム・権限などの設定を再利用します。開催日時や枠データはコピーしません。"
        backHref="/admin/events"
        backLabel="イベント管理へ"
        actions={[
          {
            href: "/admin/events/new",
            label: "新規イベント",
            icon: <Icon name="plus" size={12} aria-hidden />,
            variant: "primary",
          },
        ]}
      />

      <AdminSectionTabs hub="events" />

      <section
        className="fn-card"
        style={{ marginTop: 18, padding: "18px 22px" }}
      >
        <p className="fn-muted fn-text-sm" style={{ margin: "0 0 14px" }}>
          既存イベントからテンプレートを作るには、イベント運営トップ（/manage/events/[id]）の「テンプレート化」から保存してください。
        </p>

        {templates.length === 0 ? (
          <p className="fn-muted fn-text-sm">テンプレートはまだありません。</p>
        ) : (
          <FnTable>
            <thead>
              <tr>
                <th>名前</th>
                <th>元イベント</th>
                <th>更新</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                    {t.description ? (
                      <div className="fn-muted fn-text-sm">{t.description}</div>
                    ) : null}
                    <div className="fn-muted fn-text-sm">ID: {t.id}</div>
                  </td>
                  <td>
                    {t.source_event_id ? (
                      <Link href={`/manage/events/${t.source_event_id}`}>
                        {t.source_event_id}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="fn-muted fn-text-sm">
                    {formatUnix(t.updated_at)}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Link
                      href={`/admin/events/new?template=${encodeURIComponent(t.id)}`}
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                      style={{ marginRight: 6 }}
                    >
                      このテンプレートで作成
                    </Link>
                    <DeleteEventTemplateButton
                      templateId={t.id}
                      templateName={t.name}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </FnTable>
        )}
      </section>
    </div>
  );
}
