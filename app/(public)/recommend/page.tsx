import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getDatabase } from "@/lib/cloudflare";
import {
  fetchLatestVideos,
  fetchPickupCreators,
  fetchRecommendedVideos,
} from "@/lib/db/queries";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { CreatorCard } from "@/components/user/CreatorCard";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { Shelf } from "@/components/layout/Shelf";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "おすすめ" };
export const dynamic = "force-dynamic";

export default async function RecommendPage(): Promise<React.ReactElement> {
  const db = getDatabase();

  let recommended: VideoCardData[] = [];
  let latest: VideoCardData[] = [];
  let creators: Awaited<ReturnType<typeof fetchPickupCreators>> = [];

  if (db) {
    try {
      [recommended, latest, creators] = await Promise.all([
        fetchRecommendedVideos(db, 60),
        fetchLatestVideos(db, 30),
        fetchPickupCreators(db, 40),
      ]);
    } catch (e) {
      console.error("[RecommendPage] fetch failed", e);
    }
  }

  const lead = recommended.slice(0, 3);
  const rest = recommended.slice(3);

  return (
    <div
      style={{
        width: "min(96%, var(--content-max))",
        margin: "0 auto",
        padding: "28px 16px 64px",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <p className="fn-muted fn-text-xs fn-bold">RECOMMEND</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "0.04em" }}>
          次に見る作品を探す
        </h1>
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: 13,
            marginTop: 4,
            maxWidth: 640,
            lineHeight: 1.8,
          }}
        >
          スコア、最近の動き、クリエイターの投稿量を手がかりに、トップページとは違う切り口で作品を並べています。
        </p>
      </header>

      {lead.length > 0 ? (
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
            gap: 14,
            alignItems: "stretch",
          }}
        >
          <VideoCard video={lead[0]} />
          <div
            style={{
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-surface)",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div>
              <p className="fn-muted fn-text-xs fn-bold">WATCH QUEUE</p>
              <h2 style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>
                まず押さえたい候補
              </h2>
            </div>
            {lead.map((v, index) => (
              <Link
                key={v.id}
                href={`/${v.youtube_video_id ?? v.id}`}
                className="fn-btn fn-btn-ghost"
                style={{ justifyContent: "flex-start" }}
              >
                <span style={{ color: "var(--accent-primary)", fontWeight: 800 }}>
                  {index + 1}
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {v.title}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <p
          style={{
            textAlign: "center",
            padding: "32px 0",
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          まだおすすめできる作品がありません。
        </p>
      )}

      <section style={{ marginTop: 42 }}>
        <SectionHeader title="スコアから見る" />
        <div style={{ marginTop: 16 }}>
          {rest.length === 0 ? (
            <p className="fn-muted fn-text-sm">追加のおすすめ作品はありません。</p>
          ) : (
            <Shelf ariaLabel="スコア上位の作品">
              {rest.map((v) => (
                <VideoCard key={v.id} video={v} />
              ))}
            </Shelf>
          )}
        </div>
      </section>

      <section id="creators" style={{ marginTop: 48 }}>
        <SectionHeader title="クリエイター発見" moreHref="/user" />
        <div style={{ marginTop: 16 }}>
          {creators.length === 0 ? (
            <p className="fn-muted fn-text-sm">該当するクリエイターがまだいません。</p>
          ) : (
            <Shelf ariaLabel="ピックアップクリエイター">
              {creators.map((c) => (
                <CreatorCard
                  key={c.id}
                  data={{
                    id: c.id,
                    x_name: c.x_name,
                    icon_url: c.icon_url,
                    video_count:
                      (Number(c.video_count) || 0) +
                      (Number(c.collab_count) || 0),
                  }}
                />
              ))}
            </Shelf>
          )}
        </div>
      </section>

      <section style={{ marginTop: 48 }}>
        <SectionHeader title="新着を流し見" moreHref="/list?sort=new" />
        <div style={{ marginTop: 16 }}>
          {latest.length === 0 ? (
            <p className="fn-muted fn-text-sm">新着作品がまだありません。</p>
          ) : (
            <Shelf ariaLabel="新着作品">
              {latest.map((v) => (
                <VideoCard key={v.id} video={v} />
              ))}
            </Shelf>
          )}
        </div>
      </section>

      <div style={{ marginTop: 36 }}>
        <Link href="/list" className="fn-btn fn-btn-primary">
          <Icon name="grid" size={14} aria-hidden /> 一覧でさらに探す
        </Link>
      </div>
    </div>
  );
}
