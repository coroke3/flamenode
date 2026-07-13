import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getEnv } from "@/lib/cloudflare";
import {
  YOUTUBE_PROVIDER_KEY,
  YOUTUBE_TARGET_USAGE_PERCENT,
  resolveYoutubeDailyQuotaUnits,
  youtubeDailyBudgetUnits,
  youtubeQuotaDay,
} from "@/lib/youtube/quotaPolicy";
import { formatCount, formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = { title: "YouTube quota" };
export const dynamic = "force-dynamic";

type QuotaRow = {
  used_units: number;
  limit_units: number;
  updated_at: number;
};

export default async function AdminYoutubeQuotaPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const env = getEnv();
  const now = Math.floor(Date.now() / 1000);
  const quotaDay = youtubeQuotaDay(new Date(now * 1_000));
  const configuredUnits = resolveYoutubeDailyQuotaUnits(env.YOUTUBE_DAILY_QUOTA_LIMIT);
  const budgetUnits = youtubeDailyBudgetUnits(env.YOUTUBE_DAILY_QUOTA_LIMIT);
  let row: QuotaRow | null = null;
  let error: string | null = null;

  try {
    if (!env.DB) throw new Error("DB bindingを取得できませんでした。");
    row = await env.DB.prepare(
      `SELECT used_units, limit_units, updated_at
         FROM external_api_quota_usage
        WHERE provider = ?1
          AND quota_day = ?2
        LIMIT 1`,
    )
      .bind(YOUTUBE_PROVIDER_KEY, quotaDay)
      .first<QuotaRow>();
  } catch (cause) {
    error = String(cause);
  }

  const usedUnits = Math.max(0, Number(row?.used_units ?? 0));
  const remainingUnits = Math.max(0, budgetUnits - usedUnits);
  const usagePercent = budgetUnits > 0
    ? Math.min(100, Math.round((usedUnits / budgetUnits) * 1_000) / 10)
    : 0;

  return (
    <div>
      <AdminPageHeader
        title="YouTube quota"
        description="単一APIキーを使用し、Google Cloud Consoleの日次quota設定の80%以内でFlameNodeの処理を共有管理します。"
      />

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/admin/youtube-quota" className="fn-btn fn-btn-primary fn-btn-sm">
          最新状態へ更新
        </Link>
        <Link href="/admin/youtube-sync" className="fn-btn fn-btn-ghost fn-btn-sm">
          YouTube同期状態
        </Link>
        <Link href="/admin/workers" className="fn-btn fn-btn-ghost fn-btn-sm">
          Worker監視
        </Link>
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 18,
            padding: "12px 16px",
            border: "1px solid var(--accent-danger, #dc2626)",
            borderRadius: "var(--radius-md)",
            color: "var(--accent-danger, #991b1b)",
          }}
        >
          quota情報の取得に失敗しました: {error}
        </div>
      ) : null}

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 10,
          marginTop: 18,
        }}
      >
        <StatCard label="quota日（太平洋時間）" value={quotaDay} />
        <StatCard label="Google設定値" value={`${formatCount(configuredUnits)} units`} />
        <StatCard
          label={`FlameNode上限（${YOUTUBE_TARGET_USAGE_PERCENT}%）`}
          value={`${formatCount(budgetUnits)} units`}
        />
        <StatCard label="推定使用量" value={`${formatCount(usedUnits)} units`} />
        <StatCard label="残り予算" value={`${formatCount(remainingUnits)} units`} />
        <StatCard label="使用率" value={`${usagePercent}%`} />
      </section>

      <section className="fn-card" style={{ marginTop: 18, padding: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>運用条件</h2>
        <div className="fn-muted fn-text-sm" style={{ marginTop: 8, display: "grid", gap: 5 }}>
          <div>APIキー: 単一キーのみ</div>
          <div>1回の同期: 最大200作品、videos.list最大4回</div>
          <div>再試行込み外部呼び出し: 最大8回、逐次実行</div>
          <div>最終更新: {formatUnix(row?.updated_at ?? null)}</div>
        </div>
        <p className="fn-muted fn-text-sm" style={{ margin: "10px 0 0" }}>
          この値はFlameNodeが予約・使用したquotaの推定値です。Google Cloud Console外からの利用や、Provider側で計上される失敗リクエストを含む実残量はGoogle Cloud Consoleを正本として確認してください。
        </p>
        <a
          href="https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas"
          target="_blank"
          rel="noopener noreferrer"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          style={{ marginTop: 10 }}
        >
          YouTube API Quotas
        </a>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="fn-card" style={{ padding: "12px 14px" }}>
      <div className="fn-muted fn-text-sm">{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}
