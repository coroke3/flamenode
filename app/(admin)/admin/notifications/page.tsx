import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";

import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq, like, lt, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { notificationOutbox } from "@/lib/db/schema";
import { formatRelative } from "@/lib/utils/format";
import { NotificationRetryButton } from "@/components/admin/NotificationRetryButton";
import { NotificationCancelButton } from "@/components/admin/NotificationCancelButton";
import { NotificationPayloadButton } from "@/components/admin/NotificationPayloadButton";
import { NotificationBulkRetryButton } from "@/components/admin/NotificationBulkRetryButton";
import { NotificationForceResendButton } from "@/components/admin/NotificationForceResendButton";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AutoSubmitSelect } from "@/components/forms/AutoSubmitSelect";
import { EmptyState } from "@/components/ui/EmptyState";
import { NotificationOutboxSummary } from "@/components/notifications/NotificationOutboxSummary";
import {
  drizzleNotificationCategoryCondition,
  getNotificationStatusLabel,
} from "@/lib/notifications/display";
import {
  ADMIN_NOTIFICATION_CATEGORY_OPTIONS,
  type NotificationCategory,
} from "@/lib/notifications/types";
import {
  lookupNotificationRecipients,
  type RecipientLookup,
} from "@/lib/notifications/recipient";

export const metadata: Metadata = { title: "通知配信状況" };
export const dynamic = "force-dynamic";

type StatusFilter = "all" | "pending" | "processing" | "sent" | "failed" | "cancelled";

interface Props {
  searchParams?: Promise<{
    status?: string;
    type?: string;
    event?: string;
    q?: string;
    cat?: string;
  }>;
}

