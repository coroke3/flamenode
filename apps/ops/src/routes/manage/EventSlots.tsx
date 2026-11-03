import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { OpsFetch, OpsResult } from "../../api/read.js";
import { listSlots, normalizeSlotFilter, type ManageSlotsList } from "../../api/manageSlots.js";
import { SlotList } from "./SlotList.js";

const FILTERS = [
  ["all", "すべて"],
  ["available", "空き"],
  ["reserved", "確保済"],
  ["submitted", "提出済"],
] as const;

function countFor(data: ManageSlotsList, status: string): number {
  if (status === "all") return data.total;
  return Object.prototype.hasOwnProperty.call(data.counts, status)
    ? data.counts[status] ?? 0 : 0;
}

/** CURRENT /manage/events/:id/slots U02a. No write controls until MIG-0656. */
export function EventSlotsView({ eventId, status, data }: {
  eventId: string; status: string; data: ManageSlotsList;
}): React.ReactElement {
  const selected = normalizeSlotFilter(status);
  const url = "/manage/events/" + encodeURIComponent(eventId);
  return <div className="fn-public-container fn-page">
    <header className="fn-page-head">
      <h1 className="fn-display fn-page-title">{data.event.title} — 枠管理</h1>
      <p>{`枠管理 — 全${data.total}件中、最大500件を表示`}</p>
      <Link to={url}>イベント概要へ</Link>
    </header>
    <nav aria-label="枠の状態" className="manage-slot-stats">
      {FILTERS.map(([filter, label]) => (
        <Link key={filter} to={filter === "all" ? url + "/slots"
          : url + "/slots?status=" + filter}
          className="manage-slot-stat" aria-current={selected === filter ? "page" : undefined}>
          <span className="manage-slot-stat-label">{label}</span>
          <span className="manage-slot-stat-value">{countFor(data, filter)}</span>
        </Link>
      ))}
    </nav>
    <section className="manage-section" aria-label="枠一覧">
      <h2 className="fn-console-eyebrow">{`枠一覧 (${data.slots.length})`}</h2>
      <SlotList eventId={eventId} slots={data.slots}
        partGapMinutes={data.event.slot_part_gap_minutes} parts={data.event.parts} />
      {data.atLimit && <p role="status">最大500件まで表示しています。条件を絞り込んでください。</p>}
      {data.total === 0 && <p>上のフォームから枠を作成できます（作成機能は移行中）。</p>}
    </section>
  </div>;
}

type TaggedResult = { eventId: string; status: string; fetchFn?: OpsFetch;
  result: OpsResult<ManageSlotsList> };

/** Intended to be mounted by MIG-0719's router owner after U02–U04 are complete. */
export function EventSlots({ eventId, fetchFn }: {
  eventId: string; fetchFn?: OpsFetch;
}): React.ReactElement {
  const [search] = useSearchParams();
  const status = normalizeSlotFilter(search.get("status"));
  const [request, setRequest] = React.useState<TaggedResult | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    setRequest(null);
    void listSlots(eventId, status, fetchFn, controller.signal).then(result => {
      if (!controller.signal.aborted) setRequest({ eventId, status, fetchFn, result });
    });
    return () => controller.abort();
  }, [eventId, status, fetchFn, refresh]);

  const validRequest = request?.eventId === eventId && request.status === status &&
    request.fetchFn === fetchFn ? request.result : null;
  if (validRequest === null) return <p role="status" aria-busy="true">枠を読み込み中...</p>;
  if (validRequest.status === "anonymous") return <p role="alert">ログインが必要です。</p>;
  if (validRequest.status === "notFound" || validRequest.status === "forbidden") {
    return <p role="alert">イベントが見つからないか、枠を管理する権限がありません。</p>;
  }
  if (validRequest.status !== "ok") return <div role="alert">
    <p>枠一覧を取得できませんでした。権限と通信状態を確認してください。</p>
    <button type="button" className="fn-btn fn-btn-ghost"
      onClick={() => setRefresh(v => v + 1)}>再読み込み</button>
  </div>;
  return <EventSlotsView eventId={eventId} status={status} data={validRequest.data} />;
}
