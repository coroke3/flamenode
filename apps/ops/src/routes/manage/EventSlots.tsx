import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { OpsFetch, OpsResult } from "../../api/read.js";
import { listSlots, normalizeSlotFilter, type ManageSlotsList } from "../../api/manageSlots.js";
import { SlotList, type SlotListOperation, type SlotListActionResult } from "./SlotList.js";
import { SlotBatchForm, slotBatchSuccessMessage, type SlotGenerateRequest, type SlotMutationResult } from "./SlotBatchForm.js";

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
export function EventSlotsView({ eventId, status, data, writeActions, onChanged, onClearFailure,
  writeBlocked = false, canStartWrite }: {
  eventId: string; status: string; data: ManageSlotsList;
  writeActions?: SlotWriteActions; onChanged?: (failure?: string) => void;
  onClearFailure?: () => void;
  writeBlocked?: boolean;
  canStartWrite?: () => boolean;
}): React.ReactElement {
  // Even dynamically assembled/partially configured callers must fail closed.
  const writes = writeActions &&
    typeof writeActions.onGenerate === "function" &&
    typeof writeActions.onClearAvailable === "function" &&
    typeof writeActions.onAction === "function" ? writeActions : null;
  // CURRENT permits global admins AND event.slots staff to use submitted-slot
  // operations. Authorized GET grants event access; every future Hono write
  // still requires independent server-side authorization and audit.
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
      onChanged={onChanged} writeBlocked={writeBlocked} canStartWrite={canStartWrite} />}
    <section className="manage-section" aria-label="枠一覧">
      <h2 className="fn-console-eyebrow">{`枠一覧 (${data.slots.length})`}</h2>
      <SlotList eventId={eventId} slots={data.slots}
        partGapMinutes={data.event.slot_part_gap_minutes} parts={data.event.parts}
        onAction={writes?.onAction} onChanged={onChanged} onClearFailure={onClearFailure}
        writeBlocked={writeBlocked} canStartWrite={canStartWrite}
        canManageSubmittedSlots={Boolean(writes?.canManageSubmittedSlots)} />
      {data.total === 0 && !writes && <p>枠の追加機能は移行中です。</p>}
    </section>
  </div>;
}

type ReadContext = {
  eventId: string; status: string; fetchFn?: OpsFetch; refresh: number;
};
type TaggedResult = { context: ReadContext; result: OpsResult<ManageSlotsList> };
type MutationReceipt = { kind: "success" | "failure"; message: string; pendingPublicReflection?: boolean };

