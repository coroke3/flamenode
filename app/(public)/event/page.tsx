import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import styles from "./page.module.css";
import { desc } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { events as eventsTable } from "@/lib/db/schema";
import { formatUnix } from "@/lib/utils/format";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "イベント" };
export const dynamic = "force-dynamic";

type EventRow = typeof eventsTable.$inferSelect;

function statusBadge(ev: EventRow): React.ReactElement | null {
  if (ev.is_active === 1) {
    return <span className="fn-badge fn-badge-accent">開催中</span>;
  }
  if (ev.is_archived === 1) {
    return <span className="fn-badge fn-badge-neutral">アーカイブ</span>;
  }
  if (ev.start_time && ev.start_time * 1000 > Date.now()) {
    return <span className="fn-badge fn-badge-warning">募集前</span>;
  }
  return null;
}

export default async function EventListPage(): Promise<React.ReactElement> {
  const db = getDatabase();
  let events: EventRow[] = [];
  if (db) {
    try {
      events = await db
        .select()
        .from(eventsTable)
        .orderBy(desc(eventsTable.start_time));
    } catch (e) {
      console.error("[EventListPage] fetch failed", e);
    }
  }

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>イベント</h1>
        <p className={styles.lead}>
          FlameNode で開催された企画と、第三者主催の参加可能なイベントを時系列で並べます。
        </p>
      </header>

      {events.length === 0 ? (
        <div className="fn-empty fn-mt-lg">
          <Icon name="calendar" size={24} aria-hidden />
          <p className="fn-empty-message">
            まだ表示できるイベントがありません。
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {events.map((ev) => {
            const accentVar = ev.accent_color
              ? ({ ["--event-accent" as never]: ev.accent_color } as React.CSSProperties)
              : undefined;
            return (
              <Link
                key={ev.id}
                href={`/event/${ev.id}`}
                className={styles.eventCard}
                style={accentVar}
              >
                <div
                  className={styles.eventBanner}
                  style={
                    ev.img_url
                      ? { backgroundImage: `url(${ev.img_url})` }
                      : undefined
                  }
                />
                <div className={styles.eventBody}>
                  <div className={styles.eventMeta}>
                    {statusBadge(ev)}
                    <span>
                      {formatUnix(ev.start_time, { dateOnly: true })}
                      {ev.end_time
                        ? ` 〜 ${formatUnix(ev.end_time, { dateOnly: true })}`
                        : ""}
                    </span>
                  </div>
                  <h2 className={styles.eventTitle}>{ev.title}</h2>
                  {ev.explanation ? (
                    <p className={styles.eventExplain}>{ev.explanation}</p>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
