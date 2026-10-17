import * as React from "react";
import { EmptyState } from "../feedback/EmptyState.js";
import { StatusNotice } from "../feedback/StatusNotice.js";
import { Badge } from "../components/Badge.js";
import { Button } from "../components/Button.js";
import { TableScroll } from "../data/TableScroll.js";

export interface VideoDetailMember {
  name: string;
  xHandle?: string;
  role: string;
  chapter?: string;
  comment?: string;
  avatarUrl?: string;
}

export interface VideoDetailChapter {
  time: string;
  label: string;
  author?: string;
  type?: string;
}

export interface VideoDetailEventInfo {
  id: string;
  title: string;
  statusLabel?: string;
  playlistUrl?: string;
  iconUrl?: string;
}

export interface VideoDetailData {
  id: string;
  title: string;
  creatorName: string;
  creatorHandle?: string;
  creatorAvatarUrl?: string;
  publishedAt?: string;
  youtubeVideoId?: string | null;
  introComment?: string;
  highlights?: string;
  musicTitle?: string;
  musicUrl?: string;
  softwareUsed?: string;
  productionEpisode?: string;
  afterword?: string;
  events?: VideoDetailEventInfo[];
  members?: VideoDetailMember[];
  chapters?: VideoDetailChapter[];
  likeCount?: number;
  isLiked?: boolean;
  isSaved?: boolean;
  isBlocked?: boolean;
  isUnavailable?: boolean;
}

