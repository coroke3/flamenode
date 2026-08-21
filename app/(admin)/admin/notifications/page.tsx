import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, like, lte, sql, type SQL } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { notificationOutbox } from "@/lib/db/schema";
import { formatRelative } from "@/lib/utils/format";
import { NotificationActionButton } from "@/components/admin/NotificationActionButton";
import { NotificationCancelButton } from "@/components/admin/NotificationCancelButton";
import { NotificationPayloadButton } from "@/components/admin/NotificationPayloadButton";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AutoSubmitSelect } from "@/components/forms/AutoSubmitSelect";
import { EmptyState } from "@/components/ui/EmptyState";
import { FnTable } from "@/components/ui/FnTable";
import { NotificationOutboxSummary } from "@/components/notifications/NotificationOutboxSummary";
import {
  drizzleNotificationCategoryCondition,
  getNotificationStatusLabel,
  statusBadgeClass,
} from "@/lib/notifications/display";
import {
  isTerminalNotificationFailure,
  TERMINAL_NOTIFICATION_FAILURE_STATUSES,
} from "@/lib/notifications/status";
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

type StatusFilter =
  | "all"
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "cancelled";

type Counts = {
  pending: number;
  processing: number;
  failed: number;
};

interface Props {
  searchParams?: Promise<{
    status?: string;
    type?: string;
    event?: string;
    q?: string;
    cat?: string;
  }>;
}

function parseStatus(value: string | undefined): StatusFilter {
  switch (value) {
    case "pending":
    case "processing":
    case "sent":
    case "failed":
    case "cancelled":
      return value;
    default:
      return "all";
  }
}

function statusCondition(status: StatusFilter): SQL<unknown> | null {
  if (status === "all") return null;
  if (status === "failed") {
    return inArray(notificationOutbox.status, [
      ...TERMINAL_NOTIFICATION_FAILURE_STATUSES,
    ]);
  }
  return eq(notificationOutbox.status, status);
}

function filterHref(input: {
  status: StatusFilter;
  type: string;
  event: string;
  q: string;
  category: NotificationCategory | "all";
}): string {
  const params = new URLSearchParams();
  if (input.status !== "all") params.set("status", input.status);
  if (input.type) params.set("type", input.type);
  if (input.event) params.set("event", input.event);
  if (input.q) params.set("q", input.q);
  if (input.category !== "all") params.set("cat", input.category);
  const query = params.toString();
  return query ? `/admin/notifications?${query}` : "/admin/notifications";
}

