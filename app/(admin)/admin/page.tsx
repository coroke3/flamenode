import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq, gte, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  notificationOutbox as notificationOutboxTable,
  systemSettings,
  users as usersTable,
  videos as videosTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { formatRelative } from "@/lib/utils/format";

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
  let pendingXIds: { id: string; x_name: string | null; requested_at: number | null }[] = [];
  let notificationFailedCount = 0;

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
      ] = await Promise.all([
        db.select({ c: sql<number>`COUNT(*)` }).from(usersTable),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(videosTable)
          .where(eq(videosTable.status, "public")),
        db.select({ c: sql<number>`COUNT(*)` }).from(eventsTable),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(videosTable)
          .where(eq(videosTable.status, "pending")),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(xUsersTable)
          .where(eq(xUsersTable.approval_status, "pending")),
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
            display_name: sql<string>`COALESCE(${xUsersTable.x_name}, ${videosTable.display_name}, ${videosTable.contact_x_id})`,
          })
          .from(videosTable)
          .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_id))
          .where(eq(videosTable.status, "pending"))
          .orderBy(desc(videosTable.created_at))
          .limit(8),
        db
          .select({
            id: xUsersTable.id,
            x_name: xUsersTable.x_name,
            requested_at: xUsersTable.approval_requested_at,
          })
          .from(xUsersTable)
          .where(eq(xUsersTable.approval_status, "pending"))
          .orderBy(desc(xUsersTable.approval_requested_at))
          .limit(8),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(notificationOutboxTable)
          .where(eq(notificationOutboxTable.status, "failed")),
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
    } catch (err) {
      console.error("[AdminTopPage] fetch failed", err);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "0.04em" }}>
        管理ダッシュボード
      </h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        プラットフォームの稼働状況・要対応タスク・コストガード状態を一覧します。
      </p>

      <TodoBoard
        pendingVideos={stats.pending}
        pendingXIds={stats.pendingX}
        notificationFailed={notificationFailedCount}
        maintenance={isMaintenance === 1}
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
              {pendingVideos.map((v) => (
                <tr key={v.id}>
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
                <th>名前</th>
                <th>申請</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pendingXIds.map((x) => (
                <tr key={x.id}>
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
    </div>
  );
}

function TodoBoard({
  pendingVideos,
  pendingXIds,
  notificationFailed,
  maintenance,
}: {
  pendingVideos: number;
  pendingXIds: number;
  notificationFailed: number;
  maintenance: boolean;
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
      href: "/admin/audit?table=notification_outbox",
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
