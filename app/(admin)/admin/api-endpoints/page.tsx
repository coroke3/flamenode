import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { EventExportLinkBuilder } from "@/components/admin/EventExportLinkBuilder";
import { FnTable } from "@/components/ui/FnTable";
import { Icon } from "@/components/ui/Icon";
import {
  createApiEndpoint,
  setApiEndpointActive,
} from "@/lib/actions/api-endpoints";
import { getDatabase } from "@/lib/cloudflare";
import { events as eventsTable } from "@/lib/db/schema";
import { formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = { title: "作品情報出力API" };
export const dynamic = "force-dynamic";

async function createApiEndpointAction(formData: FormData): Promise<void> {
  "use server";
  await createApiEndpoint(formData);
}

async function setApiEndpointActiveAction(formData: FormData): Promise<void> {
  "use server";
  await setApiEndpointActive(formData);
}

export default async function AdminApiEndpointsPage(): Promise<React.ReactElement> {
  const db = getDatabase();
  let rows: Array<{
    id: string;
    event_id: string;
    public_api_enabled: number;
    updated_at: number;
    created_at: number;
    event_title: string;
    event_visibility_status: string;
  }> = [];
  let eventOptions: Array<{ id: string; title: string; enabled: number }> = [];

  if (db) {
    const [enabledRows, publicEvents] = await Promise.all([
      db
        .select({
          id: eventsTable.id,
          event_id: eventsTable.id,
          public_api_enabled: eventsTable.public_api_enabled,
          updated_at: eventsTable.updated_at,
          created_at: eventsTable.created_at,
          event_title: eventsTable.title,
          event_visibility_status: eventsTable.visibility_status,
        })
        .from(eventsTable)
        .where(eq(eventsTable.public_api_enabled, 1))
        .orderBy(desc(eventsTable.updated_at), desc(eventsTable.created_at))
        .limit(100),
      db
        .select({
          id: eventsTable.id,
          title: eventsTable.title,
          enabled: eventsTable.public_api_enabled,
        })
        .from(eventsTable)
        .where(eq(eventsTable.visibility_status, "public"))
        .orderBy(desc(eventsTable.created_at))
        .limit(100),
    ]);
    rows = enabledRows;
    eventOptions = publicEvents;
  }

  return (
    <div>
      <AdminPageHeader
        title="作品情報出力API"
        description="イベント単位で公開作品情報リンクを発行します。旧形式互換・新形式v3と、リアルタイム更新・節約定期更新を組み合わせて選択できます。"
      />

      <section
        style={{
          marginTop: 18,
          padding: "16px 18px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          イベントAPIを有効化
        </h2>
        <form
          action={createApiEndpointAction}
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          <select name="event_id" className="fn-select" required>
            <option value="">公開イベントを選択</option>
            {eventOptions.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title} ({event.id})
                {event.enabled === 1 ? " / 発行済み" : ""}
              </option>
            ))}
          </select>
          <button type="submit" className="fn-btn fn-btn-primary">
            <Icon name="plus" size={13} aria-hidden />
            APIリンクを発行
          </button>
        </form>
      </section>

      <section
        style={{
          marginTop: 18,
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        }}
      >
        <article
          style={{
            padding: "14px 16px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <strong className="fn-text-sm">新形式 v3</strong>
          <p className="fn-muted fn-text-sm" style={{ margin: "6px 0 0" }}>
            イベント、作品、制作者、公開メンバー、チャプター、使用ソフト、公開回答を構造化して返します。
          </p>
        </article>
        <article
          style={{
            padding: "14px 16px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <strong className="fn-text-sm">旧形式互換</strong>
          <p className="fn-muted fn-text-sm" style={{ margin: "6px 0 0" }}>
            旧EventArchives系の配列・列名で返します。正規化済みデータから互換列を再構成します。
          </p>
        </article>
        <article
          style={{
            padding: "14px 16px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <strong className="fn-text-sm">リアルタイム更新</strong>
          <p className="fn-muted fn-text-sm" style={{ margin: "6px 0 0" }}>
            リクエストごとにD1から最新情報を取得します。更新直後に反映したい用途向けです。
          </p>
        </article>
        <article
          style={{
            padding: "14px 16px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <strong className="fn-text-sm">節約定期更新</strong>
          <p className="fn-muted fn-text-sm" style={{ margin: "6px 0 0" }}>
            形式別にKV共有キャッシュし、指定間隔ごとにだけD1から再生成します。公開可否は短期キャッシュで確認します。
          </p>
        </article>
      </section>

      <section style={{ marginTop: 22 }}>
        <FnTable>
          <thead>
            <tr>
              <th>状態</th>
              <th>イベント</th>
              <th>出力リンク</th>
              <th>発行・更新</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <span className="fn-badge fn-badge-accent">有効</span>
                  <span
                    className="fn-badge fn-badge-soft"
                    style={{ marginLeft: 6 }}
                  >
                    {row.event_visibility_status}
                  </span>
                </td>
                <td>
                  <Link href={`/manage/events/${row.event_id}`}>
                    {row.event_title}
                  </Link>
                  <div className="fn-muted" style={{ marginTop: 4, fontSize: 11 }}>
                    {row.event_id}
                  </div>
                </td>
                <td>
                  <EventExportLinkBuilder eventId={row.event_id} />
                </td>
                <td className="fn-muted">{formatUnix(row.updated_at)}</td>
                <td>
                  <form action={setApiEndpointActiveAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <input type="hidden" name="public_api_enabled" value="0" />
                    <button type="submit" className="fn-btn fn-btn-sm fn-btn-ghost">
                      無効化
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 18, textAlign: "center" }}>
                  <span className="fn-muted fn-text-sm">
                    発行済みのイベントAPIはありません。
                  </span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </FnTable>
      </section>

      <section
        style={{
          marginTop: 22,
          padding: "16px 18px",
          background: "var(--bg-surface)",
          border: "1px dashed var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
          出力仕様
        </h2>
        <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
          新形式v3は公開情報を構造化して返し、旧形式互換は同じ正規化データから旧列を生成します。どちらも公開イベント・公開作品・公開運営・公開メンバー・公開チャプター・公開カスタム回答だけを出力し、内部ユーザーID、権限、監査情報、非公開データは含めません。作品は最大500件です。
        </p>
      </section>
    </div>
  );
}
