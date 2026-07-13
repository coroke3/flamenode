import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { YoutubeApiKeyStatusCard } from "@/components/admin/YoutubeApiKeyStatusCard";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getEnv } from "@/lib/cloudflare";
import { loadYoutubeApiKeyStatus } from "@/lib/admin/youtubeApiKeyStatus";

export const metadata: Metadata = { title: "YouTube APIキー冗長化" };
export const dynamic = "force-dynamic";

export default async function AdminYoutubeApiKeysPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const env = getEnv();
  const now = Math.floor(Date.now() / 1000);
  const status = env.KV ? await loadYoutubeApiKeyStatus(env.KV) : null;

  return (
    <div>
      <AdminPageHeader
        title="YouTube APIキー冗長化"
        description="主キーと副キーの使用状況、credential障害による切替、一時回避期限を確認します。APIキー本体は保存・表示しません。"
      />
      <div
        style={{
          marginTop: 12,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/admin/youtube-api-keys"
          className="fn-btn fn-btn-primary fn-btn-sm"
        >
          最新状態へ更新
        </Link>
        <Link
          href="/admin/youtube-sync"
          className="fn-btn fn-btn-ghost fn-btn-sm"
        >
          YouTube同期状態
        </Link>
        <Link
          href="/admin/workers"
          className="fn-btn fn-btn-ghost fn-btn-sm"
        >
          Worker監視
        </Link>
      </div>

      <YoutubeApiKeyStatusCard status={status} now={now} />

      <section className="fn-card" style={{ marginTop: 16, padding: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>
          運用ルール
        </h2>
        <p className="fn-muted fn-text-sm" style={{ margin: "8px 0 0" }}>
          副キーは主キーの失効、API未有効化、restriction不整合などcredential固有の障害時だけ使用します。quota超過時は切り替えず、Google Cloud Consoleで割当量を確認してください。
        </p>
      </section>
    </div>
  );
}
