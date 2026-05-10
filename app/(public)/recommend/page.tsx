import * as React from "react";
import type { Metadata } from "next";
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

export const metadata: Metadata = { title: "おすすめ" };
export const dynamic = "force-dynamic";

export default async function RecommendPage(): Promise<React.ReactElement> {
  const db = getDatabase();

  let recommended: VideoCardData[] = [];
  let trending: VideoCardData[] = [];
  let creators: Awaited<ReturnType<typeof fetchPickupCreators>> = [];

  if (db) {
    try {
      [recommended, trending, creators] = await Promise.all([
        fetchRecommendedVideos(db, 60),
        fetchLatestVideos(db, 30),
        fetchPickupCreators(db, 40),
      ]);
    } catch (e) {
      console.error("[RecommendPage] fetch failed", e);
    }
  }

  return (
    <div
      style={{
        width: "min(96%, var(--content-max))",
        margin: "0 auto",
        padding: "28px 16px 64px",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "0.04em" }}>
          おすすめ
        </h1>
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: 13,
            marginTop: 4,
          }}
        >
          スコアと文脈近さに基づき、いま観てほしい作品とクリエイターをまとめます。
        </p>
      </header>

      <section style={{ marginTop: 24 }}>
        <SectionHeader title="スコア上位の作品" />
        <div style={{ marginTop: 16 }}>
          {recommended.length === 0 ? (
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
          ) : (
            <Shelf ariaLabel="おすすめ作品">
              {recommended.map((v) => (
                <VideoCard key={v.id} video={v} />
              ))}
            </Shelf>
          )}
        </div>
      </section>

      <section id="creators" style={{ marginTop: 48 }}>
        <SectionHeader title="クリエイター" />
        <div style={{ marginTop: 16 }}>
          {creators.length === 0 ? (
            <p
              style={{
                textAlign: "center",
                padding: "32px 0",
                color: "var(--text-muted)",
                fontSize: 13,
              }}
            >
              該当するクリエイターがまだいません。
            </p>
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
        <SectionHeader title="新着" moreHref="/list?sort=new" />
        <div style={{ marginTop: 16 }}>
          {trending.length === 0 ? (
            <p
              style={{
                textAlign: "center",
                padding: "32px 0",
                color: "var(--text-muted)",
                fontSize: 13,
              }}
            >
              まだ新着作品がありません。
            </p>
          ) : (
            <Shelf ariaLabel="新着作品">
              {trending.map((v) => (
                <VideoCard key={v.id} video={v} />
              ))}
            </Shelf>
          )}
        </div>
      </section>
    </div>
  );
}
