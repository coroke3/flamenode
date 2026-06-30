import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import styles from "./page.module.css";
import { withDatabase } from "@/lib/cloudflare";
import {
  fetchPublicEventGroupBySlug,
  fetchPublicEventsForGroup,
  type PublicEventGroupDetail,
  type PublicGroupEvent,
} from "@/lib/db/eventGroups";
import { fetchPublicVideos } from "@/lib/db/listQueries";
import { readStaticJson } from "@/lib/publicData/staticJson";
import { Shelf } from "@/components/layout/Shelf";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import {
  computeEventStatus,
  eventStatusLabel,
  isAcceptingEntries,
} from "@/lib/utils/eventStatus";
import { formatUnix } from "@/lib/utils/format";
import { Icon } from "@/components/ui/Icon";

export const dynamic = "force-dynamic";

const GROUP_TYPE_LABELS: Record<string, string> = {
  series: "系列",
  genre: "ジャンル",
  related: "関連",
  collection: "コレクション",
  other: "その他",
};

type StaticGroupPayload = {
  group: PublicEventGroupDetail;
  events: PublicGroupEvent[];
};

function formatEventRange(
  start: number | null,
  end: number | null,
): string {
  const startText = formatUnix(start, { dateOnly: true });
  const endText = formatUnix(end, { dateOnly: true });
  if (startText && endText) return `${startText} 〜 ${endText}`;
  return startText || endText || "";
}

async function fetchTopVideosByEvent(
  eventIds: readonly string[],
): Promise<Record<string, VideoCardData[]>> {
  if (eventIds.length === 0) return {};

  const result = await withDatabase(async (db) => {
    const entries = await Promise.all(
      eventIds.map(async (eventId) => {
        const videos = await fetchPublicVideos(db, {
          eventId,
          sort: "score",
          limit: 10,
        });
        return [eventId, videos] as const;
      }),
    );
    return Object.fromEntries(entries);
  });
  return result ?? {};
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const staticPayload = await readStaticJson<StaticGroupPayload>(
    `groups/${slug}.json`,
  );
  const group =
    staticPayload?.group ??
    (await withDatabase(async (db) => {
      return fetchPublicEventGroupBySlug(db, slug);
    }));
  if (!group) return { title: "グループが見つかりません" };
  return {
    title: group.name,
    description: group.description ?? undefined,
    openGraph: {
      title: group.name,
      description: group.description ?? undefined,
      images: group.img_url ? [group.img_url] : undefined,
    },
  };
}

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;

  const staticPayload = await readStaticJson<StaticGroupPayload>(
    `groups/${slug}.json`,
  );
  const group =
    staticPayload?.group ??
    (await withDatabase(async (db) => {
      return fetchPublicEventGroupBySlug(db, slug);
    }));

  if (!group) notFound();

  const groupEvents =
    (await withDatabase(async (db) => {
      return fetchPublicEventsForGroup(db, group.id);
    })) ??
    staticPayload?.events ??
    [];

  const topVideosByEvent = await fetchTopVideosByEvent(
    groupEvents.map((event) => event.id),
  );

  const now = Math.floor(Date.now() / 1000);

  return (
    <div className={`fn-public-container fn-page ${styles.page}`}>
      <header className="fn-page-head">
        <p className="fn-eyebrow">
          <Link href="/groups" style={{ color: "inherit", textDecoration: "none" }}>
            グループ
          </Link>
          {" › "}
          {GROUP_TYPE_LABELS[group.group_type] ?? group.group_type}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {group.icon_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={group.icon_url}
              alt=""
              style={{ width: 40, height: 40, borderRadius: "50%" }}
            />
          ) : null}
          <h1 className="fn-page-title">{group.name}</h1>
        </div>
        {group.description ? (
          <p className="fn-page-lead">{group.description}</p>
        ) : null}
      </header>

      <section style={{ marginTop: 24 }}>
        <h2 className={styles.sectionTitle}>
          所属イベント ({groupEvents.length}件)
        </h2>
        {groupEvents.length === 0 ? (
          <p className="fn-muted" style={{ padding: "24px 0", textAlign: "center" }}>
            このグループの公開イベントはまだありません。
          </p>
        ) : (
          <div className={styles.eventList}>
            {groupEvents.map((ev) => {
              const statusInput = {
                ...ev,
                is_active: ev.is_active ?? 1,
                is_archived: ev.is_archived ?? 0,
              };
              const status = computeEventStatus(statusInput, now);
              const accepting = isAcceptingEntries(statusInput, now);
              const topVideos = topVideosByEvent[ev.id] ?? [];
              const dateRange = formatEventRange(ev.start_time, ev.end_time);

              return (
                <article
                  key={ev.id}
                  className={styles.eventBlock}
                  style={
                    ev.accent_color
                      ? ({ ["--event-accent" as string]: ev.accent_color } as React.CSSProperties)
                      : undefined
                  }
                >
                  <header className={styles.eventHead}>
                    <div className={styles.eventMeta}>
                      {ev.icon_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={ev.icon_url}
                          alt=""
                          style={{ width: 22, height: 22, borderRadius: "50%" }}
                        />
                      ) : null}
                      <span className="fn-badge" style={{ fontSize: 10, padding: "2px 6px" }}>
                        {ev.event_type ?? "event"}
                      </span>
                      <span className="fn-pill" data-tone={accepting ? "accent" : "muted"}>
                        {accepting ? "エントリー受付中" : eventStatusLabel(status)}
                      </span>
                    </div>

                    <div className={styles.eventTitleRow}>
                      <h3 className={styles.eventTitle}>
                        <Link href={`/event/${ev.id}`}>{ev.title}</Link>
                      </h3>
                      <div className={styles.eventActions}>
                        {dateRange ? (
                          <p className={styles.eventDates}>{dateRange}</p>
                        ) : null}
                        <Link href={`/event/${ev.id}`} className={styles.eventLink}>
                          イベント詳細
                          <Icon name="chevron-right" size={14} aria-hidden />
                        </Link>
                      </div>
                    </div>

                    {ev.explanation ? (
                      <p className={styles.eventExplanation}>{ev.explanation}</p>
                    ) : null}
                  </header>

                  {topVideos.length > 0 ? (
                    <div className={styles.shelfBox}>
                      <Shelf ariaLabel={`${ev.title}のスコア上位作品`}>
                        {topVideos.map((video, index) => (
                          <VideoCard
                            key={`${ev.id}-${video.id}-${index}`}
                            video={video}
                          />
                        ))}
                      </Shelf>
                    </div>
                  ) : (
                    <p className={styles.emptyVideos}>公開作品はまだありません。</p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
