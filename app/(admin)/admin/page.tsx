import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getDatabase } from "@/lib/cloudflare";
import {
  EMPTY_ADMIN_PENDING_COUNTS,
  fetchAdminTopSnapshot,
  type AdminPendingCounts,
} from "@/lib/admin/adminPendingCounts";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import type { OperationMode } from "@/lib/operationMode/types";

export const metadata: Metadata = { title: "管理ダッシュボード" };
export const dynamic = "force-dynamic";

type Tone = "neutral" | "warn" | "danger";

export default async function AdminTopPage(): Promise<React.ReactElement> {
  const db = getDatabase();
  let counts: AdminPendingCounts = { ...EMPTY_ADMIN_PENDING_COUNTS };
  let mode: OperationMode = "normal";
  let isMaintenance = 0;

  if (db) {
    try {
      const snapshot = await fetchAdminTopSnapshot(db);
      counts = snapshot.counts;
      mode = snapshot.mode;
      isMaintenance = snapshot.isMaintenance;
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
      icon: "youtube",
      tone: counts.pendingVideos > 0 ? "warn" : "neutral",
    },
    {
      label: "X ID連携申請",
      value: counts.xLinkRequests,
      href: "/admin/x-link-requests",
      description: "Discord と X ID の連携",
      icon: "user",
      tone: counts.xLinkRequests > 0 ? "warn" : "neutral",
    },
    {
      label: "X ID統合申請",
      value: counts.xMergeRequests,
      href: "/admin/x-id-merges",
      description: "既存 X ID 同士の統合",
      icon: "users",
      tone: counts.xMergeRequests > 0 ? "danger" : "neutral",
    },
    {
      label: "統合取り消し申請",
      value: counts.xMergeReverts,
      href: "/admin/x-id-merges?view=reverts",
      description: "restore snapshot の確認",
      icon: "refresh",
      tone: counts.xMergeReverts > 0 ? "danger" : "neutral",
    },
    {
      label: "通知失敗",
      value: counts.notificationFailed,
      href: "/admin/notifications?status=failed",
      description: "Discord 送信 failed",
      icon: "alert",
      tone: counts.notificationFailed > 0 ? "danger" : "neutral",
    },
    {
      label: "通知処理固着",
      value: counts.notificationStuck,
      href: "/admin/notifications?status=processing",
      description: "processing 15分超",
      icon: "clock",
      tone: counts.notificationStuck > 0 ? "danger" : "neutral",
    },
    {
      label: "YouTube同期失敗",
      value: counts.youtubeFailed,
      href: "/admin/youtube-sync?failed=1",
      description: "metadata sync failed",
      icon: "refresh",
      tone: counts.youtubeFailed > 0 ? "warn" : "neutral",
    },
    {
      label: "未解決ケース",
      value: counts.moderationOpen,
      href: "/admin/moderation?status=open",
      description: "モデレーション open",
      icon: "warning",
      tone: counts.moderationOpen > 0 ? "warn" : "neutral",
    },
    {
      label: "期限切れケース",
      value: counts.moderationOverdue,
      href: "/admin/moderation?status=open&overdue=1",
      description: "due_at 超過",
      icon: "alert",
      tone: counts.moderationOverdue > 0 ? "danger" : "neutral",
    },
  ] satisfies Array<{
    label: string;
    value: number;
    href: string;
    description: string;
    icon: IconName;
    tone: Tone;
  }>;

  const pendingTotal = items.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="fn-admin-dashboard">
      <AdminPageHeader
        title="管理ダッシュボード"
        description="Cloudflare 無料枠を圧迫しないよう、管理トップは対応待ち件数だけを軽量クエリで表示します。"
        actions={[
          {
            href: "/admin/videos?status=pending",
            label: "作品を審査",
            variant: counts.pendingVideos > 0 ? "primary" : "ghost",
            icon: <Icon name="youtube" size={14} aria-hidden />,
          },
          {
            href: "/admin/events",
            label: "イベント管理",
            variant: "ghost",
            icon: <Icon name="calendar" size={14} aria-hidden />,
          },
        ]}
      />

      <section
        className="fn-admin-dashboard-overview"
        aria-labelledby="admin-dashboard-overview-title"
      >
        <div className="fn-admin-dashboard-overview-copy">
          <p className="fn-admin-dashboard-eyebrow">OPERATIONS CENTER</p>
          <h2 id="admin-dashboard-overview-title">今日の対応状況</h2>
          <p>
            件数をクリックすると、そのまま該当キューへ移動できます。
            詳細な診断は必要なときだけ開いてください。
          </p>
        </div>
        <div
          className="fn-admin-dashboard-status"
          data-state={pendingTotal === 0 ? "clear" : "attention"}
          aria-live="polite"
        >
          <span className="fn-admin-dashboard-status-dot" aria-hidden="true" />
          <span className="fn-admin-dashboard-status-count">
            {pendingTotal.toLocaleString()}
          </span>
          <span>
            <strong>{pendingTotal === 0 ? "対応待ちなし" : "確認が必要"}</strong>
            <small>
              {pendingTotal === 0
                ? "主要キューはクリアです"
                : "優先度の高い項目から確認してください"}
            </small>
          </span>
        </div>
      </section>

      <section
        aria-labelledby="pending-counts"
        className="fn-admin-dashboard-section"
      >
        <div className="fn-admin-dashboard-section-heading">
          <div>
            <p className="fn-admin-dashboard-eyebrow">INBOX</p>
            <h2 id="pending-counts">対応待ち</h2>
          </div>
          <div className="fn-admin-dashboard-section-meta">
            <span className="fn-admin-dashboard-section-count">
              {pendingTotal.toLocaleString()} 件
            </span>
            <span>カードから各管理キューへ</span>
          </div>
        </div>
        <div className="fn-admin-stat-grid">
          {items.map((item) => (
            <PendingCountCard key={item.label} {...item} />
          ))}
        </div>
      </section>

      {pendingTotal === 0 ? (
        <div className="fn-admin-dashboard-empty">
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

      <div className="fn-admin-dashboard-support-grid">
        <section className="fn-admin-dashboard-panel fn-admin-dashboard-panel--cost">
          <div className="fn-admin-dashboard-panel-heading">
            <div>
              <p className="fn-admin-dashboard-eyebrow">RUNTIME</p>
              <h2>コストガード</h2>
            </div>
            <Icon name="settings" size={18} aria-hidden />
          </div>
          <div className="fn-admin-dashboard-panel-body">
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

        <section className="fn-admin-dashboard-panel fn-admin-dashboard-panel--tools">
          <div className="fn-admin-dashboard-panel-heading">
            <div>
              <p className="fn-admin-dashboard-eyebrow">TOOLS</p>
              <h2>診断ツール</h2>
            </div>
            <Icon name="search" size={18} aria-hidden />
          </div>
          <div className="fn-admin-dashboard-panel-body">
            <span className="fn-muted fn-text-sm">必要なときだけ詳細を開きます。</span>
            <Link href="/admin/health" className="fn-btn fn-btn-ghost fn-btn-sm">
              <Icon name="heart" size={13} aria-hidden />
              ヘルスチェック
            </Link>
            <Link href="/admin/health/integrity" className="fn-btn fn-btn-ghost fn-btn-sm">
              <Icon name="check" size={13} aria-hidden />
              DB整合性チェック
            </Link>
            <Link href="/admin/security" className="fn-btn fn-btn-ghost fn-btn-sm">
              <Icon name="warning" size={13} aria-hidden />
              セキュリティ
            </Link>
            <Link href="/admin/audit" className="fn-btn fn-btn-ghost fn-btn-sm">
              <Icon name="list" size={13} aria-hidden />
              監査ログ
            </Link>
          </div>
        </section>
      </div>

      <section
        className="fn-admin-dashboard-panel fn-admin-dashboard-panel--manage"
      >
        <div>
          <p className="fn-admin-dashboard-eyebrow">EVENT OPERATIONS</p>
          <h2>現場運営はこちら</h2>
          <p>枠・審査・スタッフの運営はイベント運営画面で行います。</p>
        </div>
        <Link href="/manage" className="fn-btn fn-btn-primary fn-btn-sm">
          イベント運営へ
          <Icon name="chevron-right" size={11} aria-hidden />
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
  icon,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  description: string;
  icon: IconName;
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
      className={`fn-admin-pending-card fn-admin-pending-card--${tone}`}
      aria-label={`${label}: ${value} 件`}
    >
      <span className="fn-admin-pending-card-top">
        <span className={`fn-admin-pending-card-icon fn-admin-pending-card-icon--${tone}`}>
          <Icon name={icon} size={15} aria-hidden />
        </span>
        <span className={`fn-badge ${badgeClass}`}>{label}</span>
        <Icon name="chevron-right" size={14} aria-hidden />
      </span>
      <strong className="fn-admin-pending-card-value">
        {value.toLocaleString()}
      </strong>
      <span className="fn-admin-pending-card-description">
        {description}
      </span>
    </Link>
  );
}
