import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  notificationOutbox as notificationOutboxTable,
  slots as slotsTable,
  systemSettings,
  videoModerationCases as videoModerationCasesTable,
  videoYoutubeMetadata as videoYoutubeMetadataTable,
  videos as videosTable,
  xAccountLinkRequests as xAccountLinkRequestsTable,
  xIdMergeRequests as xIdMergeRequestsTable,
  xIdMergeReverts as xIdMergeRevertsTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { resolveOperationMode } from "@/lib/operationMode/resolve";
import type { OperationMode } from "@/lib/operationMode/types";

export const metadata: Metadata = { title: "管理ダッシュボード" };
export const dynamic = "force-dynamic";

type Tone = "neutral" | "warn" | "danger";

interface PendingCounts {
  pendingVideos: number;
  xLinkRequests: number;
  xMergeRequests: number;
  xMergeReverts: number;
  notificationFailed: number;
  notificationStuck: number;
  youtubeFailed: number;
  moderationOpen: number;
  moderationOverdue: number;
  reservedOpenSlots: number;
}

const EMPTY_COUNTS: PendingCounts = {
  pendingVideos: 0,
  xLinkRequests: 0,
  xMergeRequests: 0,
  xMergeReverts: 0,
  notificationFailed: 0,
  notificationStuck: 0,
  youtubeFailed: 0,
  moderationOpen: 0,
  moderationOverdue: 0,
  reservedOpenSlots: 0,
};

