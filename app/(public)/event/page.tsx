import * as React from "react";
import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { withDatabase } from "@/lib/cloudflare";
import { events as eventsTable } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import {
  PublicEventCard,
  type PublicEventCategory,
} from "@/components/event/PublicEventCard";
import { categorizePublicEvent } from "@/lib/utils/categorizePublicEvent";
import { compareEventsByUpcomingPriority } from "@/lib/utils/eventOrdering";

export const metadata: Metadata = { title: "イベント" };
export const dynamic = "force-dynamic";

type EventRow = typeof eventsTable.$inferSelect;

const EVENT_SECTIONS: {
  id: PublicEventCategory;
  title: string;
  sub: string;
}[] = [
  { id: "open", title: "募集中", sub: "Open for entry" },
  { id: "upcoming", title: "開催前", sub: "Upcoming" },
  { id: "ended", title: "開催済み", sub: "Past events" },
  { id: "archive", title: "アーカイブ", sub: "Always-on archive" },
];

export default async function EventListPage(): Promise<React.ReactElement> {
  const events =
    (await withDatabase(async (db) => {
      return db.select().from(eventsTable).orderBy(desc(eventsTable.start_time));
    })) ?? [];
  const sortedEvents = events.sort(compareEventsByUpcomingPriority);

  // 点イベント（投稿期間が片側のみ）はカード一覧から除外
  const isPointEvent = (ev: EventRow) =>
    (ev.start_time != null) !== (ev.end_time != null);

  const filteredEvents = sortedEvents.filter((ev) => !isPointEvent(ev));

  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head fn-evlist-head">
        <span className="fn-eyebrow">events - {filteredEvents.length} total</span>
        <h1 className="fn-display fn-evlist-title">イベント</h1>
        <p className="fn-jp fn-evlist-sub">
          FlameNode で開催される上映フェス・企画・募集イベントを状態ごとに確認できます。
        </p>
      </header>

      {filteredEvents.length === 0 ? (
        <div className="fn-empty fn-mt-lg">
          <Icon name="calendar" size={24} aria-hidden />
          <p className="fn-empty-message">
            表示できるイベントがまだありません。
          </p>
        </div>
      ) : (
        <>
          {EVENT_SECTIONS.map((section) => {
            const items = filteredEvents.filter(
              (ev) => categorizePublicEvent(ev) === section.id,
            );
            if (items.length === 0) return null;
            return (
              <section key={section.id} className="fn-evlist-section">
                <div className="fn-section-head">
                  <h2 className="fn-display fn-section-title">{section.title}</h2>
                  <span className="fn-mono fn-evlist-count">
                    {String(items.length).padStart(2, "0")}
                  </span>
                </div>
                <div className="fn-evlist-grid">
                  {items.map((ev) => (
                    <PublicEventCard
                      key={ev.id}
                      event={ev}
                      category={section.id}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
