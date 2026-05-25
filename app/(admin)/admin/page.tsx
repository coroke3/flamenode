import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq, gte, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  historyLogs as historyLogsTable,
  notificationOutbox as notificationOutboxTable,
  systemSettings,
  users as usersTable,
  videos as videosTable,
  xAccountLinkRequests as xAccountLinkRequestsTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { formatRelative } from "@/lib/utils/format";
import { runHealthChecks } from "@/lib/admin/healthChecks";
import { runSecurityChecks } from "@/lib/admin/securityChecks";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const metadata: Metadata = { title: "管理ダッシュボード" };
export const dynamic = "force-dynamic";

export default async function AdminTopPage(): Promise<React.ReactElement> {
  const db = getDatabase();
  let stats = {
    users: 0,
    videos: 0,
    events: 0,
    pending: 0,
    pendingX: 0,
    last24h: 0,
  };
  let mode: string = "normal";
  let isMaintenance = 0;
  let pendingVideos: { id: string; title: string; created_at: number; display_name: string }[] = [];
  let pendingXIds: {
    request_id: string;
    id: string;
    x_name: string | null;
    requested_at: number | null;
  }[] = [];
  let notificationFailedCount = 0;
  let healthWarnCount = 0;
  let securityWarnCount = 0;
  let recentFailedNotifs: {
    id: string;
    type: string;
    last_error: string | null;
    created_at: number;
  }[] = [];
  let recentActivity: {
    id: number;
    table_name: string;
    record_id: string;
    action: "CREATE" | "UPDATE" | "DELETE";
    operator_discord_id: string | null;
    created_at: number;
  }[] = [];

  if (db) {
    try {
      const dayAgo = Math.floor(Date.now() / 1000) - 24 * 3600;

      const [
        u,
        v,
        e,
        pending,
        pendX,
        last24,
        sys,
        pendList,
        pendXList,
        notifFailed,
        recentLogs,
      ] = await Promise.all([
        db.select({ c: sql<number>`COUNT(*)` }).from(usersTable),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(videosTable)
          .where(eq(videosTable.visibility_status, "public")),
        db.select({ c: sql<number>`COUNT(*)` }).from(eventsTable),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(videosTable)
          .where(eq(videosTable.visibility_status, "pending")),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(xAccountLinkRequestsTable)
          .where(eq(xAccountLinkRequestsTable.status, "pending")),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(videosTable)
          .where(gte(videosTable.created_at, dayAgo)),
        db.select().from(systemSettings).limit(1),
        db
          .select({
            id: videosTable.id,
            title: videosTable.title,
            created_at: videosTable.created_at,
            display_name: sql<string>`COALESCE(${xUsersTable.x_name}, ${videosTable.creator_display_name}, ${videosTable.creator_x_user_id})`,
          })
          .from(videosTable)
          .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_x_user_id))
          .where(eq(videosTable.visibility_status, "pending"))
          .orderBy(desc(videosTable.created_at))
          .limit(8),
        db
          .select({
            request_id: xAccountLinkRequestsTable.id,
            id: xAccountLinkRequestsTable.requested_x_id,
            x_name: usersTable.name,
            requested_at: xAccountLinkRequestsTable.requested_at,
          })
          .from(xAccountLinkRequestsTable)
          .leftJoin(usersTable, eq(usersTable.id, xAccountLinkRequestsTable.discord_user_id))
          .where(eq(xAccountLinkRequestsTable.status, "pending"))
          .orderBy(desc(xAccountLinkRequestsTable.requested_at))
          .limit(8),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(notificationOutboxTable)
          .where(eq(notificationOutboxTable.status, "failed")),
        db
          .select({
            id: historyLogsTable.id,
            table_name: historyLogsTable.table_name,
            record_id: historyLogsTable.record_id,
            action: historyLogsTable.action,
            operator_discord_id: historyLogsTable.operator_discord_id,
            created_at: historyLogsTable.created_at,
          })
          .from(historyLogsTable)
          .orderBy(desc(historyLogsTable.created_at))
          .limit(5),
      ]);

      stats = {
        users: Number(u[0]?.c ?? 0),
        videos: Number(v[0]?.c ?? 0),
        events: Number(e[0]?.c ?? 0),
        pending: Number(pending[0]?.c ?? 0),
        pendingX: Number(pendX[0]?.c ?? 0),
        last24h: Number(last24[0]?.c ?? 0),
      };
      mode = sys[0]?.cost_guard_mode ?? "normal";
      isMaintenance = sys[0]?.is_maintenance_mode ?? 0;
      pendingVideos = pendList;
      pendingXIds = pendXList;
      notificationFailedCount = Number(notifFailed[0]?.c ?? 0);
      recentActivity = recentLogs;

      // health/security WARN 件数を独立して取得 (失敗してもページ自体は表示する)
      try {
        const [hr, sr] = await Promise.all([
          runHealthChecks(db),
          runSecurityChecks(db),
        ]);
        healthWarnCount = hr.filter((r) => r.status === "warn").length;
        securityWarnCount = sr.filter((r) => r.status === "warn").length;
      } catch (e) {
        console.error("[AdminTopPage] health/security check failed", e);
      }

      // 直近の失敗通知 3件
      try {
        recentFailedNotifs = await db
          .select({
            id: notificationOutboxTable.id,
            type: notificationOutboxTable.type,
            last_error: notificationOutboxTable.last_error,
            created_at: notificationOutboxTable.created_at,
          })
          .from(notificationOutboxTable)
          .where(eq(notificationOutboxTable.status, "failed"))
          .orderBy(desc(notificationOutboxTable.created_at))
          .limit(3);
      } catch (e) {
        console.error("[AdminTopPage] recent failed notif fetch failed", e);
      }
    } catch (err) {
      console.error("[AdminTopPage] fetch failed", err);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="管理ダッシュボード"
        description="プラットフォームの稼働状況・要対応タスク・コストガード状態を一覧します。"
      />

      <TodoBoard
        pendingVideos={stats.pending}
        pendingXIds={stats.pendingX}
        notificationFailed={notificationFailedCount}
        maintenance={isMaintenance === 1}
        healthWarn={healthWarnCount}
        securityWarn={securityWarnCount}
      />

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginTop: 22,
        }}
      >
        <Stat label="総ユーザー" value={stats.users.toLocaleString()} />
        <Stat label="公開作品" value={stats.videos.toLocaleString()} />
        <Stat label="イベント" value={stats.events.toLocaleString()} />
        <Stat
          label="審査待ち"
          value={stats.pending.toLocaleString()}
          accent={stats.pending > 0}
        />
        <Stat
          label="X ID 承認待ち"
          value={stats.pendingX.toLocaleString()}
          accent={stats.pendingX > 0}
        />
        <Stat label="直近24h投稿" value={stats.last24h.toLocaleString()} />
      </section>

      <section
        style={{
          marginTop: 28,
          padding: "20px 22px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <h2
          style={{
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: "0.18em",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            marginBottom: 12,
          }}
        >
          コストガード
        </h2>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span
            className={`fn-badge ${
              mode === "normal"
                ? "fn-badge-accent"
                : mode === "economy"
                  ? "fn-badge-warning"
                  : "fn-badge-danger"
            }`}
          >
            mode: {mode}
          </span>
          <span
            className={`fn-badge ${isMaintenance ? "fn-badge-danger" : "fn-badge-soft"}`}
          >
            メンテナンス: {isMaintenance ? "ON" : "OFF"}
          </span>
          <Link href="/admin/cost-guard" className="fn-btn fn-btn-ghost fn-btn-sm">
            コストガード設定 →
          </Link>
        </div>
      </section>

      <section
        style={{
          marginTop: 28,
          padding: "20px 22px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "0.18em",
              color: "var(--text-muted)",
              textTransform: "uppercase",
            }}
          >
            審査待ち作品
          </h2>
          <Link href="/admin/videos?status=pending" className="fn-btn fn-btn-ghost fn-btn-sm">
            すべて →
          </Link>
        </header>
        {pendingVideos.length === 0 ? (
          <p className="fn-muted fn-text-sm">
            <Icon name="check" size={12} aria-hidden /> 現在、審査待ちはありません。
          </p>
        ) : (
          <table className="fn-table">
            <thead>
              <tr>
                <th>タイトル</th>
                <th>作者</th>
                <th>登録</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pendingVideos.map((v, index) => (
                <tr key={`${v.id}-pending-${index}`}>
                  <td>{v.title}</td>
                  <td>{v.display_name}</td>
                  <td className="fn-muted">{formatRelative(v.created_at)}</td>
                  <td>
                    <Link
                      href={`/admin/videos/${v.id}`}
                      className="fn-btn fn-btn-primary fn-btn-sm"
                    >
                      審査
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section
        style={{
          marginTop: 28,
          padding: "20px 22px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "0.18em",
              color: "var(--text-muted)",
              textTransform: "uppercase",
            }}
          >
            X ID 承認待ち
          </h2>
          <Link href="/admin/x-link-requests" className="fn-btn fn-btn-ghost fn-btn-sm">
            すべて →
          </Link>
        </header>
        {pendingXIds.length === 0 ? (
          <p className="fn-muted fn-text-sm">
            <Icon name="check" size={12} aria-hidden /> 現在、X ID 承認待ちはありません。
          </p>
        ) : (
          <table className="fn-table">
            <thead>
              <tr>
                <th>X ID</th>
                <th>申請者</th>
                <th>申請</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pendingXIds.map((x) => (
                <tr key={x.request_id}>
                  <td>@{x.id}</td>
                  <td>{x.x_name ?? "—"}</td>
                  <td className="fn-muted">
                    {x.requested_at ? formatRelative(x.requested_at) : "—"}
                  </td>
                  <td>
                    <Link
                      href={`/admin/x-link-requests`}
                      className="fn-btn fn-btn-primary fn-btn-sm"
                    >
                      確認
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {recentFailedNotifs.length > 0 ? (
        <section
          style={{
            marginTop: 28,
            padding: "20px 22px",
            background: "var(--bg-surface)",
            border: "1px solid var(--accent-danger, #dc2626)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <header
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <h2
              style={{
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "0.18em",
                color: "var(--accent-danger, #dc2626)",
                textTransform: "uppercase",
              }}
            >
              直近の失敗通知
            </h2>
            <Link
              href="/admin/notifications?status=failed"
              className="fn-btn fn-btn-ghost fn-btn-sm"
            >
              すべて →
            </Link>
          </header>
          <table className="fn-table">
            <thead>
              <tr>
                <th>日時</th>
                <th>type</th>
                <th>last_error</th>
              </tr>
            </thead>
            <tbody>
              {recentFailedNotifs.map((n) => (
                <tr key={n.id}>
                  <td className="fn-muted" style={{ whiteSpace: "nowrap" }}>
                    {formatRelative(n.created_at)}
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>{n.type}</td>
                  <td
                    style={{
                      fontSize: 11,
                      color: "var(--text-secondary)",
                      maxWidth: 360,
                      wordBreak: "break-all",
                    }}
                  >
                    {n.last_error ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section
        style={{
          marginTop: 28,
          padding: "20px 22px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "0.18em",
              color: "var(--text-muted)",
              textTransform: "uppercase",
            }}
          >
            直近の管理操作
          </h2>
          <Link href="/admin/audit" className="fn-btn fn-btn-ghost fn-btn-sm">
            すべて →
          </Link>
        </header>
        {recentActivity.length === 0 ? (
          <p className="fn-muted fn-text-sm">
            <Icon name="check" size={12} aria-hidden /> 履歴はまだありません。
          </p>
        ) : (
          <table className="fn-table">
            <thead>
              <tr>
                <th>日時</th>
                <th>テーブル</th>
                <th>操作</th>
                <th>レコード</th>
                <th>実行者</th>
              </tr>
            </thead>
            <tbody>
              {recentActivity.map((h) => (
                <tr key={h.id}>
                  <td className="fn-muted" style={{ whiteSpace: "nowrap" }}>
                    {formatRelative(h.created_at)}
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>{h.table_name}</td>
                  <td>
                    <span
                      className={`fn-badge ${
                        h.action === "DELETE"
                          ? "fn-badge-danger"
                          : h.action === "CREATE"
                            ? "fn-badge-accent"
                            : "fn-badge-soft"
                      }`}
                    >
                      {h.action}
                    </span>
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <Link href={`/admin/audit?record=${encodeURIComponent(h.record_id)}`}>
                      {h.record_id}
                    </Link>
                  </td>
                  <td style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    {h.operator_discord_id ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function TodoBoard({
  pendingVideos,
  pendingXIds,
  notificationFailed,
  maintenance,
  healthWarn,
  securityWarn,
}: {
  pendingVideos: number;
  pendingXIds: number;
  notificationFailed: number;
  maintenance: boolean;
  healthWarn: number;
  securityWarn: number;
}): React.ReactElement | null {
  const items: { label: string; href: string; count: number; tone: "warn" | "danger" }[] = [];
  if (pendingVideos > 0) {
    items.push({
      label: "審査待ち作品",
      href: "/admin/videos?status=pending",
      count: pendingVideos,
      tone: "warn",
    });
  }
  if (pendingXIds > 0) {
    items.push({
      label: "X ID 承認待ち",
      href: "/admin/x-link-requests",
      count: pendingXIds,
      tone: "warn",
    });
  }
  if (notificationFailed > 0) {
    items.push({
      label: "通知配信失敗",
      href: "/admin/notifications?status=failed",
      count: notificationFailed,
      tone: "danger",
    });
  }
  if (maintenance) {
    items.push({
      label: "メンテナンスモード ON",
      href: "/admin/cost-guard",
      count: 1,
      tone: "danger",
    });
  }
  if (securityWarn > 0) {
    items.push({
      label: "セキュリティ WARN",
      href: "/admin/security?status=warn",
      count: securityWarn,
      tone: "danger",
    });
  }
  if (healthWarn > 0) {
    items.push({
      label: "ヘルス WARN",
      href: "/admin/health?status=warn",
      count: healthWarn,
      tone: "warn",
    });
  }

  if (items.length === 0) {
    return (
      <section
        style={{
          marginTop: 22,
          padding: "14px 18px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 13,
          color: "var(--text-secondary)",
        }}
      >
        <Icon name="check" size={14} aria-hidden /> 今日対応すべき要対応タスクはありません。
      </section>
    );
  }

  return (
    <section
      style={{
        marginTop: 22,
        padding: "18px 22px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <h2
        style={{
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "0.18em",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          marginBottom: 12,
        }}
      >
        今日やること
      </h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={`fn-badge ${
              it.tone === "danger" ? "fn-badge-danger" : "fn-badge-warning"
            }`}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {it.label}
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>{it.count}</strong>
            <Icon name="chevron-right" size={11} aria-hidden />
          </Link>
        ))}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}): React.ReactElement {
  return (
    <div
      className={`fn-card ${accent ? "fn-card-accent" : ""}`}
      style={{ padding: "14px 16px" }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.16em",
          color: "var(--text-muted)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{value}</div>
    </div>
  );
}