export default async function AdminNotificationsPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const sp = (await searchParams) ?? {};
  const status: StatusFilter = (() => {
    switch (sp.status) {
      case "pending":
      case "processing":
      case "sent":
      case "failed":
      case "cancelled":
        return sp.status;
      default:
        return "all";
    }
  })();
  const typeFilter = (sp.type ?? "").trim();
  const eventFilter = (sp.event ?? "").trim();
  const qFilter = (sp.q ?? "").trim().slice(0, 100);
  const catFilter: NotificationCategory | "all" = (() => {
    const c = (sp.cat ?? "").trim();
    const allowed = ADMIN_NOTIFICATION_CATEGORY_OPTIONS.map((o) => o.key);
    return allowed.includes(c as NotificationCategory | "all")
      ? (c as NotificationCategory | "all")
      : "all";
  })();

  const db = getDatabase();
  let rows: (typeof notificationOutbox.$inferSelect)[] = [];
  let counts = { all: 0, pending: 0, processing: 0, sent: 0, failed: 0, cancelled: 0 };
  let stuckProcessingCount = 0;
  let error: string | null = null;

  if (db) {
    try {
      const conds: SQL<unknown>[] = [];
      if (status !== "all") {
        conds.push(eq(notificationOutbox.status, status));
      }
      if (typeFilter) {
        conds.push(eq(notificationOutbox.type, typeFilter));
      }
      if (eventFilter) {
        conds.push(eq(notificationOutbox.event_id, eventFilter));
      }
      if (qFilter) {
        conds.push(like(notificationOutbox.payload_json, `%${qFilter}%`));
      }
      if (catFilter !== "all") {
        conds.push(
          drizzleNotificationCategoryCondition(
            catFilter,
            notificationOutbox.type,
          ),
        );
      }
      const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

      const now = Math.floor(Date.now() / 1000);
      const [list, counted, stuckRows] = await Promise.all([
        (where
          ? db
              .select()
              .from(notificationOutbox)
              .where(where)
              .orderBy(desc(notificationOutbox.created_at))
              .limit(100)
          : db
              .select()
              .from(notificationOutbox)
              .orderBy(desc(notificationOutbox.created_at))
              .limit(100)),
        db
          .select({
            status: notificationOutbox.status,
            c: sql<number>`COUNT(*)`,
          })
          .from(notificationOutbox)
          .groupBy(notificationOutbox.status),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(notificationOutbox)
          .where(
            and(
              eq(notificationOutbox.status, "processing"),
              lt(notificationOutbox.processing_started_at, now - 15 * 60),
            ),
          ),
      ]);
      rows = list;
      const map: Record<string, number> = {};
      let total = 0;
      for (const r of counted) {
        const k = r.status ?? "unknown";
        map[k] = Number(r.c ?? 0);
        total += Number(r.c ?? 0);
      }
      counts = {
        all: total,
        pending: map.pending ?? 0,
        processing: map.processing ?? 0,
        sent: map.sent ?? 0,
        failed: map.failed ?? 0,
        cancelled: map.cancelled ?? 0,
      };
      stuckProcessingCount = Number(stuckRows[0]?.c ?? 0);
    } catch (e) {
      error = String(e);
    }
  } else {
    error = "DB に接続できませんでした。";
  }

  let recipientMap = new Map<string, RecipientLookup>();
  if (db && rows.length > 0) {
    recipientMap = await lookupNotificationRecipients(
      db,
      rows.map((r) => r.discord_user_id),
    );
  }

  return (
    <div>
      <AdminPageHeader
        title="通知配信状況"
        description="notification_outbox の直近 100 件。誰に・何の通知かを確認し、失敗時は再試行・キャンセル・強制再送できます。dispatcher は 5 分間隔・1 回最大 50 件・リトライ 1/5/15 分。"
      />
      <p style={{ marginTop: 6, fontSize: 11 }}>
        <Link href="/admin/audit?table=notification_outbox&record=bulk_retry">
          直近の bulk_retry 履歴を見る →
        </Link>
      </p>

      {stuckProcessingCount > 0 ? (
        <div
          role="status"
          style={{
            marginTop: 14,
            padding: "10px 14px",
            background: "var(--accent-danger-soft, #fee2e2)",
            border: "1px solid var(--accent-danger, #dc2626)",
            borderRadius: "var(--radius-md)",
            color: "var(--accent-danger, #991b1b)",
            fontSize: 13,
          }}
        >
          <strong>processing 固着 {stuckProcessingCount} 件</strong>
          {" "}— 15分以上 processing のままです。手動キャンセルまたは Worker の rescue を確認してください。
        </div>
      ) : counts.failed > 0 ? (
        <div
          role="status"
          style={{
            marginTop: 14,
            padding: "10px 14px",
            background: "var(--accent-danger-soft, #fee2e2)",
            border: "1px solid var(--accent-danger, #dc2626)",
            borderRadius: "var(--radius-md)",
            color: "var(--accent-danger, #991b1b)",
            fontSize: 13,
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span>
            <strong>failed {counts.failed} 件</strong>
            {" "}— Worker が諦めた通知です。手動リトライまたは Discord 側の状態確認を検討してください。
          </span>
          <NotificationBulkRetryButton />
        </div>
      ) : counts.pending > 0 ? (
        <div
          role="status"
          style={{
            marginTop: 14,
            padding: "10px 14px",
            background: "var(--accent-warning-soft, #fef3c7)",
            border: "1px solid var(--accent-warning, #d97706)",
            borderRadius: "var(--radius-md)",
            color: "var(--accent-warning, #92400e)",
            fontSize: 13,
          }}
        >
          配信待ち <strong>{counts.pending} 件</strong> あります (次の cron で処理されます)。
        </div>
      ) : counts.sent > 0 ? (
        <div
          role="status"
          style={{
            marginTop: 14,
            padding: "10px 14px",
            background: "var(--accent-success-soft, #dcfce7)",
            border: "1px solid var(--accent-success, #16a34a)",
            borderRadius: "var(--radius-md)",
            color: "var(--accent-success, #166534)",
            fontSize: 13,
          }}
        >
          失敗・滞留はありません ({counts.sent} 件 sent)。
        </div>
      ) : null}

      <nav
        aria-label="ステータスフィルタ"
        style={{
          marginTop: 16,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        {(
          [
            ["all", "すべて"],
            ["pending", "pending"],
            ["processing", "processing"],
            ["sent", "sent"],
            ["failed", "failed"],
            ["cancelled", "cancelled"],
          ] as const
        ).map(([key, label]) => {
          const params = new URLSearchParams();
          if (key !== "all") params.set("status", key);
          if (typeFilter) params.set("type", typeFilter);
          if (eventFilter) params.set("event", eventFilter);
          if (qFilter) params.set("q", qFilter);
          if (catFilter !== "all") params.set("cat", catFilter);
          const qs = params.toString();
          const href = qs ? `/admin/notifications?${qs}` : "/admin/notifications";
          return (
            <Link
              key={key}
              href={href}
              className={`fn-btn fn-btn-sm ${status === key ? "fn-btn-primary" : "fn-btn-ghost"}`}
            >
              {label} ({counts[key]})
            </Link>
          );
        })}
      </nav>

      <form
        method="get"
        style={{
          marginTop: 12,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {status !== "all" ? (
          <input type="hidden" name="status" value={status} />
        ) : null}
        <AutoSubmitSelect name="cat" defaultValue={catFilter} className="fn-input fn-input-sm">
          {ADMIN_NOTIFICATION_CATEGORY_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </AutoSubmitSelect>
        <input
          name="type"
          defaultValue={typeFilter}
          placeholder="type 完全一致 (例: x_id_approved)"
          className="fn-input fn-input-sm"
          style={{ minWidth: 220 }}
        />
        <input
          name="event"
          defaultValue={eventFilter}
          placeholder="event_id 完全一致"
          className="fn-input fn-input-sm"
          style={{ minWidth: 200 }}
        />
        <input
          name="q"
          defaultValue={qFilter}
          placeholder="payload LIKE 検索"
          className="fn-input fn-input-sm"
          style={{ minWidth: 200 }}
        />
        {typeFilter || eventFilter || qFilter || catFilter !== "all" ? (
          <Link
            href={status === "all" ? "/admin/notifications" : `/admin/notifications?status=${status}`}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            クリア
          </Link>
        ) : null}
      </form>

      {error ? (
        <div
          style={{
            marginTop: 20,
            padding: "12px 16px",
            background: "var(--bg-surface)",
            border: "1px solid var(--color-danger, #e53e3e)",
            borderRadius: "var(--radius-md)",
            color: "var(--color-danger, #e53e3e)",
            fontSize: 13,
          }}
        >
          エラー: {error}
        </div>
      ) : (
        <section style={{ marginTop: 18 }}>
          {rows.length === 0 ? (
            <EmptyState
              tone={
                status === "failed" && !typeFilter && !eventFilter && !qFilter
                  ? "success"
                  : "neutral"
              }
              title={
                status === "failed" && !typeFilter && !eventFilter && !qFilter
                  ? "失敗通知はありません"
                  : "通知ログはありません"
              }
              description={
                status === "failed" && !typeFilter && !eventFilter && !qFilter
                  ? "現在、失敗状態の通知はありません。Discord 送信が正常に完了しています。"
                  : "現在の条件に一致する通知はありません。フィルタを変えると別のログが表示される場合があります。"
              }
              actions={[
                ...(status !== "all"
                  ? [{ href: "/admin/notifications", label: "フィルタを解除", variant: "ghost" as const }]
                  : []),
                { href: "/admin/notifications?status=failed", label: "失敗通知を見る", variant: "ghost" },
                { href: "/admin", label: "管理ダッシュボードへ", variant: "ghost" },
              ]}
            />
          ) : (
          <FnTable>
            <thead>
              <tr>
                <th style={{ width: 88 }}>状態</th>
                <th>通知</th>
                <th style={{ width: 72 }}>試行</th>
                <th style={{ width: 100 }}>次試行</th>
                <th style={{ width: 100 }}>登録</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                    <td style={{ verticalAlign: "top" }}>
                      <span
                        className={`fn-badge ${
                          r.status === "sent"
                            ? "fn-badge-accent"
                            : r.status === "failed"
                              ? "fn-badge-danger"
                              : r.status === "processing"
                                ? "fn-badge-warning"
                                : "fn-badge-soft"
                        }`}
                        title={r.status ?? ""}
                      >
                        {getNotificationStatusLabel(r.status)}
                      </span>
                      {r.event_id ? (
                        <div style={{ fontSize: 10, marginTop: 6, wordBreak: "break-all" }}>
                          <Link href={`/manage/events/${r.event_id}`}>
                            {r.event_id.slice(0, 10)}…
                          </Link>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <NotificationOutboxSummary
                        row={r}
                        recipient={recipientMap.get(r.discord_user_id) ?? null}
                        showTechnicalType
                      />
                    </td>
                    <td style={{ fontVariantNumeric: "tabular-nums", verticalAlign: "top" }}>
                      {r.attempt_count ?? 0}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--text-muted)", verticalAlign: "top" }}>
                      {r.next_attempt_at ? formatRelative(r.next_attempt_at) : "—"}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--text-muted)", verticalAlign: "top" }}>
                      {formatRelative(r.created_at)}
                    </td>
                    <td style={{ verticalAlign: "top" }}>
                      <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                        <NotificationPayloadButton payload={r.payload_json} />
                        <Link
                          href={`/admin/audit?table=notification_outbox&record=${encodeURIComponent(r.id)}`}
                          className="fn-btn fn-btn-ghost fn-btn-sm"
                          title="この通知の監査ログ"
                        >
                          監査
                        </Link>
                        {r.status === "failed" ? (
                          <NotificationRetryButton id={r.id} />
                        ) : null}
                        {r.status === "sent" || r.status === "failed" ? (
                          <NotificationForceResendButton id={r.id} />
                        ) : null}
                        {r.status === "pending" ||
                        r.status === "processing" ||
                        r.status === "failed" ? (
                          <NotificationCancelButton id={r.id} />
                        ) : null}
                      </div>
                    </td>
                </tr>
              ))}
            </tbody>
          </FnTable>
          )}
        </section>
      )}
    </div>
  );
}
