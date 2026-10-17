import * as React from "react";
import { EmptyState } from "../feedback/EmptyState.js";
import { Button } from "../components/Button.js";

export interface CreatorVideoItem {
  id: string;
  title: string;
  thumbnailUrl?: string;
  eventName?: string;
  duration?: string;
  creatorName?: string;
  creatorIconUrl?: string;
}

export interface CreatorProfileData {
  id: string;
  name: string;
  handle?: string;
  avatarUrl?: string;
  xUrl?: string;
  youtubeUrl?: string;
  websiteUrl?: string;
  bio?: string;
  contactInfo?: string;
  ownVideos?: CreatorVideoItem[];
  collabVideos?: CreatorVideoItem[];
  isBlocked?: boolean;
  isUnavailable?: boolean;
}

export interface CreatorViewProps {
  creator?: CreatorProfileData | null;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function CreatorView({
  creator,
  emptyTitle = "クリエイターが見つかりません",
  emptyDescription = "指定されたクリエイターは非公開か、存在しない可能性があります。",
}: CreatorViewProps): React.JSX.Element {
  if (!creator || creator.isBlocked || creator.isUnavailable) {
    return (
      <main
        className="cr-screen cr-screen--empty"
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
          action={{ href: "/user", label: "クリエイター一覧へ戻る" }}
        />
      </main>
    );
  }

  return (
    <main
      className="cr-screen"
      style={{
        maxWidth: "1280px",
        margin: "0 auto",
        padding: "var(--space-8, 32px) var(--space-4, 16px) var(--space-12, 48px)",
        width: "100%",
        boxSizing: "border-box",
        color: "var(--ink, #ffffff)",
      }}
    >
      {/* Back to list */}
      <a
        href="/user"
        style={{
          color: "var(--ink-muted, #999999)",
          textDecoration: "none",
          fontSize: "var(--text-ui-size, 14px)",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          marginBottom: "var(--space-6, 24px)",
        }}
      >
        <span>←</span>
        <span>クリエイター一覧</span>
      </a>

      {/* Creator Header */}
      <header
        className="cr-header"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-6, 24px) var(--space-8, 32px)",
          alignItems: "flex-end",
          marginBottom: "var(--space-8, 32px)",
        }}
      >
        {creator.avatarUrl ? (
          <img
            src={creator.avatarUrl}
            alt={creator.name}
            style={{
              width: "128px",
              height: "128px",
              borderRadius: "50%",
              objectFit: "cover",
              flexShrink: 0,
              background: "var(--surface-raised, #1f1f1f)",
            }}
          />
        ) : (
          <div
            style={{
              width: "128px",
              height: "128px",
              borderRadius: "50%",
              background: "var(--surface-active, #333333)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "48px",
              flexShrink: 0,
            }}
          >
            👤
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2, 8px)", minWidth: 0, flex: "1 1 320px" }}>
          <h1
            style={{
              margin: 0,
              fontSize: "var(--text-display-size, 36px)",
              lineHeight: "44px",
              fontWeight: 700,
              wordBreak: "break-word",
            }}
          >
            {creator.name}
          </h1>

          {/* Social Links & Handle */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2, 8px)" }}>
            {creator.xUrl && (
              <a
                href={creator.xUrl}
                target="_blank"
                rel="noreferrer noopener"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "32px",
                  height: "32px",
                  background: "var(--surface-raised, #1f1f1f)",
                  color: "var(--ink, #ffffff)",
                  textDecoration: "none",
                  fontWeight: 600,
                  fontSize: "14px",
                }}
                aria-label={`X ${creator.handle ? `@${creator.handle}` : ""}`}
              >
                𝕏
              </a>
            )}
            {creator.youtubeUrl && (
              <a
                href={creator.youtubeUrl}
                target="_blank"
                rel="noreferrer noopener"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "32px",
                  height: "32px",
                  background: "var(--surface-raised, #1f1f1f)",
                  color: "var(--ink, #ffffff)",
                  textDecoration: "none",
                  fontSize: "14px",
                }}
                aria-label="YouTube"
              >
                ▶
              </a>
            )}
            {creator.websiteUrl && (
              <a
                href={creator.websiteUrl}
                target="_blank"
                rel="noreferrer noopener"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "32px",
                  height: "32px",
                  background: "var(--surface-raised, #1f1f1f)",
                  color: "var(--ink, #ffffff)",
                  textDecoration: "none",
                  fontSize: "14px",
                }}
                aria-label="Web サイト"
              >
                🌐
              </a>
            )}
            {creator.handle && (
              <span style={{ fontSize: "var(--text-ui-size, 14px)", color: "var(--ink-muted, #999999)", marginLeft: "4px" }}>
                @{creator.handle}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Body Split */}
      <div
        className="cr-body"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 300px)",
          gap: "var(--space-8, 32px)",
          alignItems: "start",
        }}
      >
        {/* Main Column (Works & Collaborations) */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8, 32px)", minWidth: 0 }}>
          {/* Own Works */}
          <section aria-labelledby="cr-works-heading" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4, 16px)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 id="cr-works-heading" style={{ margin: 0, fontSize: "var(--text-h2-size, 24px)", fontWeight: 700 }}>
                作品{" "}
                <span style={{ color: "var(--ink-muted, #999999)", fontSize: "16px", fontWeight: 400 }}>
                  {creator.ownVideos?.length ?? 0}
                </span>
              </h2>
              <a
                href={`/user/${encodeURIComponent(creator.id)}/portfolio`}
                style={{
                  color: "var(--brand, #d6ec8a)",
                  textDecoration: "none",
                  fontSize: "var(--text-ui-size, 14px)",
                  fontWeight: 600,
                }}
              >
                ポートフォリオ表示 ↗
              </a>
            </div>

            {creator.ownVideos && creator.ownVideos.length > 0 ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: "var(--space-4, 16px)",
                }}
              >
                {creator.ownVideos.map((v) => (
                  <a
                    key={v.id}
                    href={`/${encodeURIComponent(v.id)}`}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      textDecoration: "none",
                      color: "inherit",
                      background: "var(--surface-raised, #1f1f1f)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        aspectRatio: "16 / 9",
                        background: "var(--black, #000000)",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      {v.thumbnailUrl ? (
                        <img src={v.thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--ink-muted, #999999)",
                          }}
                        >
                          No Image
                        </div>
                      )}
                      {v.duration && (
                        <span
                          style={{
                            position: "absolute",
                            right: "6px",
                            bottom: "6px",
                            background: "rgba(0,0,0,0.8)",
                            color: "var(--white, #ffffff)",
                            fontSize: "11px",
                            padding: "2px 4px",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {v.duration}
                        </span>
                      )}
                    </div>
                    <div style={{ padding: "8px 12px 12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ fontSize: "var(--text-ui-size, 14px)", fontWeight: 600, lineHeight: "20px" }}>
                        {v.title}
                      </span>
                      {v.eventName && (
                        <span style={{ fontSize: "var(--text-label-size, 12px)", color: "var(--ink-muted, #999999)" }}>
                          {v.eventName}
                        </span>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: "var(--text-ui-size, 14px)", color: "var(--ink-muted, #999999)" }}>
                まだ投稿された作品はありません。
              </p>
            )}
          </section>

          {/* Collaborations */}
          {creator.collabVideos && creator.collabVideos.length > 0 && (
            <section aria-labelledby="cr-collab-heading" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4, 16px)" }}>
              <h2 id="cr-collab-heading" style={{ margin: 0, fontSize: "var(--text-h2-size, 24px)", fontWeight: 700 }}>
                参加作品{" "}
                <span style={{ color: "var(--ink-muted, #999999)", fontSize: "16px", fontWeight: 400 }}>
                  {creator.collabVideos.length}
                </span>
              </h2>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: "var(--space-4, 16px)",
                }}
              >
                {creator.collabVideos.map((v) => (
                  <a
                    key={v.id}
                    href={`/${encodeURIComponent(v.id)}`}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      textDecoration: "none",
                      color: "inherit",
                      background: "var(--surface-raised, #1f1f1f)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        aspectRatio: "16 / 9",
                        background: "var(--black, #000000)",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      {v.thumbnailUrl ? (
                        <img src={v.thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--ink-muted, #999999)",
                          }}
                        >
                          No Image
                        </div>
                      )}
                      {v.duration && (
                        <span
                          style={{
                            position: "absolute",
                            right: "6px",
                            bottom: "6px",
                            background: "rgba(0,0,0,0.8)",
                            color: "var(--white, #ffffff)",
                            fontSize: "11px",
                            padding: "2px 4px",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {v.duration}
                        </span>
                      )}
                    </div>
                    <div style={{ padding: "8px 12px 12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ fontSize: "var(--text-ui-size, 14px)", fontWeight: 600, lineHeight: "20px" }}>
                        {v.title}
                      </span>
                      <span style={{ fontSize: "var(--text-label-size, 12px)", color: "var(--ink-muted, #999999)" }}>
                        {v.creatorName ? `${v.creatorName} · ` : ""}
                        {v.eventName ?? ""}
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Aside Sidebar (About & Contact) */}
        <aside
          aria-label="クリエイター情報"
          style={{
            padding: "var(--space-4, 16px)",
            background: "var(--surface-raised, #1f1f1f)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-6, 24px)",
          }}
        >
          {/* About */}
          <div>
            <h2 style={{ margin: "0 0 8px 0", fontSize: "var(--text-h3-size, 18px)", fontWeight: 600 }}>
              About
            </h2>
            <p style={{ margin: 0, fontSize: "var(--text-ui-size, 14px)", lineHeight: "22px", color: "var(--ink-muted, #999999)" }}>
              {creator.bio || "自己紹介は登録されていません。"}
            </p>
          </div>

          {/* Contact */}
          <div>
            <h2 style={{ margin: "0 0 8px 0", fontSize: "var(--text-h3-size, 18px)", fontWeight: 600 }}>
              Contact
            </h2>
            <p style={{ margin: 0, fontSize: "var(--text-ui-size, 14px)", lineHeight: "22px", color: "var(--ink-muted, #999999)" }}>
              {creator.contactInfo || "連絡先は登録されていません。"}
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
