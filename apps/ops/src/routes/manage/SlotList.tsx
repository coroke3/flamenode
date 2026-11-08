import * as React from "react";
import { Link } from "react-router-dom";
import type { ManageSlotRow } from "@flamenode/contracts";
import { partLabels } from "./slotParts.js";

const STATUS_LABELS = Object.freeze({
  available: "空き",
  reserved: "確保済",
  submitted: "提出済",
});
const TOKYO_TIME = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function slotStatusLabel(value: string): string {
  return Object.prototype.hasOwnProperty.call(STATUS_LABELS, value)
    ? STATUS_LABELS[value as keyof typeof STATUS_LABELS] : "不明";
}
export function slotTimeLabel(row: ManageSlotRow): string {
  const fallback = row.slot_label ?? "—";
  if (row.start_time === null || !Number.isFinite(row.start_time)) return fallback;
  // Zod's numeric wire schema does not bound database timestamps. Even a
  // finite seconds value may overflow Date's TimeClip range and throw in
  // Intl.DateTimeFormat, taking down the entire management screen.
  const date = new Date(row.start_time * 1000);
  return Number.isFinite(date.getTime()) ? TOKYO_TIME.format(date) : fallback;
}

/**
 * U02b contracts, deliberately independent of any unimplemented Hono route.
 * Required server-side permission, CAS, group integrity and audit belong to
 * MIG-0656. This client-side planner only prevents invalid UI operations.
 */
export type SlotListOperation =
  | { kind: "delete" | "release" | "force-release-submitted" | "release-submitted-video"; slotId: string }
  | { kind: "batch-delete" | "batch-release"; slotIds: string[] }
  | { kind: "batch-label"; slotIds: string[]; label: string };

export type SlotListActionResult = {
  ok: boolean;
  message?: string;
  pendingPublicReflection?: boolean;
};

const MAX_ATOMIC_SELECTION = 3;

export function validateSlotListOperation(
  slots: readonly ManageSlotRow[],
  eventId: string,
  operation: SlotListOperation,
  canManageSubmittedSlots = false,
): boolean {
  // Only rows from the currently visible authorized event may be acted on.
  const byId = new Map<string, ManageSlotRow>(
    slots.filter(row => row.event_id === eventId).map(row => [row.id, row]),
  );
  if ("slotId" in operation) {
    const slot = byId.get(operation.slotId);
    if (!slot) return false;
    if (operation.kind === "delete") return slot.status === "available";
    if (operation.kind === "release") return slot.status === "reserved";
    if (operation.kind === "force-release-submitted" ||
        operation.kind === "release-submitted-video") {
      return canManageSubmittedSlots && slot.status === "submitted";
    }
    return false;
  }
  if (operation.slotIds.length < 1 || operation.slotIds.length > MAX_ATOMIC_SELECTION ||
      new Set(operation.slotIds).size !== operation.slotIds.length) return false;
  const selected = operation.slotIds.map(id => byId.get(id));
  if (selected.some(row => !row)) return false;
  if (operation.kind === "batch-delete") return selected.every(row => row?.status === "available");
  if (operation.kind === "batch-release") return selected.every(row => row?.status === "reserved");
  // Explicitly narrow the operation variant: unknown future action kinds
  // must not be mistaken for a label update or crash at runtime.
  if (operation.kind !== "batch-label") return false;
  return operation.label.trim().length >= 1 && operation.label.trim().length <= 200;
}

/**
 * CURRENT read-only table remains the default until MIG-0656 supplies
 * authorized writes. Supplying onAction explicitly enables U02b controls.
 */
