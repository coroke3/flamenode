import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { desc, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  videoModerationCases,
  videos as videosTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { youtubeThumbUrl, youtubeWatchUrl } from "@/lib/youtube/id";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { AdminVideoStatusForm } from "@/components/admin/AdminVideoStatusForm";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getVideoSoftwareLabel } from "@/lib/db/software";
import { createModerationCase } from "@/lib/actions/moderation-admin";

export const metadata: Metadata = { title: "作品詳細" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

async function createModerationCaseAction(formData: FormData): Promise<void> {
  "use server";
  await createModerationCase(formData);
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
        creator_name: sql<string>`COALESCE(${xUsersTable.x_name}, ${videosTable.creator_display_name}, ${videosTable.creator_x_user_id})`,
        creator_x_user_id: videosTable.creator_x_user_id,
        created_at: videosTable.created_at,
        youtube_video_id: videosTable.youtube_video_id,
        music: videosTable.music,
        credit: videosTable.credit,
        intro_comment: videosTable.intro_comment,
        highlights: videosTable.highlights,
        production_story: videosTable.production_story,
        status: videosTable.visibility_status,
      })
      .from(videosTable)
      .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_x_user_id))
      .where(eq(videosTable.id, id))
      .limit(1)
  )[0];
  if (!video) notFound();
  const softwareLabel = await getVideoSoftwareLabel(db, video.id);
  const moderationCases = await db
    .select({
      id: videoModerationCases.id,
      case_type: videoModerationCases.case_type,
      status: videoModerationCases.status,
      public_reason: videoModerationCases.public_reason,
      private_note: videoModerationCases.private_note,
      due_at: videoModerationCases.due_at,
      related_x_user_id: videoModerationCases.related_x_user_id,
      created_at: videoModerationCases.created_at,
      resolved_at: videoModerationCases.resolved_at,
    })
    .from(videoModerationCases)
    .where(eq(videoModerationCases.video_id, video.id))
    .orderBy(desc(videoModerationCases.created_at))
    .limit(20);
  const openCaseCount = moderationCases.filter((c) => c.status === "open").length;

  return (
    <div>
      <AdminPageHeader
        title={video.title}
        description={`作者: ${video.creator_name} (@${video.creator_x_user_id}) / 登録: ${formatUnix(video.created_at)} (${formatRelative(video.created_at)})`}
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
            <dd>{softwareLabel ?? "-"}</dd>
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

          <section className="fn-card" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
              モデレーションケース
            </h2>
            <p className="fn-muted" style={{ marginBottom: 12, fontSize: 12 }}>
              未解決 {openCaseCount} 件 / 直近 {moderationCases.length} 件
            </p>

            {moderationCases.length > 0 ? (
              <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                {moderationCases.map((item) => (
                  <details
                    key={item.id}
                    style={{
                      padding: 10,
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    <summary style={{ cursor: "pointer", fontSize: 12 }}>
                      <span
                        className={`fn-badge ${
                          item.status === "open" ? "fn-badge-warning" : "fn-badge-soft"
                        }`}
                      >
                        {item.status}
                      </span>{" "}
                      <code>{item.case_type}</code>{" "}
                      <span className="fn-muted">{formatUnix(item.created_at)}</span>
                    </summary>
                    <dl
                      style={{
                        marginTop: 8,
                        display: "grid",
                        gridTemplateColumns: "auto 1fr",
                        gap: "4px 8px",
                        fontSize: 12,
                      }}
                    >
                      <dt className="fn-muted">期限</dt>
                      <dd>{item.due_at ? formatUnix(item.due_at) : "-"}</dd>
                      <dt className="fn-muted">関連X ID</dt>
                      <dd>{item.related_x_user_id ? `@${item.related_x_user_id}` : "-"}</dd>
                      <dt className="fn-muted">公開理由</dt>
                      <dd style={{ whiteSpace: "pre-wrap" }}>{item.public_reason || "-"}</dd>
                      <dt className="fn-muted">内部メモ</dt>
                      <dd style={{ whiteSpace: "pre-wrap" }}>{item.private_note || "-"}</dd>
                      <dt className="fn-muted">解決日時</dt>
                      <dd>{item.resolved_at ? formatUnix(item.resolved_at) : "-"}</dd>
                    </dl>
                  </details>
                ))}
              </div>
            ) : (
              <p className="fn-muted" style={{ marginBottom: 14, fontSize: 12 }}>
                この作品のケースはまだありません。
              </p>
            )}

            <form action={createModerationCaseAction} style={{ display: "grid", gap: 8 }}>
              <input type="hidden" name="video_id" value={video.id} />
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                種別
                <select name="case_type" className="fn-select" defaultValue="rights">
                  <option value="rights">rights: 権利・楽曲・素材確認</option>
                  <option value="duplicate">duplicate: 重複投稿</option>
                  <option value="void">void: 一時停止・確認中</option>
                  <option value="x_reapply">x_reapply: X ID再申請</option>
                  <option value="operator">operator: 運営判断</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                公開理由
                <textarea
                  name="public_reason"
                  className="fn-input"
                  rows={2}
                  maxLength={1000}
                  placeholder="ユーザーに見せてもよい理由"
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                内部メモ
                <textarea
                  name="private_note"
                  className="fn-input"
                  rows={2}
                  maxLength={2000}
                  placeholder="運営内メモ"
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                  期限
                  <input type="datetime-local" name="due_at" className="fn-input" />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                  関連X ID
                  <input
                    name="related_x_user_id"
                    className="fn-input"
                    placeholder="@x_id"
                    maxLength={40}
                  />
                </label>
              </div>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                起票時の作品状態
                <select name="video_status" className="fn-select" defaultValue="">
                  <option value="">変更しない</option>
                  <option value="voided">voided: 一時的に公開停止</option>
                  <option value="hidden">hidden: 非表示</option>
                  <option value="pending">pending: 再確認待ち</option>
                </select>
              </label>
              <button
                type="submit"
                className="fn-btn fn-btn-primary"
                aria-label="モデレーションケースを作成"
              >
                <Icon name="warning" size={12} aria-hidden /> ケースを作成
              </button>
            </form>
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
