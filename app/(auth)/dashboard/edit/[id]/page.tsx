import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { videos as videosTable } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guard";
import { canEditVideo } from "@/lib/auth/ownership";
import { VideoForm } from "@/components/forms/VideoForm";
import { Icon } from "@/components/ui/Icon";
import { youtubeWatchUrl } from "@/lib/youtube/id";

export const metadata: Metadata = { title: "作品を編集" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditVideoPage({
  params,
}: Props): Promise<React.ReactElement> {
  const guard = await requireSession();
  if (!guard.ok) return guard.element;
  const user = guard.user;
  const { id } = await params;

  const db = getDatabase();
  if (!db) notFound();
  const rows = await db
    .select()
    .from(videosTable)
    .where(eq(videosTable.id, id))
    .limit(1);
  const video = rows[0];
  if (!video) notFound();
  const canEdit = await canEditVideo({ db, user, video });
  if (!canEdit) {
    return (
      <div
        style={{
          width: "min(96%, 720px)",
          margin: "60px auto",
          padding: "48px 28px",
          background: "var(--bg-surface)",
          border: "1px solid var(--accent-warning)",
          borderRadius: "var(--radius-md)",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--accent-warning)" }}>
          編集権限がありません
        </h1>
        <p style={{ marginTop: 12, color: "var(--text-secondary)" }}>
          この作品の作者本人、または担当イベントの運営のみが編集できます。
        </p>
        <div style={{ marginTop: 18, display: "flex", justifyContent: "center", gap: 8 }}>
          <Link href="/dashboard" className="fn-btn fn-btn-ghost">
            ダッシュボードへ
          </Link>
          <Link
            href={`/${video.youtube_video_id ?? video.id}`}
            className="fn-btn fn-btn-primary"
          >
            公開ページを見る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: "min(96%, 960px)",
        margin: "0 auto",
        padding: "28px 16px 64px",
      }}
    >
      <header style={{ marginBottom: 22 }}>
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          EDIT
        </p>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.04em" }}>
          {video.title}
        </h1>
        <p style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
          現在の状態:
          <span className="fn-badge fn-badge-soft" style={{ marginLeft: 6 }}>
            {video.status}
          </span>
          {video.youtube_video_id ? (
            <>
              {" · "}
              <a
                href={youtubeWatchUrl(video.youtube_video_id)}
                target="_blank"
                rel="noopener noreferrer"
              >
                YouTube で確認 →
              </a>
            </>
          ) : null}
        </p>
      </header>

      <VideoForm
        mode="edit"
        videoId={video.id}
        initial={{
          title: video.title,
          youtube_url: video.youtube_video_id
            ? youtubeWatchUrl(video.youtube_video_id)
            : undefined,
          music: video.music ?? undefined,
          credit: video.credit ?? undefined,
          intro_comment: video.intro_comment ?? undefined,
          used_software: video.used_software ?? undefined,
          highlights: video.highlights ?? undefined,
          production_story: video.production_story ?? undefined,
          closing_comment: video.closing_comment ?? undefined,
          is_collab: video.submission_type === "collab",
        }}
      />

      <p
        style={{
          marginTop: 18,
          color: "var(--text-muted)",
          fontSize: 12,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Icon name="info" size={12} aria-hidden /> 編集権限はこの作品の作者と
        管理者にのみ付与されます。イベント運営は許可された項目のみ編集可能です。
      </p>

      <div style={{ marginTop: 24 }}>
        <Link href="/dashboard" className="fn-btn fn-btn-ghost">
          ダッシュボードへ戻る
        </Link>
      </div>
    </div>
  );
}
