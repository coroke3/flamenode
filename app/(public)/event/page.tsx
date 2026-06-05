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

export const metadata: Metadata = { title: "イベント" };
export const dynamic = "force-dynamic";

type EventRow = typeof eventsTable.$inferSelect;

const EVENT_SECTIONS: {
  id: PublicEventCategory;
  title: string;
  sub: string;
}[] = [
  { id: "open", title: "募集中", sub: "Open for entry" },
  { id: "upcoming", title: "公開前", sub: "Upcoming" },
  { id: "ended", title: "開催済み", sub: "Past events" },
  { id: "archive", title: "アーカイブ", sub: "Always-on archive" },
];

export default async function EventListPage(): Promise<React.ReactElement> {
  const events =
    (await withDatabase(async (db) => {
      return db.select().from(eventsTable).orderBy(desc(eventsTable.start_time));
    })) ?? [];

  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head fn-evlist-head">
        <span className="fn-eyebrow">events — {events.length} total</span>
        <h1 className="fn-display fn-evlist-title">イベント</h1>
        <p className="fn-jp fn-evlist-sub">
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
        <>
          {EVENT_SECTIONS.map((section) => {
            const items = events.filter(
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