export default async function AdminTopPage(): Promise<React.ReactElement> {
  const db = getDatabase();
  let counts = { ...EMPTY_COUNTS };
  let mode: OperationMode = "normal";
  let isMaintenance = 0;

  if (db) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const processingCutoff = now - 15 * 60;

      const [
        pendingVideos,
        xLinkRequests,
        xMergeRequests,
        xMergeReverts,
        notificationFailed,
        notificationStuck,
        youtubeFailed,
        moderationOpen,
        moderationOverdue,
        reservedOpenSlots,
        sys,
      ] = await Promise.all([
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
          .from(xIdMergeRequestsTable)
          .where(eq(xIdMergeRequestsTable.status, "pending")),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(xIdMergeRevertsTable)
          .where(eq(xIdMergeRevertsTable.status, "pending")),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(notificationOutboxTable)
          .where(eq(notificationOutboxTable.status, "failed")),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(notificationOutboxTable)
          .where(
            and(
              eq(notificationOutboxTable.status, "processing"),
              lt(notificationOutboxTable.processing_started_at, processingCutoff),
            ),
          ),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(videoYoutubeMetadataTable)
          .where(eq(videoYoutubeMetadataTable.sync_status, "failed")),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(videoModerationCasesTable)
          .where(eq(videoModerationCasesTable.status, "open")),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(videoModerationCasesTable)
          .where(
            and(
              eq(videoModerationCasesTable.status, "open"),
              lt(videoModerationCasesTable.due_at, now),
            ),
          ),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(slotsTable)
          .leftJoin(eventsTable, eq(eventsTable.id, slotsTable.event_id))
          .where(
            and(
              eq(slotsTable.status, "reserved"),
              eq(eventsTable.visibility_status, "public"),
              sql`(${eventsTable.entry_start_time} IS NOT NULL OR ${eventsTable.entry_end_time} IS NOT NULL)`,
              sql`(${eventsTable.entry_start_time} IS NULL OR ${eventsTable.entry_start_time} <= ${now})`,
              sql`(${eventsTable.entry_end_time} IS NULL OR ${eventsTable.entry_end_time} >= ${now})`,
              sql`(
                COALESCE(${eventsTable.end_time}, ${eventsTable.start_time}) IS NULL
                OR COALESCE(${eventsTable.end_time}, ${eventsTable.start_time}) > ${now}
              )`,
            ),
          ),
        db.select().from(systemSettings).where(eq(systemSettings.id, "default")).limit(1),
      ]);

      counts = {
        pendingVideos: Number(pendingVideos[0]?.c ?? 0),
        xLinkRequests: Number(xLinkRequests[0]?.c ?? 0),
        xMergeRequests: Number(xMergeRequests[0]?.c ?? 0),
        xMergeReverts: Number(xMergeReverts[0]?.c ?? 0),
        notificationFailed: Number(notificationFailed[0]?.c ?? 0),
        notificationStuck: Number(notificationStuck[0]?.c ?? 0),
        youtubeFailed: Number(youtubeFailed[0]?.c ?? 0),
        moderationOpen: Number(moderationOpen[0]?.c ?? 0),
        moderationOverdue: Number(moderationOverdue[0]?.c ?? 0),
        reservedOpenSlots: Number(reservedOpenSlots[0]?.c ?? 0),
      };
      mode = resolveOperationMode(sys[0]);
      isMaintenance = sys[0]?.is_maintenance_mode ?? 0;
    } catch (err) {
      console.error("[AdminTopPage] fetch failed", err);
    }
  }

  const items = [
    {
      label: "承認待ち作品",
      value: counts.pendingVideos,
      href: "/admin/videos?status=pending",
      description: "作品審査キュー",
      tone: counts.pendingVideos > 0 ? "warn" : "neutral",
    },
    {
      label: "X ID連携申請",
      value: counts.xLinkRequests,
      href: "/admin/x-link-requests",
      description: "Discord と X ID の連携",
      tone: counts.xLinkRequests > 0 ? "warn" : "neutral",
    },
    {
      label: "X ID統合申請",
      value: counts.xMergeRequests,
      href: "/admin/x-id-merges",
      description: "既存 X ID 同士の統合",
      tone: counts.xMergeRequests > 0 ? "danger" : "neutral",
    },
    {
      label: "統合取り消し申請",
      value: counts.xMergeReverts,
      href: "/admin/x-id-merges?view=reverts",
      description: "restore snapshot の確認",
      tone: counts.xMergeReverts > 0 ? "danger" : "neutral",
    },
    {
      label: "通知失敗",
      value: counts.notificationFailed,
      href: "/admin/notifications?status=failed",
      description: "Discord 送信 failed",
      tone: counts.notificationFailed > 0 ? "danger" : "neutral",
    },
    {
      label: "通知処理固着",
      value: counts.notificationStuck,
      href: "/admin/notifications?status=processing",
      description: "processing 15分超",
      tone: counts.notificationStuck > 0 ? "danger" : "neutral",
    },
    {
      label: "YouTube同期失敗",
      value: counts.youtubeFailed,
      href: "/admin/youtube-sync?failed=1",
      description: "metadata sync failed",
      tone: counts.youtubeFailed > 0 ? "warn" : "neutral",
    },
    {
      label: "未解決ケース",
      value: counts.moderationOpen,
      href: "/admin/moderation?status=open",
      description: "モデレーション open",
      tone: counts.moderationOpen > 0 ? "warn" : "neutral",
    },
    {
      label: "期限切れケース",
      value: counts.moderationOverdue,
      href: "/admin/moderation?status=open&overdue=1",
      description: "due_at 超過",
      tone: counts.moderationOverdue > 0 ? "danger" : "neutral",
    },
    {
      label: "未提出予約枠",
      value: counts.reservedOpenSlots,
      href: "/admin/events",
      description: "受付中イベントの reserved",
      tone: counts.reservedOpenSlots > 0 ? "warn" : "neutral",
    },
  ] satisfies Array<{
    label: string;
    value: number;
    href: string;
    description: string;
    tone: Tone;
  }>;

  const pendingTotal = items.reduce((sum, item) => sum + item.value, 0);

  return (
    <div>
      <AdminPageHeader
        title="管理ダッシュボード"
        description="Cloudflare 無料枠を圧迫しないよう、管理トップは対応待ち件数だけを軽量クエリで表示します。"
      />

      <section
        aria-labelledby="pending-counts"
        className="fn-admin-stat-grid"
        style={{ marginTop: 22 }}
      >
        <h2 id="pending-counts" className="fn-sr-only">
          対応待ち件数
        </h2>
        {items.map((item) => (
          <PendingCountCard key={item.label} {...item} />
        ))}
      </section>

      {pendingTotal === 0 ? (
        <div style={{ marginTop: 20 }}>
          <EmptyState
            tone="success"
            title="対応待ちはありません"
            description="現在、管理者がすぐに処理すべき申請・通知失敗・モデレーションはありません。"
            iconName="check"
            actions={[
              { href: "/admin/events", label: "全イベント管理へ", variant: "primary" },
              { href: "/admin/videos", label: "作品管理へ", variant: "ghost" },
              { href: "/admin/health", label: "ヘルスチェックを見る", variant: "ghost" },
            ]}
          />
        </div>
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
            コストガード設定
            <Icon name="chevron-right" size={11} aria-hidden />
          </Link>
        </div>
      </section>

      <section
        style={{
          marginTop: 28,
          padding: "16px 18px",
          background: "var(--bg-surface)",
          border: "1px dashed var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <span className="fn-muted fn-text-sm">詳細な診断は必要なときだけ開きます。</span>
        <Link href="/admin/health" className="fn-btn fn-btn-ghost fn-btn-sm">
          ヘルスチェック
        </Link>
        <Link href="/admin/health/integrity" className="fn-btn fn-btn-ghost fn-btn-sm">
          DB整合性チェック
        </Link>
        <Link href="/admin/security" className="fn-btn fn-btn-ghost fn-btn-sm">
          セキュリティ
        </Link>
        <Link href="/admin/audit" className="fn-btn fn-btn-ghost fn-btn-sm">
          監査ログ
        </Link>
      </section>
    </div>
  );
}

function PendingCountCard({
  label,
  value,
  href,
  description,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  description: string;
  tone: Tone;
}): React.ReactElement {
  const badgeClass =
    tone === "danger"
      ? "fn-badge-danger"
      : tone === "warn"
        ? "fn-badge-warning"
        : "fn-badge-soft";
  return (
    <Link
      href={href}
      className="fn-card"
      style={{
        padding: "14px 16px",
        textDecoration: "none",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 116,
      }}
      aria-label={`${label}: ${value} 件`}
    >
      <span
        className={`fn-badge ${badgeClass}`}
        style={{ width: "fit-content", maxWidth: "100%" }}
      >
        {label}
      </span>
      <strong
        style={{
          fontSize: 28,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          color: "var(--text-primary)",
        }}
      >
        {value.toLocaleString()}
      </strong>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
        {description}
      </span>
    </Link>
  );
}
