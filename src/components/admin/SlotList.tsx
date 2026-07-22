"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TableScroll } from "@/components/ui/TableScroll";
import {
  batchDeleteAvailableSlots,
  batchReleaseReservedSlots,
  batchUpdateSlotLabels,
  deleteSlot,
  releaseSlot,
} from "@/lib/actions/slot-admin";
import { formatUnix } from "@/lib/utils/format";
import { buildSlotParts } from "@/lib/utils/slotGrouping";

export interface SlotRowLite {
  id: string;
  event_id: string;
  slot_label: string | null;
  start_time: number | null;
  sort_order: number | null;
  status: "available" | "reserved" | "submitted";
  display_name: string | null;
  x_user_id: string | null;
  reserved_by_user_id: string | null;
  reservation_group_id: string | null;
  video_id: string | null;
  updated_at: number;
  version: number;
}

const STATUS_LABELS: Record<SlotRowLite["status"], string> = {
  available: "空き",
  reserved: "確保済",
  submitted: "提出済",
};

type ConfirmState =
  | { kind: "release"; id: string }
  | { kind: "delete"; id: string }
  | { kind: "batch-delete" }
  | { kind: "batch-release" }
  | { kind: "batch-label"; label: string }
  | null;

export function SlotList({
  eventId,
  slots,
  slotPartGapSec = 15 * 60,
}: {
  eventId: string;
  slots: SlotRowLite[];
  slotPartGapSec?: number;
}): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [batchLabel, setBatchLabel] = React.useState("");
  const [confirm, setConfirm] = React.useState<ConfirmState>(null);

  const partLabels = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const part of buildSlotParts(slots, slotPartGapSec)) {
      const label = part.is_timeless ? "件数枠" : `第${part.index}部`;
      for (const row of part.rows) map.set(row.id, label);
    }
    return map;
  }, [slots, slotPartGapSec]);

  const run = async (
    action: (formData: FormData) => Promise<{ ok: boolean; message?: string }>,
    formData: FormData,
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await action(formData);
    if (!result.ok) setError(result.message ?? "操作に失敗しました。");
    else setSelected(new Set());
    router.refresh();
    setBusy(false);
  };

  const selectedIds = [...selected];
  const selectedAvailable = selectedIds.filter(
    (id) => slots.find((row) => row.id === id)?.status === "available",
  ).length;
  const selectedReserved = selectedIds.filter(
    (id) => slots.find((row) => row.id === id)?.status === "reserved",
  ).length;

  if (slots.length === 0) {
    return <p className="fn-muted fn-text-sm">枠はまだありません。</p>;
  }

  return (
    <div>
      {error ? (
        <p role="alert" className="fn-alert fn-alert--danger">
          <Icon name="warning" size={12} aria-hidden /> {error}
        </p>
      ) : null}

      {selectedIds.length > 0 ? (
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <span className="fn-text-sm">{selectedIds.length}件選択中</span>
          {selectedAvailable > 0 ? (
            <button
              className="fn-btn fn-btn-ghost fn-btn-sm"
              disabled={busy}
              onClick={() => setConfirm({ kind: "batch-delete" })}
            >
              空き枠を削除 ({selectedAvailable})
            </button>
          ) : null}
          {selectedReserved > 0 ? (
            <button
              className="fn-btn fn-btn-ghost fn-btn-sm"
              disabled={busy}
              onClick={() => setConfirm({ kind: "batch-release" })}
            >
              予約枠を解放 ({selectedReserved})
            </button>
          ) : null}
          <input
            className="fn-input"
            value={batchLabel}
            onChange={(event) => setBatchLabel(event.target.value)}
            placeholder="一括ラベル"
            style={{ width: 150 }}
          />
          <button
            className="fn-btn fn-btn-primary fn-btn-sm"
            disabled={busy || !batchLabel.trim()}
            onClick={() =>
              setConfirm({ kind: "batch-label", label: batchLabel.trim() })
            }
          >
            ラベル変更
          </button>
        </div>
      ) : null}

      <TableScroll label="枠一覧は横にスクロールして取得者・状態・操作まで確認できます">
        <table className="fn-table">
          <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                aria-label="すべて選択"
                checked={slots.every((row) => selected.has(row.id))}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? new Set(slots.map((row) => row.id))
                      : new Set(),
                  )
                }
              />
            </th>
            <th>日時 / ラベル</th>
            <th>部</th>
            <th>取得者</th>
            <th>状態</th>
            <th>作品</th>
            <th>操作</th>
          </tr>
          </thead>
          <tbody>
          {slots.map((slot) => (
            <tr key={slot.id}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(slot.id)}
                  onChange={(event) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(slot.id);
                      else next.delete(slot.id);
                      return next;
                    })
                  }
                />
              </td>
              <td>
                {slot.start_time
                  ? `${formatUnix(slot.start_time, { dateOnly: true })} ${formatUnix(
                      slot.start_time,
                      { timeOnly: true },
                    )}`
                  : (slot.slot_label ?? "—")}
              </td>
              <td>{partLabels.get(slot.id) ?? "—"}</td>
              <td>
                {slot.display_name ??
                  (slot.x_user_id ? `@${slot.x_user_id}` : "—")}
              </td>
              <td>
                <span className="fn-badge fn-badge-soft">
                  {STATUS_LABELS[slot.status]}
                </span>
              </td>
              <td>
                {slot.video_id ? (
                  <Link href={`/admin/videos/${slot.video_id}`}>
                    {slot.video_id.slice(0, 8)}…
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td>
                <button
                  className="fn-btn fn-btn-ghost fn-btn-sm"
                  disabled={busy || slot.status === "submitted"}
                  onClick={() =>
                    setConfirm({
                      kind: slot.status === "available" ? "delete" : "release",
                      id: slot.id,
                    })
                  }
                >
                  {slot.status === "available" ? "削除" : "解放"}
                </button>
              </td>
            </tr>
          ))}
          </tbody>
        </table>
      </TableScroll>

      <ConfirmDialog
        open={confirm !== null}
        title="枠操作を実行しますか?"
        message="選択した枠の状態を変更します。"
        confirmLabel="実行する"
        tone="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const state = confirm;
          setConfirm(null);
          const fd = new FormData();
          fd.set("event_id", eventId);
          if (state.kind === "release" || state.kind === "delete") {
            fd.set("slot_id", state.id);
            void run(state.kind === "release" ? releaseSlot : deleteSlot, fd);
            return;
          }
          fd.set("slot_ids", JSON.stringify(selectedIds));
          if (state.kind === "batch-label") {
            fd.set("label", state.label);
            void run(batchUpdateSlotLabels, fd);
          } else if (state.kind === "batch-release") {
            void run(batchReleaseReservedSlots, fd);
          } else {
            void run(batchDeleteAvailableSlots, fd);
          }
        }}
      />
    </div>
  );
}