export default async function AdminNotificationsPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const sp = (await searchParams) ?? {};
  const status = parseStatus(sp.status);
  const typeFilter = (sp.type ?? "").trim();
  const eventFilter = (sp.event ?? "").trim();
  const qFilter = (sp.q ?? "").trim().slice(0, 100);
  const catFilter: NotificationCategory | "all" = (() => {
    const value = (sp.cat ?? "").trim();
    const allowed = ADMIN_NOTIFICATION_CATEGORY_OPTIONS.map((option) => option.key);
    return allowed.includes(value as NotificationCategory | "all")
      ? (value as NotificationCategory | "all")
      : "all";
  })();

  const db = getDatabase();
  let rows: (typeof notificationOutbox.$inferSelect)[] = [];
  let counts: Counts = {
    pending: 0,
    processing: 0,
    failed: 0,
  };
  let deadLetterCount = 0;
  let expiredLeaseCount = 0;
  let error: string | null = null;

  if (db) {
    try {
      const conditions: SQL<unknown>[] = [];
      const statusWhere = statusCondition(status);
      if (statusWhere) conditions.push(statusWhere);
      if (typeFilter) conditions.push(eq(notificationOutbox.type, typeFilter));
      if (eventFilter) conditions.push(eq(notificationOutbox.event_id, eventFilter));
      if (qFilter) conditions.push(like(notificationOutbox.payload_json, `%${qFilter}%`));
      if (catFilter !== "all") {
        conditions.push(
          drizzleNotificationCategoryCondition(catFilter, notificationOutbox.type),
        );
      }
      const where =
        conditions.length === 0
          ? undefined
          : conditions.length === 1
            ? conditions[0]
            : and(...conditions);
      const now = Math.floor(Date.now() / 1000);

      const [list, operationalCounts, expiredLeases] = await Promise.all([
        where
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
              .limit(100),
        // Only operational states need an exact, real-time count. Terminal
        // history (sent/cancelled) is deliberately represented by the bounded
        // latest list below; scanning all historical deliveries here defeats the
        // latest-100 index and was the main source of rows_read on this page.
        db
          .select({
            pending: sql<number>`SUM(CASE WHEN ${notificationOutbox.status} = 'pending' THEN 1 ELSE 0 END)`,
            processing: sql<number>`SUM(CASE WHEN ${notificationOutbox.status} = 'processing' THEN 1 ELSE 0 END)`,
            failed: sql<number>`SUM(CASE WHEN ${notificationOutbox.status} = 'failed' THEN 1 ELSE 0 END)`,
            deadLetter: sql<number>`SUM(CASE WHEN ${notificationOutbox.status} = 'dead_letter' THEN 1 ELSE 0 END)`,
          })
          .from(notificationOutbox)
          .where(
            inArray(notificationOutbox.status, [
              "pending",
              "processing",
              "failed",
              "dead_letter",
            ]),
          ),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(notificationOutbox)
          .where(
            and(
              eq(notificationOutbox.status, "processing"),
              lte(notificationOutbox.lease_expires_at, now),
            ),
          ),
      ]);

      rows = list;
      const operational = operationalCounts[0];
      const pending = Number(operational?.pending ?? 0);
      const processing = Number(operational?.processing ?? 0);
      const failed = Number(operational?.failed ?? 0);
      const deadLetter = Number(operational?.deadLetter ?? 0);
      counts = {
        pending,
        processing,
        failed,
      };
      deadLetterCount = deadLetter;
      expiredLeaseCount = Number(expiredLeases[0]?.count ?? 0);
    } catch (cause) {
      error = String(cause);
    }
  } else {
    error = "DB に接続できませんでした。";
  }

  let recipientMap = new Map<string, RecipientLookup>();
  if (db && rows.length > 0) {
    recipientMap = await lookupNotificationRecipients(
      db,
      rows.map((row) => row.recipient_user_id),
    );
  }

  const filterInput = {
    type: typeFilter,
    event: eventFilter,
    q: qFilter,
    category: catFilter,
  };

  return (
    <div>
      <AdminPageHeader
        title="通知配信状況"
        description="notification_outbox の直近100件。Queue wake で即時起動し、1回最大6件を処理。毎時 Recovery Cron がバックアップします。失敗時は1/5/15分間隔で最大4回試行します。"
      />
      <p style={{ marginTop: 6, fontSize: 11 }}>
        <Link href="/admin/audit?table=notification_outbox&record=bulk_retry">
          直近の一括再試行履歴を見る →
        </Link>
      </p>

      {expiredLeaseCount > 0 ? (
        <div role="status" className="fn-alert fn-alert--danger" style={{ marginTop: 14 }}>
          <strong>配送リース期限超過 {expiredLeaseCount} 件</strong>
          {" "}— 毎時 Recovery Cron で自動回収されます。10分以上続く場合はWorkerとD1を確認してください。
        </div>
      ) : counts.failed > 0 || deadLetterCount > 0 ? (
        <div role="status" className="fn-alert fn-alert--danger" style={{ marginTop: 14 }}>
          <span>
            <strong>
              失敗 {counts.failed} 件
              {deadLetterCount > 0 ? ` / dead_letter ${deadLetterCount} 件` : ""}
            </strong>
            {" "}— 原因を確認し、必要な通知だけ再試行してください。
          </span>{" "}
          <NotificationActionButton kind="bulk-retry" />
        </div>
      ) : counts.pending > 0 ? (
        <div role="status" className="fn-alert fn-alert--warn" style={{ marginTop: 14 }}>
          配信待ち <strong>{counts.pending} 件</strong>（Queue wake で処理、毎時 Recovery がバックアップ）
        </div>
      ) : rows.length > 0 ? (
        <div role="status" className="fn-alert fn-alert--success" style={{ marginTop: 14 }}>
          現在、失敗・滞留はありません。
        </div>
      ) : null}

      <nav
        aria-label="ステータスフィルタ"
        style={{ marginTop: 16, display: "flex", gap: 6, flexWrap: "wrap" }}
      >
        {(
          [
            ["all", "すべて"],
            ["pending", "配信待ち"],
            ["processing", "送信中"],
            ["sent", "送信済み"],
            ["failed", "最終失敗"],
            ["cancelled", "キャンセル"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={filterHref({ status: key, ...filterInput })}
            className={`fn-btn fn-btn-sm ${status === key ? "fn-btn-primary" : "fn-btn-ghost"}`}
          >
            {label}
            {key === "pending" || key === "processing" || key === "failed"
              ? ` (${key === "failed" ? counts.failed + deadLetterCount : key === "pending" ? counts.pending : counts.processing})`
              : ""}
          </Link>
        ))}
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
        {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
        <AutoSubmitSelect name="cat" defaultValue={catFilter} className="fn-input fn-input-sm">
          {ADMIN_NOTIFICATION_CATEGORY_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </AutoSubmitSelect>
        <input
          name="type"
          defaultValue={typeFilter}
          placeholder="type 完全一致（例: x_id_approved）"
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
          placeholder="通知本文を検索"
          className="fn-input fn-input-sm"
          style={{ minWidth: 200 }}
        />
        {typeFilter || eventFilter || qFilter || catFilter !== "all" ? (
          <Link
            href={filterHref({
              status,
              type: "",
              event: "",
              q: "",
              category: "all",
            })}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            詳細条件をクリア
          </Link>
        ) : null}
      </form>

      {error ? (
        <div role="alert" className="fn-alert fn-alert--danger" style={{ marginTop: 20 }}>
          エラー: {error}
        </div>
      ) : (
        <section style={{ marginTop: 18 }}>
          {rows.length === 0 ? (
            <EmptyState
              tone={status === "failed" ? "success" : "neutral"}
              title={status === "failed" ? "失敗通知はありません" : "通知ログはありません"}
              description={
                status === "failed"
                  ? "現在、最終失敗状態の通知はありません。"
                  : "現在の条件に一致する通知はありません。"
              }
              actions={[
                ...(status !== "all"
                  ? [
                      {
                        href: "/admin/notifications",
                        label: "フィルタを解除",
                        variant: "ghost" as const,
                      },
                    ]
                  : []),
                {
                  href: "/admin/notifications?status=failed",
                  label: "最終失敗を見る",
                  variant: "ghost",
                },
                { href: "/admin", label: "管理ダッシュボードへ", variant: "ghost" },
              ]}
            />
          ) : (
            <FnTable>
              <thead>
                <tr>
                  <th style={{ width: 92 }}>状態</th>
                  <th>通知</th>
                  <th style={{ width: 72 }}>試行</th>
                  <th style={{ width: 100 }}>次試行</th>
                  <th style={{ width: 100 }}>登録</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const terminalFailure = isTerminalNotificationFailure(row.status);
                  return (
                    <tr key={row.id}>
                      <td style={{ verticalAlign: "top" }}>
                        <span
                          className={`fn-badge ${statusBadgeClass(row.status)}`}
                          title={row.status ?? ""}
                        >
                          {getNotificationStatusLabel(row.status)}
                        </span>
                        {row.event_id ? (
                          <div style={{ fontSize: 10, marginTop: 6, wordBreak: "break-all" }}>
                            <Link href={`/manage/events/${encodeURIComponent(row.event_id)}`}>
                              {row.event_id.slice(0, 10)}…
                            </Link>
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <NotificationOutboxSummary
                          row={row}
                          recipient={recipientMap.get(row.recipient_user_id) ?? null}
                          showTechnicalType
                        />
                      </td>
                      <td style={{ fontVariantNumeric: "tabular-nums", verticalAlign: "top" }}>
                        {row.attempt_count ?? 0}
                      </td>
                      <td style={{ fontSize: 11, color: "var(--text-muted)", verticalAlign: "top" }}>
                        {row.next_attempt_at ? formatRelative(row.next_attempt_at) : "—"}
                      </td>
                      <td style={{ fontSize: 11, color: "var(--text-muted)", verticalAlign: "top" }}>
                        {formatRelative(row.created_at)}
                      </td>
                      <td style={{ verticalAlign: "top" }}>
                        <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                          <NotificationPayloadButton payload={row.payload_json} />
                          <Link
                            href={`/admin/audit?table=notification_outbox&record=${encodeURIComponent(row.id)}`}
                            className="fn-btn fn-btn-ghost fn-btn-sm"
                            title="この通知の監査ログ"
                          >
                            監査
                          </Link>
                          {terminalFailure ? (
                            <NotificationActionButton kind="retry" id={row.id} />
                          ) : null}
                          {row.status === "sent" || terminalFailure ? (
                            <NotificationActionButton kind="force-resend" id={row.id} />
                          ) : null}
                          {row.status === "pending" ||
                          row.status === "processing" ||
                          terminalFailure ? (
                            <NotificationCancelButton id={row.id} />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </FnTable>
          )}
        </section>
      )}
    </div>
  );
}
