import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { OpsFetch, OpsResult } from "../../api/read.js";
import { listSlots, normalizeSlotFilter, type ManageSlotsList } from "../../api/manageSlots.js";
import { SlotList, type SlotListOperation, type SlotListActionResult } from "./SlotList.js";
import { SlotBatchForm, type SlotGenerateRequest, type SlotMutationResult } from "./SlotBatchForm.js";

/** U02b only: explicit, all-or-nothing callback injection; no HTTP write client. */
export type SlotWriteActions = {
  onGenerate: (request: SlotGenerateRequest) => Promise<SlotMutationResult>;
  onClearAvailable: () => Promise<SlotMutationResult>;
  onAction: (operation: SlotListOperation) => Promise<SlotListActionResult>;
  canManageSubmittedSlots?: boolean;
};

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

/** U02b view composition. Without all three explicit handlers it is read-only. */
export function EventSlotsView({ eventId, status, data, writeActions, onChanged }: {
  eventId: string; status: string; data: ManageSlotsList;
  writeActions?: SlotWriteActions; onChanged?: () => void;
}): React.ReactElement {
  // Even dynamically assembled/partially configured callers must fail closed.
  const writes = writeActions &&
    typeof writeActions.onGenerate === "function" &&
    typeof writeActions.onClearAvailable === "function" &&
    typeof writeActions.onAction === "function" ? writeActions : null;
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
    {writes && <SlotBatchForm eventId={eventId} totalSlots={data.total}
      onGenerate={writes.onGenerate} onClearAvailable={writes.onClearAvailable}
      onChanged={onChanged} />}
    <section className="manage-section" aria-label="枠一覧">
      <h2 className="fn-console-eyebrow">{`枠一覧 (${data.slots.length})`}</h2>
      <SlotList eventId={eventId} slots={data.slots}
        partGapMinutes={data.event.slot_part_gap_minutes} parts={data.event.parts}
        onAction={writes?.onAction} onChanged={onChanged}
        canManageSubmittedSlots={Boolean(data.isAdmin && writes?.canManageSubmittedSlots)} />
      {data.atLimit && <p role="status">最大500件まで表示しています。条件を絞り込んでください。</p>}
      {data.total === 0 && !writes && <p>枠の追加機能は移行中です。</p>}
    </section>
  </div>;
}

type ReadContext = {
  eventId: string; status: string; fetchFn?: OpsFetch; refresh: number;
};
type TaggedResult = { context: ReadContext; result: OpsResult<ManageSlotsList> };

/** Intended to be mounted by MIG-0719's router owner after U02–U04 are complete. */
export function EventSlots({ eventId, fetchFn, writeActions }: {
  eventId: string; fetchFn?: OpsFetch; writeActions?: SlotWriteActions;
}): React.ReactElement {
  const [search] = useSearchParams();
  const status = normalizeSlotFilter(search.get("status"));
  const [request, setRequest] = React.useState<TaggedResult | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  // Tag every read with its exact UI generation. A refetch of the same
  // event/filter must not briefly reveal a previously authorized snapshot.
  // Object identity also prevents A -> B -> A from reviving cached rows.
  const contextRef = React.useRef<ReadContext>({ eventId, status, fetchFn, refresh });
  if (contextRef.current.eventId !== eventId || contextRef.current.status !== status ||
      contextRef.current.fetchFn !== fetchFn || contextRef.current.refresh !== refresh) {
    contextRef.current = { eventId, status, fetchFn, refresh };
  }
  React.useEffect(() => {
    const controller = new AbortController();
    const context = contextRef.current;
    setRequest(null);
    void listSlots(eventId, status, fetchFn, controller.signal).then(result => {
      if (!controller.signal.aborted && contextRef.current === context) {
        setRequest({ context, result });
      }
    });
    return () => controller.abort();
  }, [eventId, status, fetchFn, refresh]);

  const validRequest = request?.context === contextRef.current ? request.result : null;
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
  return <EventSlotsView eventId={eventId} status={status} data={validRequest.data}
    writeActions={writeActions} onChanged={() => setRefresh(v => v + 1)} />;
}
