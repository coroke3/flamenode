import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { videos as videosTable, xUsers as xUsersTable } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { youtubeThumbUrl, youtubeWatchUrl } from "@/lib/youtube/id";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { AdminVideoStatusForm } from "@/components/admin/AdminVideoStatusForm";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const metadata: Metadata = { title: "作品詳細" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminVideoDetailPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) notFound();

  const video = (
    await db
      .select({
        id: videosTable.id,
        title: videosTable.title,
        creator_name: sql<string>`COALESCE(${xUsersTable.x_name}, ${videosTable.display_name}, ${videosTable.contact_x_id})`,
        contact_x_id: videosTable.contact_x_id,
        created_at: videosTable.created_at,
        youtube_video_id: videosTable.youtube_video_id,
        music: videosTable.music,
        credit: videosTable.credit,
        used_software: videosTable.used_software,
        intro_comment: videosTable.intro_comment,
        highlights: videosTable.highlights,
        production_story: videosTable.production_story,
        status: videosTable.status,
      })
      .from(videosTable)
      .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_id))
      .where(eq(videosTable.id, id))
      .limit(1)
  )[0];
  if (!video) notFound();

  return (
    <div>
      <AdminPageHeader
        title={video.title}
        description={`作者: ${video.creator_name} (@${video.contact_x_id}) / 登録: ${formatUnix(video.created_at)} (${formatRelative(video.created_at)})`}
        backHref="/admin/videos"
        backLabel="作品一覧へ"
        actions={[
          {
            href: `/admin/videos/${video.id}/members`,
            label: "参加者設定",
            icon: <Icon name="users" size={12} aria-hidden />,
            variant: "primary",
          },
          {
            href: `/admin/audit?table=videos&record=${encodeURIComponent(video.id)}`,
            label: "監査ログ",
            icon: <Icon name="clock" size={12} aria-hidden />,
          },
        ]}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(280px, 0.8fr)",
          gap: 24,
          marginTop: 22,
        }}
      >
        <section>
          <div
            style={{
              width: "100%",
              aspectRatio: "16 / 9",
              background: "var(--bg-elevated)",
              borderRadius: "var(--radius-md)",
              overflow: "hidden",
            }}
          >
            {video.youtube_video_id ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={youtubeThumbUrl(video.youtube_video_id, "maxresdefault") ?? ""}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  display: "grid",
                  placeItems: "center",
                  height: "100%",
                  color: "var(--text-muted)",
                }}
              >
                <Icon name="youtube" size={28} aria-hidden />
              </div>
            )}
          </div>

          <dl
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "6px 12px",
              fontSize: 13,
            }}
          >
            <dt className="fn-muted">YouTube ID</dt>
            <dd>
              {video.youtube_video_id ? (
                <a
                  href={youtubeWatchUrl(video.youtube_video_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {video.youtube_video_id} <Icon name="external" size={10} aria-hidden />
                </a>
              ) : (
                "-"
              )}
            </dd>
            <dt className="fn-muted">楽曲</dt>
            <dd>{video.music ?? "-"}</dd>
            <dt className="fn-muted">クレジット</dt>
            <dd>{video.credit ?? "-"}</dd>
            <dt className="fn-muted">使用ソフト</dt>
            <dd>{video.used_software ?? "-"}</dd>
            <dt className="fn-muted">紹介コメント</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{video.intro_comment ?? "-"}</dd>
            <dt className="fn-muted">見どころ</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{video.highlights ?? "-"}</dd>
            <dt className="fn-muted">制作エピソード</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{video.production_story ?? "-"}</dd>
          </dl>
        </section>

        <aside>
          <section className="fn-card" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
              ステータス操作
            </h2>
            <p style={{ marginBottom: 12, fontSize: 12 }}>
              現在:{" "}
              <span
                className={`fn-badge ${
                  video.status === "public"
                    ? "fn-badge-accent"
                    : video.status === "pending"
                      ? "fn-badge-warning"
                      : video.status === "voided"
                        ? "fn-badge-danger"
                        : "fn-badge-soft"
                }`}
              >
                {video.status}
              </span>
            </p>
            <AdminVideoStatusForm videoId={video.id} currentStatus={video.status} />
          </section>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link
              href={`/${video.youtube_video_id ?? video.id}`}
              className="fn-btn fn-btn-ghost"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="external" size={12} aria-hidden /> 公開ページ
            </Link>
            <Link href={`/dashboard/edit/${video.id}`} className="fn-btn fn-btn-ghost">
              <Icon name="edit" size={12} aria-hidden /> 編集画面
            </Link>
            <Link href={`/admin/videos/${video.id}/members`} className="fn-btn fn-btn-ghost">
              <Icon name="users" size={12} aria-hidden /> 参加者設定
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
