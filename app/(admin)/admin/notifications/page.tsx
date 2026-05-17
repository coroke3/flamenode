import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq, like, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { notificationOutbox } from "@/lib/db/schema";
import { formatRelative } from "@/lib/utils/format";
import { NotificationRetryButton } from "@/components/admin/NotificationRetryButton";
import { NotificationPayloadButton } from "@/components/admin/NotificationPayloadButton";
import { NotificationBulkRetryButton } from "@/components/admin/NotificationBulkRetryButton";

export const metadata: Metadata = { title: "通知配信状況" };
export const dynamic = "force-dynamic";

type StatusFilter = "all" | "pending" | "processing" | "sent" | "failed";

interface Props {
  searchParams?: Promise<{
    status?: string;
    type?: string;
    event?: string;
    q?: string;
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
        return sp.status;
      default:
        return "all";
    }
  })();
  const typeFilter = (sp.type ?? "").trim();
  const eventFilter = (sp.event ?? "").trim();
  const qFilter = (sp.q ?? "").trim().slice(0, 100);

  const db = getDatabase();
  let rows: (typeof notificationOutbox.$inferSelect)[] = [];
  let counts = { all: 0, pending: 0, processing: 0, sent: 0, failed: 0 };
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
      const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

      const [list, counted] = await Promise.all([
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
      };
    } catch (e) {
      error = String(e);
    }
  } else {
    error = "DB に接続できませんでした。";
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>通知配信状況</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        notification_outbox の直近 100 件を表示します。Worker (notification-dispatcher) が 5 分間隔で送信し、失敗は最大 3 回まで指数バックオフで再試行します。
      </p>

      {counts.failed > 0 ? (
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
          ] as const
        ).map(([key, label]) => {
          const params = new URLSearchParams();
          if (key !== "all") params.set("status", key);
          if (typeFilter) params.set("type", typeFilter);
          if (eventFilter) params.set("event", eventFilter);
          if (qFilter) params.set("q", qFilter);
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
        <button type="submit" className="fn-btn fn-btn-ghost fn-btn-sm">
          絞り込み
        </button>
        {typeFilter || eventFilter || qFilter ? (
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
          <table className="fn-table">
            <thead>
              <tr>
                <th>状態</th>
                <th>type</th>
                <th>Discord ID</th>
                <th>試行</th>
                <th>次試行</th>
                <th>登録</th>
                <th>last_error</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                    該当する通知はありません。
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td>
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
                      >
                        {r.status ?? "?"}
                      </span>
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.type}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.discord_user_id}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.attempt_count ?? 0}</td>
                    <td style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {r.next_attempt_at ? formatRelative(r.next_attempt_at) : "—"}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {formatRelative(r.created_at)}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 280 }}>
                      {r.last_error ? (
                        <span style={{ wordBreak: "break-all" }}>{r.last_error}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
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
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