/** Intended to be mounted by MIG-0719's router owner after U02–U04 are complete. */
export function EventSlots({ eventId, fetchFn, writeActions }: {
  eventId: string; fetchFn?: OpsFetch; writeActions?: SlotWriteActions;
}): React.ReactElement {
  const [search] = useSearchParams();
  const status = normalizeSlotFilter(search.get("status"));
  const [request, setRequest] = React.useState<TaggedResult | null>(null);
  const { onGenerate, onClearAvailable, onAction, canManageSubmittedSlots } = writeActions ?? {};
  // Keep the current mutation receipt across a fresh authorized read, not across
  // navigation, adapter replacement or capability changes (including A-B-A).
  const feedbackScope = React.useMemo(() => ({
    eventId, status, fetchFn, onGenerate, onClearAvailable, onAction, canManageSubmittedSlots,
  }), [eventId, status, fetchFn, onGenerate, onClearAvailable, onAction, canManageSubmittedSlots]);
  const [reload, setReload] = React.useState<{
    key: number; receipt: { scope: typeof feedbackScope; value: MutationReceipt } | null;
  }>({ key: 0, receipt: null });
  const refresh = reload.key;
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

  const readContext = contextRef.current;
  const validRequest = request?.context === readContext ? request.result : null;

  // One mounted view owns its in-flight receipts. A previous view may still
  // commit a write, but can only invalidate a current read of the same event.
  // Wait for current-view writes to settle before tearing down their controls.
  const writeView = React.useMemo(() => ({
    eventId, feedbackScope, pending: 0, refreshNeeded: false, refreshScheduled: false,
    receipt: undefined as MutationReceipt | undefined, canInvalidate: false, authorized: false,
  }), [eventId, feedbackScope, readContext]);
  const committedWriteView = React.useRef<typeof writeView | null>(null);
  const [busyView, setBusyView] = React.useState<typeof writeView | null>(null);
  React.useLayoutEffect(() => {
    committedWriteView.current = writeView;
    return () => {
      if (committedWriteView.current === writeView) committedWriteView.current = null;
    };
  }, [writeView]);
  React.useLayoutEffect(() => {
    writeView.canInvalidate = validRequest === null || validRequest.status === "ok";
    writeView.authorized = validRequest?.status === "ok";
  }, [writeView, validRequest]);

  // Serialize the two operation families within the same committed snapshot.
  // A synchronous guard is necessary even before disabled props commit.
  // Rotation to another read/adapter generation does not inherit this lock.
  const canStartWrite = React.useCallback(() =>
    committedWriteView.current === writeView && writeView.authorized &&
    writeView.pending === 0 && !writeView.refreshNeeded && !writeView.refreshScheduled,
  [writeView]);

  const trackedWrites = React.useMemo<SlotWriteActions | undefined>(() => {
    if (typeof onGenerate !== "function" || typeof onClearAvailable !== "function" ||
        typeof onAction !== "function") return undefined;
    const flush = (view: typeof writeView) => {
      if (committedWriteView.current !== view || !view.canInvalidate ||
          view.pending !== 0 || !view.refreshNeeded || view.refreshScheduled) return;
      const receipt = view.receipt;
      view.refreshNeeded = false;
      // Do not admit another write in the interval between scheduling a
      // refresh and committing the replacement read context.
      view.refreshScheduled = true;
      view.receipt = undefined;
      setBusyView(view);
      setReload(previous => ({
        key: previous.key + 1,
        receipt: receipt === undefined ? previous.receipt :
          { scope: view.feedbackScope, value: receipt },
      }));
    };
    const track = async <T extends {
      ok: boolean; message?: string; created?: number; pendingPublicReflection?: boolean;
    },>(
      action: () => Promise<T>, refreshOnFailure: boolean,
      success: (result: T) => string,
    ): Promise<T> => {
      if (!canStartWrite()) throw new Error("Slot write view is unavailable or busy");
      writeView.pending++;
      setBusyView(writeView);
      writeView.receipt = undefined;
      // A new explicit mutation clears the previously rendered receipt for
      // both forms and list operations; never resurrect it on a retry.
      setReload(previous => previous.receipt === null ? previous : { ...previous, receipt: null });
      try {
        const result = await action();
        const refreshNeeded = result.ok || refreshOnFailure;
        const current = committedWriteView.current;
        if (current === writeView) {
          writeView.refreshNeeded ||= refreshNeeded;
          writeView.receipt = result.ok
            ? { kind: "success", message: result.message ?? success(result),
                pendingPublicReflection: result.pendingPublicReflection }
            : { kind: "failure", message: result.message ??
                (refreshOnFailure ? "枠の操作に失敗しました。" : "枠操作に失敗しました。") };
        } else if (refreshNeeded && current?.eventId === writeView.eventId) {
          // Do not publish an obsolete result message or reuse an old port.
          current.refreshNeeded = true;
          flush(current);
        }
        return result;
      } catch (error) {
        if (committedWriteView.current === writeView) {
          writeView.receipt = { kind: "failure", message: "枠操作中に通信エラーが発生しました。" };
        }
        throw error;
      } finally {
        writeView.pending--;
        flush(writeView);
        if (committedWriteView.current === writeView && !writeView.refreshScheduled) {
          setBusyView(previous => previous === writeView ? null : previous);
        }
      }
    };
    return {
      onGenerate: request => track(() => onGenerate(request), false,
        result => slotBatchSuccessMessage(result, "generate")),
      onClearAvailable: () => track(onClearAvailable, false,
        result => slotBatchSuccessMessage(result, "clear")),
      onAction: operation => track(() => onAction(operation), true,
        () => "枠を更新しました。"),
      canManageSubmittedSlots,
    };
  }, [writeView, canStartWrite, onGenerate, onClearAvailable, onAction, canManageSubmittedSlots]);

  if (validRequest === null) return <p role="status" aria-busy="true">枠を読み込み中...</p>;
  if (validRequest.status === "anonymous") return <p role="alert">ログインが必要です。</p>;
  if (validRequest.status === "notFound" || validRequest.status === "forbidden") {
    return <p role="alert">イベントが見つからないか、枠を管理する権限がありません。</p>;
  }
  if (validRequest.status !== "ok") return <div role="alert">
    <p>枠一覧を取得できませんでした。権限と通信状態を確認してください。</p>
    <button type="button" className="fn-btn fn-btn-ghost"
      onClick={() => setReload(previous => ({ key: previous.key + 1, receipt: null }))}>再読み込み</button>
  </div>;
  // A denied, failed or still-pending GET never renders a mutation receipt
  // or the previous private rows. Only the newly authorized snapshot can.
  const receipt = reload.receipt?.scope === feedbackScope ? reload.receipt.value : null;
  return <>
    {receipt?.kind === "failure" && <p role="alert" className="fn-alert fn-alert--danger">{receipt.message}</p>}
    {receipt?.kind === "success" && <p role="status" className="fn-console-note">
      {receipt.message}{receipt.pendingPublicReflection ? " 公開画面への反映は処理中です。" : ""}
    </p>}
    <EventSlotsView eventId={eventId} status={status} data={validRequest.data}
      writeActions={trackedWrites} writeBlocked={busyView === writeView} canStartWrite={canStartWrite} />
  </>;
}