export function SlotList({ eventId, slots, partGapMinutes, parts, onAction,
  onChanged, canManageSubmittedSlots = false }: {
  eventId: string; slots: readonly ManageSlotRow[];
  partGapMinutes: number | null; parts: readonly string[];
  onAction?: (operation: SlotListOperation) => Promise<SlotListActionResult>;
  onChanged?: () => void;
  canManageSubmittedSlots?: boolean;
}): React.ReactElement {
  const labels = React.useMemo(() => partLabels(slots, partGapMinutes, parts), [
    slots, partGapMinutes, parts,
  ]);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [label, setLabel] = React.useState("");
  const [pending, setPending] = React.useState<SlotListOperation | null>(null);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  // A filter/event refresh invalidates both the previous row selection and
  // any pending destructive confirmation. Old row IDs must not resurface
  // when the user returns to a previously selected status filter.
  React.useEffect(() => {
    setSelected(new Set());
    setPending(null);
    setLabel("");
    setError(null);
    setNotice(null);
  }, [eventId, slots]);
  const visibleIds = slots.filter(row => row.event_id === eventId).map(row => row.id);
  const visibleSelected = visibleIds.filter(id => selected.has(id));
  const selectedAvailable = slots.filter(row => selected.has(row.id) &&
    row.event_id === eventId && row.status === "available").map(row => row.id);
  const selectedReserved = slots.filter(row => selected.has(row.id) &&
    row.event_id === eventId && row.status === "reserved").map(row => row.id);
  const limited = visibleSelected.length > MAX_ATOMIC_SELECTION;
  const displayLabel = label.trim();
  const confirm = (op: SlotListOperation) => {
    if (!validateSlotListOperation(slots, eventId, op, canManageSubmittedSlots)) {
      setError("選択した枠の状態または件数を確認してください。");
      return;
    }
    setError(null);
    setNotice(null);
    setPending(op);
  };
  const runConfirmed = async () => {
    if (busyRef.current || !pending || !onAction) return;
    // Between confirmation and execution, the view may have changed.
    if (!validateSlotListOperation(slots, eventId, pending, canManageSubmittedSlots)) {
      setPending(null);
      setError("枠の状態が変わりました。再読み込みしてください。");
      return;
    }
    const operation = pending;
    busyRef.current = true;
    setBusy(true);
    setPending(null);
    setError(null);
    setNotice(null);
    try {
      const result = await onAction(operation);
      if (!result.ok) setError(result.message ?? "枠の操作に失敗しました。");
      else {
        setSelected(new Set());
        setNotice((result.message ?? "枠を更新しました。") +
          (result.pendingPublicReflection ? " 公開画面への反映は処理中です。" : ""));
        onChanged?.();
      }
    } catch {
      setError("枠操作中に通信エラーが発生しました。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  if (slots.length === 0) return <p className="fn-muted fn-text-sm">枠はまだありません。</p>;
  return <div className="manage-slot-list">
    {error && <p role="alert" className="fn-alert fn-alert--danger">{error}</p>}
    {notice && <p role="status" className="fn-console-note">{notice}</p>}
    {!onAction && <p className="fn-console-note" role="status">
      枠の状態と取得者を表示しています。編集・削除機能は移行中です。
    </p>}
    {onAction && visibleSelected.length > 0 && <div className="manage-slot-action-bar"
      role="group" aria-label="選択した枠の一括操作">
      <span>{visibleSelected.length}件選択中</span>
      {limited && <p role="status">一括操作は最大3件ずつ選択してください。</p>}
      {selectedAvailable.length > 0 && <button type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        disabled={busy || limited || selectedAvailable.length > MAX_ATOMIC_SELECTION}
        onClick={() => confirm({ kind: "batch-delete", slotIds: selectedAvailable })}>
        空き枠を削除 ({selectedAvailable.length})
      </button>}
      {selectedReserved.length > 0 && <button type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        disabled={busy || limited || selectedReserved.length > MAX_ATOMIC_SELECTION}
        onClick={() => confirm({ kind: "batch-release", slotIds: selectedReserved })}>
        予約枠を解放 ({selectedReserved.length})
      </button>}
      <label>一括ラベル
        <input className="fn-input manage-slot-batch-label" value={label}
          onChange={event => setLabel(event.target.value)}
          maxLength={200} disabled={busy} />
      </label>
      <button type="button" className="fn-btn fn-btn-primary fn-btn-sm"
        disabled={busy || limited || displayLabel.length === 0 || displayLabel.length > 200}
        onClick={() => confirm({ kind: "batch-label", slotIds: visibleSelected, label: displayLabel })}>
        ラベル変更
      </button>
    </div>}
    <div className="fn-table-scroll" role="region" aria-label="枠一覧（横スクロール可能）" tabIndex={0}
      style={{ maxWidth: "100%", overflowX: "auto" }}>
      <table className="fn-table manage-slot-table">
        <thead><tr>
          {onAction && <th scope="col"><input type="checkbox" aria-label="すべて選択"
            disabled={busy} checked={visibleIds.length > 0 && visibleIds.every(id => selected.has(id))}
            onChange={event => {
              setPending(null);
              setSelected(event.target.checked ? new Set(visibleIds) : new Set());
            }} /></th>}
          <th scope="col">日時 / 部</th><th scope="col">取得者</th>
          <th scope="col">状態</th><th scope="col">作品</th>
          {onAction && <th scope="col">操作</th>}
        </tr></thead>
        <tbody>{slots.map(slot => {
          // API contracts allow arbitrary video_id strings; malformed UTF-16
          // must not crash the whole manager view while building one link.
          let videoHref: string | null = null;
          if (slot.video_id) {
            try {
              videoHref = `/manage/events/${encodeURIComponent(eventId)}/videos/${encodeURIComponent(slot.video_id)}`;
            } catch {
              // Keep the row visible without an invalid navigation link.
            }
          }
          return <tr key={slot.id}>
            {onAction && <td><input type="checkbox" disabled={busy || slot.event_id !== eventId}
              aria-label={`枠 ${slot.slot_label ?? slot.id} を選択`}
              checked={slot.event_id === eventId && selected.has(slot.id)}
              onChange={event => {
                setPending(null);
                setSelected(previous => {
                  const next = new Set(previous);
                  if (event.target.checked) next.add(slot.id);
                  else next.delete(slot.id);
                  return next;
                });
              }} /></td>}
            <td className="manage-slot-datetime">
              <span className="manage-slot-datetime-main">{slotTimeLabel(slot)}</span>
              <span className="manage-slot-datetime-part">{labels.get(slot.id) ?? "—"}</span>
            </td>
            <td className="manage-slot-holder">
              {slot.display_name || slot.reserved_x_id_snapshot || slot.x_user_id ||
              slot.discord_display_name || slot.discord_id ? (
                <div className="manage-slot-holder-grid">
                  <div><span className="fn-muted">名義: </span>{slot.display_name ?? "記録なし"}</div>
                  <div><span className="fn-muted">X ID: </span>
                    {slot.reserved_x_id_snapshot ? `@${slot.reserved_x_id_snapshot}`
                      : slot.x_user_id ? `@${slot.x_user_id}` : "記録なし"}</div>
                  <div><span className="fn-muted">Discord: </span>
                    {slot.discord_display_name ?? "記録なし"}</div>
                  <div><span className="fn-muted">Discord ID: </span>
                    {slot.discord_id ?? "記録なし"}</div>
                </div>
              ) : "—"}
            </td>
            <td><span className={"fn-badge " + (
              slot.status === "available" ? "fn-badge-soft"
                : slot.status === "reserved" ? "fn-badge-warning"
                : slot.status === "submitted" ? "fn-badge-accent"
                : "fn-badge-soft"
            )}>{slotStatusLabel(slot.status)}</span></td>
            <td>{videoHref
              ? <Link to={videoHref}>作品を見る</Link> : "—"}</td>
            {onAction && <td>
              {slot.status === "submitted" && canManageSubmittedSlots &&
                <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm"
                  disabled={busy || slot.event_id !== eventId}
                  onClick={() => confirm({ kind: "release-submitted-video", slotId: slot.id })}>
                  作品のみ解放
                </button>}
              {(slot.status === "available" || slot.status === "reserved" ||
                (slot.status === "submitted" && canManageSubmittedSlots)) &&
                <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm"
                  disabled={busy || slot.event_id !== eventId}
                  onClick={() => confirm({
                    kind: slot.status === "available" ? "delete"
                      : slot.status === "reserved" ? "release" : "force-release-submitted",
                    slotId: slot.id,
                  })}>
                  {slot.status === "available" ? "削除" : slot.status === "reserved" ? "解放" : "強制解放"}
                </button>}
            </td>}
          </tr>;
        })}</tbody>
      </table>
    </div>
    {onAction && pending && <div role="group" aria-label="枠操作の確認"
      className="manage-slot-confirm">
      <p>{pending.kind === "release-submitted-video"
        ? "作品の提出だけを解除します。予約状態は維持されます。"
        : pending.kind === "force-release-submitted"
          ? "提出済み枠を強制解放します。作品自体は削除されません。"
          : "選択した枠の変更を実行します。よろしいですか？"}</p>
      <button type="button" className="fn-btn fn-btn-ghost" disabled={busy}
        onClick={() => setPending(null)}>キャンセル</button>
      <button type="button" className="fn-btn fn-btn-primary" disabled={busy}
        onClick={() => void runConfirmed()}>実行する</button>
    </div>}
  </div>;
}