export interface VideoDetailViewProps {
  video?: VideoDetailData | null;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function VideoDetailView({
  video,
  emptyTitle = "作品が見つかりません",
  emptyDescription = "指定された作品は非公開か、存在しないか、削除された可能性があります。",
}: VideoDetailViewProps): React.JSX.Element {
  const [memberViewMode, setMemberViewMode] = React.useState<"table" | "card">("table");
  const [isDetailsOpen, setIsDetailsOpen] = React.useState(false);

  if (!video || video.isBlocked || video.isUnavailable) {
    return (
      <main
        className="vd-screen vd-screen--empty"
        style={{
          padding: "var(--space-8, 32px) var(--space-4, 16px)",
          maxWidth: "1280px",
          margin: "0 auto",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          action={{ href: "/list", label: "作品一覧へ戻る" }}
        />
      </main>
    );
  }

  const primaryEvent = video.events && video.events.length > 0 ? video.events[0] : null;
  const otherEvents = video.events && video.events.length > 1 ? video.events.slice(1) : [];

  return (
    <main
      className="vd-screen"
      style={{
        maxWidth: "1440px",
        margin: "0 auto",
        padding: "var(--space-4, 16px) var(--space-4, 16px) var(--space-12, 48px)",
        width: "100%",
        boxSizing: "border-box",
        color: "var(--ink, #ffffff)",
      }}
    >
      <div
        className="vd-layout"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 360px)",
          gap: "var(--space-6, 24px)",
          alignItems: "start",
        }}
      >
        {/* Main Column */}
        <div
          className="vd-main"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-6, 24px)",
            minWidth: 0,
          }}
        >
          {/* Player Hero Pane */}
          <section
            aria-label="動画プレイヤー"
            className="vd-player-pane"
            style={{
              width: "100%",
              aspectRatio: "16 / 9",
              background: "var(--black, #000000)",
              borderRadius: "var(--radius-none, 0)",
              overflow: "hidden",
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {video.youtubeVideoId ? (
              <iframe
                title={video.title}
                src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.youtubeVideoId)}?enablejsapi=1`}
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <div
                className="vd-player-fallback"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "var(--space-3, 12px)",
                  padding: "var(--space-6, 24px)",
                  textAlign: "center",
                  background: "var(--surface-raised, #1f1f1f)",
                  color: "var(--ink-muted, #999999)",
                  width: "100%",
                  height: "100%",
                }}
              >
                <span style={{ fontSize: "32px" }}>▶</span>
                <p style={{ margin: 0, fontSize: "var(--text-ui-size, 14px)", lineHeight: "20px" }}>
                  YouTube の動画はまだ登録されていません。作品情報は公開中です。
                </p>
              </div>
            )}
          </section>

          {/* Info Section */}
          <section aria-label="作品基本情報" className="vd-info" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4, 16px)" }}>
            <h1
              className="vd-title"
              style={{
                margin: 0,
                fontSize: "var(--text-h1-size, 32px)",
                lineHeight: "var(--text-h1-line-height, 40px)",
                fontWeight: 700,
                wordBreak: "break-word",
              }}
            >
              {video.title}
            </h1>

            {/* Creator Bar & Actions */}
            <div
              className="vd-meta-bar"
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--space-3, 12px) var(--space-4, 16px)",
              }}
            >
              {/* Creator details */}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3, 12px)", minWidth: 0 }}>
                {video.creatorAvatarUrl ? (
                  <img
                    src={video.creatorAvatarUrl}
                    alt={video.creatorName}
                    style={{ width: "40px", height: "40px", borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                  />
                ) : (
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "50%",
                      background: "var(--surface-active, #333333)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    👤
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <a
                    href={`/user/${encodeURIComponent(video.creatorHandle ?? video.creatorName)}`}
                    style={{
                      color: "var(--ink, #ffffff)",
                      fontWeight: 600,
                      textDecoration: "none",
                      fontSize: "var(--text-ui-size, 14px)",
                    }}
                  >
                    {video.creatorName}
                  </a>
                  <span style={{ fontSize: "var(--text-label-size, 12px)", color: "var(--ink-muted, #999999)" }}>
                    {video.creatorHandle ? `@${video.creatorHandle} · ` : ""}
                    {video.publishedAt ? `公開 ${video.publishedAt}` : ""}
                  </span>
                </div>
              </div>

              {/* Actions (Like, Save) */}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2, 8px)" }}>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-pressed={video.isLiked}
                  style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1, 4px)" }}
                >
                  <span>♥</span>
                  <span>{video.likeCount ?? 0}</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-pressed={video.isSaved}
                  aria-label="セーブ"
                >
                  <span>★</span>
                </Button>
              </div>
            </div>

            {/* Event Tag Bar */}
            {primaryEvent && (
              <div
                className="vd-event-bar"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "var(--space-2, 8px) var(--space-4, 16px)",
                  fontSize: "var(--text-ui-size, 14px)",
                  padding: "var(--space-2, 8px) var(--space-3, 12px)",
                  background: "var(--surface-subtle, #141414)",
                  borderRadius: "var(--radius-none, 0)",
                }}
              >
                <span style={{ fontWeight: 600 }}>イベント:</span>
                <a
                  href={`/event/${encodeURIComponent(primaryEvent.id)}`}
                  style={{ color: "var(--brand, #d6ec8a)", textDecoration: "none", fontWeight: 600 }}
                >
                  {primaryEvent.title}
                </a>
                {primaryEvent.statusLabel && (
                  <Badge status="draft" label={primaryEvent.statusLabel} />
                )}
                {primaryEvent.playlistUrl && (
                  <a
                    href={primaryEvent.playlistUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    style={{
                      color: "var(--ink-muted, #999999)",
                      textDecoration: "none",
                      fontSize: "var(--text-label-size, 12px)",
                      marginLeft: "auto",
                    }}
                  >
                    YouTube 再生リスト ↗
                  </a>
                )}
              </div>
            )}

            {/* Other Events */}
            {otherEvents.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2, 8px)", fontSize: "var(--text-label-size, 12px)" }}>
                <span style={{ color: "var(--ink-muted, #999999)" }}>他の所属:</span>
                {otherEvents.map((ev) => (
                  <a
                    key={ev.id}
                    href={`/event/${encodeURIComponent(ev.id)}`}
                    style={{
                      color: "var(--ink, #ffffff)",
                      padding: "2px 8px",
                      background: "var(--surface-active, #1f1f1f)",
                      textDecoration: "none",
                    }}
                  >
                    {ev.title}
                  </a>
                ))}
              </div>
            )}

            {/* Description & Metadata */}
            <div
              className="vd-description-box"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-3, 12px)",
                padding: "var(--space-4, 16px)",
                background: "var(--surface-raised, #1f1f1f)",
                fontSize: "var(--text-ui-size, 14px)",
                lineHeight: "22px",
              }}
            >
              {video.introComment && <p style={{ margin: 0 }}>{video.introComment}</p>}

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "var(--space-2, 8px) var(--space-6, 24px)",
                  color: "var(--ink-muted, #999999)",
                  fontSize: "var(--text-body-sm-size, 13px)",
                }}
              >
                {video.musicTitle && (
                  <span>
                    使用楽曲:{" "}
                    {video.musicUrl ? (
                      <a href={video.musicUrl} target="_blank" rel="noreferrer noopener" style={{ color: "var(--ink, #ffffff)" }}>
                        {video.musicTitle} ↗
                      </a>
                    ) : (
                      <strong style={{ color: "var(--ink, #ffffff)" }}>{video.musicTitle}</strong>
                    )}
                  </span>
                )}
                {video.softwareUsed && (
                  <span>
                    使用ソフト: <strong style={{ color: "var(--ink, #ffffff)" }}>{video.softwareUsed}</strong>
                  </span>
                )}
              </div>

              {(video.highlights || video.productionEpisode || video.afterword) && (
                <details
                  open={isDetailsOpen}
                  onToggle={(e) => setIsDetailsOpen(e.currentTarget.open)}
                  style={{ marginTop: "var(--space-2, 8px)" }}
                >
                  <summary style={{ cursor: "pointer", color: "var(--brand, #d6ec8a)", fontWeight: 600 }}>
                    詳細コメント {isDetailsOpen ? "▲" : "▼"}
                  </summary>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "120px minmax(0, 1fr)",
                      gap: "var(--space-2, 8px) var(--space-4, 16px)",
                      marginTop: "var(--space-3, 12px)",
                      paddingTop: "var(--space-2, 8px)",
                      borderTop: "1px solid var(--surface-active, #333333)",
                    }}
                  >
                    {video.highlights && (
                      <>
                        <span style={{ color: "var(--ink-muted, #999999)" }}>みどころ</span>
                        <span>{video.highlights}</span>
                      </>
                    )}
                    {video.productionEpisode && (
                      <>
                        <span style={{ color: "var(--ink-muted, #999999)" }}>制作エピソード</span>
                        <span>{video.productionEpisode}</span>
                      </>
                    )}
                    {video.afterword && (
                      <>
                        <span style={{ color: "var(--ink-muted, #999999)" }}>あとがき</span>
                        <span>{video.afterword}</span>
                      </>
                    )}
                  </div>
                </details>
              )}
            </div>
          </section>

          {/* Members Section */}
          {video.members && video.members.length > 0 && (
            <section
              aria-labelledby="vd-members-heading"
              className="vd-members"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-3, 12px)",
                marginTop: "var(--space-4, 16px)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <h2
                  id="vd-members-heading"
                  style={{
                    margin: 0,
                    fontSize: "var(--text-h2-size, 24px)",
                    fontWeight: 700,
                  }}
                >
                  参加メンバー <span style={{ color: "var(--ink-muted, #999999)", fontSize: "16px", fontWeight: 400 }}>{video.members.length}</span>
                </h2>
                <div style={{ display: "flex", gap: "2px" }} role="group" aria-label="メンバー表示切替">
                  <Button
                    variant={memberViewMode === "table" ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => setMemberViewMode("table")}
                    aria-pressed={memberViewMode === "table"}
                  >
                    テーブル
                  </Button>
                  <Button
                    variant={memberViewMode === "card" ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => setMemberViewMode("card")}
                    aria-pressed={memberViewMode === "card"}
                  >
                    カード
                  </Button>
                </div>
              </div>

              {memberViewMode === "table" ? (
                <TableScroll ariaLabel="参加メンバー一覧">
                  <table
                    style={{
                      width: "100%",
                      minWidth: "540px",
                      borderCollapse: "collapse",
                      fontSize: "var(--text-ui-size, 14px)",
                    }}
                  >
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--surface-active, #333333)", color: "var(--ink-muted, #999999)", textAlign: "left" }}>
                        <th style={{ padding: "8px 12px" }}>活動名</th>
                        <th style={{ padding: "8px 12px" }}>役割</th>
                        <th style={{ padding: "8px 12px" }}>チャプター</th>
                        <th style={{ padding: "8px 12px" }}>コメント</th>
                      </tr>
                    </thead>
                    <tbody>
                      {video.members.map((m, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid var(--surface-subtle, #1f1f1f)" }}>
                          <td style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: "8px" }}>
                            {m.avatarUrl && (
                              <img src={m.avatarUrl} alt="" style={{ width: "24px", height: "24px", borderRadius: "50%" }} />
                            )}
                            <div>
                              <span>{m.name}</span>
                              {m.xHandle && (
                                <span style={{ color: "var(--ink-muted, #999999)", fontSize: "11px", display: "block" }}>
                                  @{m.xHandle}
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: "8px 12px" }}>{m.role}</td>
                          <td style={{ padding: "8px 12px", color: "var(--brand, #d6ec8a)", fontFamily: "var(--font-mono)" }}>
                            {m.chapter ?? "—"}
                          </td>
                          <td style={{ padding: "8px 12px", color: "var(--ink-muted, #999999)" }}>{m.comment ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: "var(--space-3, 12px)",
                  }}
                >
                  {video.members.map((m, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: "var(--space-3, 12px)",
                        background: "var(--surface-raised, #1f1f1f)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "var(--space-2, 8px)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {m.avatarUrl && (
                          <img src={m.avatarUrl} alt="" style={{ width: "36px", height: "36px", borderRadius: "50%" }} />
                        )}
                        <div>
                          <strong style={{ fontSize: "var(--text-ui-size, 14px)" }}>{m.name}</strong>
                          {m.xHandle && (
                            <span style={{ color: "var(--ink-muted, #999999)", fontSize: "12px", display: "block" }}>
                              @{m.xHandle}
                            </span>
                          )}
                        </div>
                      </div>
                      <Badge status="draft" label={m.role} />
                      {m.comment && (
                        <p style={{ margin: 0, fontSize: "var(--text-body-sm-size, 13px)", color: "var(--ink-muted, #999999)" }}>
                          {m.comment}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        {/* Aside Sidebar (Chapters) */}
        <aside
          aria-label="チャプターと再生リスト"
          className="vd-sidebar"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4, 16px)",
            minWidth: 0,
          }}
        >
          <div
            style={{
              padding: "var(--space-4, 16px)",
              background: "var(--surface-raised, #1f1f1f)",
              borderRadius: "var(--radius-none, 0)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "var(--space-3, 12px)",
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: "var(--text-h3-size, 18px)",
                  fontWeight: 600,
                }}
              >
                チャプター{" "}
                <span style={{ color: "var(--ink-muted, #999999)", fontSize: "14px", fontWeight: 400 }}>
                  {video.chapters?.length ?? 0}
                </span>
              </h2>
            </div>

            {video.chapters && video.chapters.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-1, 4px)",
                  maxHeight: "420px",
                  overflowY: "auto",
                }}
              >
                {video.chapters.map((ch, idx) => (
                  <button
                    key={idx}
                    type="button"
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "var(--space-3, 12px)",
                      padding: "var(--space-2, 8px)",
                      background: "transparent",
                      border: "none",
                      color: "inherit",
                      textAlign: "left",
                      cursor: "pointer",
                      width: "100%",
                      borderRadius: "var(--radius-none, 0)",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--brand, #d6ec8a)",
                        fontSize: "var(--text-body-sm-size, 13px)",
                        flexShrink: 0,
                        width: "44px",
                      }}
                    >
                      {ch.time}
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <span style={{ fontSize: "var(--text-ui-size, 14px)", fontWeight: 500 }}>{ch.label}</span>
                      {ch.author && (
                        <span style={{ fontSize: "var(--text-label-size, 12px)", color: "var(--ink-muted, #999999)" }}>
                          {ch.author}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: "var(--text-ui-size, 14px)", color: "var(--ink-muted, #999999)" }}>
                チャプター情報はまだ登録されていません。
              </p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
