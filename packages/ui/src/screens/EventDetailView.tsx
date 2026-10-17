import * as React from "react";
import { EmptyState } from "../feedback/EmptyState.js";
import { Badge } from "../components/Badge.js";
import { Button } from "../components/Button.js";

export interface EventDetailMetric {
  value: string | number;
  label: string;
}

export interface EventDetailSlotDay {
  label: string;
  count: string;
  percentage: string;
}

export interface EventDetailVideoItem {
  id: string;
  title: string;
  thumbnailUrl?: string;
  duration?: string;
  creatorName: string;
  creatorAvatarUrl?: string;
}

export interface EventDetailData {
  id: string;
  title: string;
  bannerUrl?: string;
  iconUrl?: string;
  status: "draft" | "upcoming" | "public" | "closed" | "archived";
  statusLabel?: string;
  periodText?: string;
  scheduleDescription?: string;
  aboutText?: string;
  guidelinesText?: string;
  metrics?: EventDetailMetric[];
  slotDays?: EventDetailSlotDay[];
  videos?: EventDetailVideoItem[];
  scheduleItems?: Array<{ label: string; date: string }>;
  isBlocked?: boolean;
  isUnavailable?: boolean;
}

export interface EventDetailViewProps {
  event?: EventDetailData | null;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function EventDetailView({
  event,
  emptyTitle = "イベントが見つかりません",
  emptyDescription = "指定されたイベントは非公開か、存在しないか、終了した可能性があります。",
}: EventDetailViewProps): React.JSX.Element {
  if (!event || event.isBlocked || event.isUnavailable) {
    return (
      <main
        className="ed-screen ed-screen--empty"
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
          action={{ href: "/event", label: "イベント一覧へ戻る" }}
        />
      </main>
    );
  }

  const badgeStatus =
    event.status === "public"
      ? "public"
      : event.status === "upcoming"
        ? "live"
        : "draft";

  return (
    <main
      className="ed-screen"
      style={{
        width: "100%",
        boxSizing: "border-box",
        color: "var(--ink, #ffffff)",
      }}
    >
      {/* Banner */}
      <div
        className="ed-banner"
        style={{
          width: "100%",
          aspectRatio: "4 / 1",
          maxHeight: "360px",
          minHeight: "140px",
          background: "var(--surface-raised, #1f1f1f)",
          overflow: "hidden",
        }}
      >
        {event.bannerUrl ? (
          <img
            src={event.bannerUrl}
            alt={`${event.title} メインビジュアル`}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: "linear-gradient(135deg, var(--gray-850, #1f1f1f) 0%, var(--black, #000000) 100%)",
            }}
          />
        )}
      </div>

