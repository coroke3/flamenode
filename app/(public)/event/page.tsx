import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import styles from "./page.module.css";
import { desc } from "drizzle-orm";
import { withDatabase } from "@/lib/cloudflare";
import { events as eventsTable } from "@/lib/db/schema";
import { formatUnix } from "@/lib/utils/format";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  isAcceptingEntries,
} from "@/lib/utils/eventStatus";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "イベント" };
export const dynamic = "force-dynamic";

type EventRow = typeof eventsTable.$inferSelect;
type EventCategory = "open" | "upcoming" | "ended" | "archive";

const EVENT_SECTIONS: {
  id: EventCategory;
  title: string;
  sub: string;
}[] = [
  { id: "open", title: "募集中", sub: "Open for entry" },
  { id: "upcoming", title: "公開前", sub: "Upcoming" },
  { id: "ended", title: "開催済み", sub: "Past events" },
  { id: "archive", title: "アーカイブ", sub: "Always-on archive" },
];

function eventCategory(ev: EventRow): EventCategory {
  const status = computeEventStatus(ev);
  if (status === "archived") return "archive";
  if (status === "ended") return "ended";
  if (isAcceptingEntries(ev) || status === "active" || status === "published") {
    return "open";
  }
  return "upcoming";
}

function statusBadge(ev: EventRow): React.ReactElement {
  const status = computeEventStatus(ev);
  return (
    <span className={`fn-badge ${eventStatusBadgeClass(status)}`}>
      {eventStatusLabel(status)}
    </span>
  );
}

export default async function EventListPage(): Promise<React.ReactElement> {
  const events =
    (await withDatabase(async (db) => {
      return db.select().from(eventsTable).orderBy(desc(eventsTable.start_time));
    })) ?? [];

  return (
    <div className={`fn-public-container ${styles.page}`}>
      <header>
        <h1 className={styles.title}>イベント</h1>
        <p className={styles.lead}>
          FlameNode で開催される上映フェス・企画・募集イベントを、状態ごとに確認できます。
        </p>
      </header>

      {events.length === 0 ? (
        <div className="fn-empty fn-mt-lg">
          <Icon name="calendar" size={24} aria-hidden />
          <p className="fn-empty-message">
            表示できるイベントがまだありません。
          </p>
        </div>
      ) : (
        <div className={styles.sections}>
          {EVENT_SECTIONS.map((section) => {
            const items = events.filter((ev) => eventCategory(ev) === section.id);
            if (items.length === 0) return null;
            return (
              <section key={section.id} className={styles.eventSection}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitleGroup}>
                    <h2 className={styles.sectionTitle}>{section.title}</h2>
                    <span className={styles.sectionSub}>{section.sub}</span>
                  </div>
                  <span className={styles.sectionCount}>
                    {String(items.length).padStart(2, "0")}
                  </span>
                </div>
                <div className={styles.list}>
                  {items.map((ev) => {
                    const accentVar = ev.accent_color
                      ? ({
                          ["--event-accent" as never]: ev.accent_color,
                        } as React.CSSProperties)
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
                        >
                          <span className={styles.eventCode}>{ev.id}</span>
                        </div>
                        <div className={styles.eventBody}>
                          <div className={styles.eventMeta}>
                            {statusBadge(ev)}
                            <span>
                              {formatUnix(ev.start_time, { dateOnly: true })}
                              {ev.end_time
                                ? ` - ${formatUnix(ev.end_time, { dateOnly: true })}`
                                : ""}
                            </span>
                          </div>
                          <h3 className={styles.eventTitle}>{ev.title}</h3>
                          {ev.explanation ? (
                            <p className={styles.eventExplain}>{ev.explanation}</p>
                          ) : null}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
