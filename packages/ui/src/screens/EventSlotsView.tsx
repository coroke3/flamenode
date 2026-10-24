import React from "react";
import { Link } from "../adapters/index.js";
import { Badge, type BadgeStatus } from "../components/Badge.js";
import { cx } from "../cx.js";
import { ScreenIcon } from "./parts.js";

/*
 * Event slots (`/event/[id]/slots`) from the registered mock `docs/migration/mock/static/EventSlots.html`
 * (classes `parts`, `part`, `srow2`, `sl`, `plabel`, `pgap`; styles in `styles/events.css`). Header texts follow
 * CURRENT `app/(public)/event/[id]/slots/page.tsx`. Display only: the slot state (`state`, `name`, the stats)
 * is supplied by the live read in the Island, never by the static HTML. Reserving / releasing a slot needs the
 * viewer overlay and the reservation Server Actions (MIG-0604 / MIG-0606), so there are no buttons here: a
 * control that does nothing would be worse than none.
 */

export type SlotCellState = "pending" | "open" | "taken" | "unknown";

export type SlotsBlock =
  | { kind: "part"; label: string }
  | { kind: "gap"; range: string }
  | { kind: "slot"; id: string; time: string; state: SlotCellState; name?: string | null };

export interface SlotsDay {
  key: string;
  /** e.g. `11/03(火)`. */
  label: string;
  /** e.g. `16 / 29`; null until the live read is in. */
  filled: string | null;
  blocks: readonly SlotsBlock[];
}

export interface EventSlotsViewModel {
  eventId: string;
  title: string;
  statusLabel: string;
  statusTone: BadgeStatus;
  /** CURRENT: 受付中 / 募集開始前 / 募集終了 or null. */
  entryBadge: { label: string; tone: BadgeStatus } | null;
  /** CURRENT `募集: … - …` or null. */
  periodLabel: string | null;
  /** loading = live read not finished, ready = shown, unavailable = the read failed (T05). */
  live: "loading" | "ready" | "unavailable";
  stats: { filled: number; total: number; ratio: number } | null;
  days: readonly SlotsDay[];
}

export interface EventSlotsViewProps {
  model: EventSlotsViewModel;
  className?: string;
}

const CELL_LABEL: Record<SlotCellState, string> = {
  pending: "読み込み中",
  open: "空き",
  taken: "確保済み",
  unknown: "–",
};

function Cell({ block }: { block: Extract<SlotsBlock, { kind: "slot" }> }): React.ReactElement {
  const name = block.state === "taken" ? block.name?.trim() || CELL_LABEL.taken : CELL_LABEL[block.state];
  return (
    <div className="srow2">
      <span className="tm">{block.time}</span>
      <div
        className={cx("sl", block.state === "taken" && "taken", block.state === "open" && "open", block.state === "pending" && "pending")}
        aria-label={`${block.time} ${name}`}
      >
        <span className="nm">{name}</span>
      </div>
    </div>
  );
}

export function EventSlotsView({ model, className }: EventSlotsViewProps): React.ReactElement {
  const { stats } = model;
  return (
    <div className={cx("p-root fn-screen", className)}>
      <main className="wrap ev-scope ev-slots">
        <Link href={`/event/${model.eventId}`} className="il t-sm muted">
          <ScreenIcon name="arrowLeft" />
          イベント詳細へ
        </Link>
        <div className="wrap-row ev-slots-head">
          <div className="meta-i ev-slots-meta">
            <Badge status={model.statusTone} label={model.statusLabel} />
            {model.entryBadge ? <Badge status={model.entryBadge.tone} label={model.entryBadge.label} /> : null}
            {model.periodLabel ? <span className="t-num">{model.periodLabel}</span> : null}
          </div>
        </div>
        <h1 className="t-display ev-slots-title">{model.title} の枠確保</h1>
        <div className="ev-slots-stats" aria-label="枠の状態">
          <strong className="t-num">
            {stats ? stats.filled : "–"}
            <small>/{stats ? stats.total : "–"}</small>
          </strong>
          <span>埋まり枠</span>
          {stats ? <em>{stats.ratio}% 埋まり</em> : null}
        </div>
        {model.live === "unavailable" ? (
          <div className="notice ev-slots-notice" role="status">
            <span className="t-sm">枠の最新状況を取得できませんでした。時間をおいて再読み込みしてください。</span>
          </div>
        ) : null}

        <div className="wrap-row t-sm muted ev-slots-legend" aria-label="枠の凡例">
          <span className="il">空き</span>
          <span className="il">確保済み</span>
        </div>
        <div className="parts" role="region" aria-label="枠の状態">
          {model.days.map((day) => (
            <section key={day.key} className="part">
              <header>
                <span className="t-num">{day.label}</span>
                <span className="t-sm muted t-num">{day.filled ?? "–"}</span>
              </header>
              {day.blocks.map((block, i) =>
                block.kind === "part" ? (
                  <div key={`p${i}`} className="plabel">
                    {block.label}
                  </div>
                ) : block.kind === "gap" ? (
                  <div key={`g${i}`} className="pgap">
                    <span>
                      休憩 <span className="t-num">{block.range}</span>
                    </span>
                  </div>
                ) : (
                  <Cell key={block.id} block={block} />
                ),
              )}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