      <div
        className="ed-container"
        style={{
          maxWidth: "1280px",
          margin: "0 auto",
          padding: "0 var(--space-4, 16px) var(--space-12, 48px)",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        {/* Event Header with Negative Margin */}
        <header
          className="ed-header"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-4, 16px) var(--space-8, 32px)",
            alignItems: "flex-end",
            justifyContent: "space-between",
            marginTop: "-36px",
            position: "relative",
          }}
        >
          <div style={{ display: "flex", gap: "var(--space-4, 16px)", alignItems: "flex-end", minWidth: 0 }}>
            {event.iconUrl ? (
              <img
                src={event.iconUrl}
                alt=""
                style={{
                  width: "96px",
                  height: "96px",
                  borderRadius: "var(--radius-none, 0)",
                  background: "var(--surface-raised, #1f1f1f)",
                  border: "2px solid var(--black, #000000)",
                  objectFit: "cover",
                  flexShrink: 0,
                }}
              />
            ) : (
              <div
                style={{
                  width: "96px",
                  height: "96px",
                  borderRadius: "var(--radius-none, 0)",
                  background: "var(--surface-raised, #1f1f1f)",
                  border: "2px solid var(--black, #000000)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "36px",
                  flexShrink: 0,
                }}
              >
                🎪
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1, 4px)", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2, 8px)" }}>
                <Badge status={badgeStatus} label={event.statusLabel ?? event.status} />
                {event.periodText && (
                  <span style={{ fontSize: "var(--text-label-size, 12px)", color: "var(--ink-muted, #999999)" }}>
                    {event.periodText}
                  </span>
                )}
              </div>
              <h1
                style={{
                  margin: 0,
                  fontSize: "var(--text-display-size, 36px)",
                  lineHeight: "44px",
                  fontWeight: 700,
                  wordBreak: "break-word",
                }}
              >
                {event.title}
              </h1>
            </div>
          </div>

          {/* Action CTAs */}
          <div style={{ display: "flex", gap: "var(--space-2, 8px)" }}>
            <Button
              variant="primary"
              onClick={() => {
                window.location.href = `/event/${encodeURIComponent(event.id)}/slots`;
              }}
            >
              枠を確保
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                window.location.href = `/dashboard/entry?event=${encodeURIComponent(event.id)}`;
              }}
            >
              作品を提出
            </Button>
          </div>
        </header>

        {/* Metrics Grid */}
        {event.metrics && event.metrics.length > 0 && (
          <section
            aria-label="イベント統計"
            className="ed-metrics"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "var(--space-3, 12px)",
              marginTop: "var(--space-8, 32px)",
              padding: "var(--space-4, 16px)",
              background: "var(--surface-raised, #1f1f1f)",
            }}
          >
            {event.metrics.map((m, idx) => (
              <div key={idx} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "var(--text-h2-size, 24px)", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                  {m.value}
                </span>
                <span style={{ fontSize: "var(--text-label-size, 12px)", color: "var(--ink-muted, #999999)" }}>
                  {m.label}
                </span>
              </div>
            ))}
          </section>
        )}

        {/* Body Split */}
        <div
          className="ed-body"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 320px)",
            gap: "var(--space-8, 32px)",
            marginTop: "var(--space-8, 32px)",
            alignItems: "start",
          }}
        >
          {/* Main Column */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8, 32px)", minWidth: 0 }}>
            {/* About / Guidelines */}
            <section aria-labelledby="ed-about-heading" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3, 12px)" }}>
              <h2 id="ed-about-heading" style={{ margin: 0, fontSize: "var(--text-h2-size, 24px)", fontWeight: 700 }}>
                イベント概要
              </h2>
              {event.aboutText ? (
                <p style={{ margin: 0, fontSize: "var(--text-body-size, 15px)", lineHeight: "24px" }}>
                  {event.aboutText}
                </p>
              ) : (
                <p style={{ margin: 0, fontSize: "var(--text-body-size, 15px)", lineHeight: "24px", color: "var(--ink-muted, #999999)" }}>
                  概要はまだ登録されていません。
                </p>
              )}
              {event.guidelinesText && (
                <div style={{ marginTop: "var(--space-2, 8px)" }}>
                  <h3 style={{ margin: "0 0 8px 0", fontSize: "var(--text-h3-size, 18px)", fontWeight: 600 }}>
                    ガイドライン
                  </h3>
                  <p style={{ margin: 0, fontSize: "var(--text-body-size, 15px)", lineHeight: "24px" }}>
                    {event.guidelinesText}
                  </p>
                </div>
              )}
            </section>

            {/* Slots Section */}
            {event.slotDays && event.slotDays.length > 0 && (
              <section aria-labelledby="ed-slots-heading" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3, 12px)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h2 id="ed-slots-heading" style={{ margin: 0, fontSize: "var(--text-h2-size, 24px)", fontWeight: 700 }}>
                    上映枠
                  </h2>
                  <a
                    href={`/event/${encodeURIComponent(event.id)}/slots`}
                    style={{ color: "var(--brand, #d6ec8a)", textDecoration: "none", fontSize: "var(--text-ui-size, 14px)", fontWeight: 600 }}
                  >
                    枠表へ ↗
                  </a>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3, 12px)" }}>
                  {event.slotDays.map((sd, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: "var(--space-3, 12px)",
                        background: "var(--surface-raised, #1f1f1f)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-ui-size, 14px)" }}>
                        <span>{sd.label}</span>
                        <span style={{ color: "var(--ink-muted, #999999)", fontFamily: "var(--font-mono)" }}>
                          {sd.count}
                        </span>
                      </div>
                      <div
                        style={{
                          width: "100%",
                          height: "6px",
                          background: "var(--surface-active, #333333)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: sd.percentage,
                            height: "100%",
                            background: "var(--brand, #d6ec8a)",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Submitted Videos Grid */}
            <section aria-labelledby="ed-videos-heading" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3, 12px)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h2 id="ed-videos-heading" style={{ margin: 0, fontSize: "var(--text-h2-size, 24px)", fontWeight: 700 }}>
                  投稿作品{" "}
                  <span style={{ color: "var(--ink-muted, #999999)", fontSize: "16px", fontWeight: 400 }}>
                    {event.videos?.length ?? 0}
                  </span>
                </h2>
                <a
                  href={`/event/${encodeURIComponent(event.id)}/release`}
                  style={{ color: "var(--brand, #d6ec8a)", textDecoration: "none", fontSize: "var(--text-ui-size, 14px)", fontWeight: 600 }}
                >
                  投稿予定を見る ↗
                </a>
              </div>

              {event.videos && event.videos.length > 0 ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                    gap: "var(--space-4, 16px)",
                  }}
                >
                  {event.videos.map((v) => (
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
                          <img
                            src={v.thumbnailUrl}
                            alt=""
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
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
                          {v.creatorName}
                        </span>
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: "var(--text-ui-size, 14px)", color: "var(--ink-muted, #999999)" }}>
                  まだ公開された作品はありません。
                </p>
              )}
            </section>
          </div>

          {/* Aside Sidebar */}
          <aside
            aria-label="イベント日程"
            style={{
              padding: "var(--space-4, 16px)",
              background: "var(--surface-raised, #1f1f1f)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4, 16px)",
            }}
          >
            <h2 style={{ margin: 0, fontSize: "var(--text-h3-size, 18px)", fontWeight: 600 }}>
              日程
            </h2>
            {event.scheduleItems && event.scheduleItems.length > 0 ? (
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "100px 1fr", gap: "8px 12px", fontSize: "var(--text-ui-size, 14px)" }}>
                {event.scheduleItems.map((item, idx) => (
                  <React.Fragment key={idx}>
                    <dt style={{ color: "var(--ink-muted, #999999)" }}>{item.label}</dt>
                    <dd style={{ margin: 0, fontFamily: "var(--font-mono)" }}>{item.date}</dd>
                  </React.Fragment>
                ))}
              </dl>
            ) : (
              <p style={{ margin: 0, fontSize: "var(--text-ui-size, 14px)", color: "var(--ink-muted, #999999)" }}>
                日程詳細は登録されていません。
              </p>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
