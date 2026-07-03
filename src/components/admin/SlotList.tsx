"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  batchDeleteAvailableSlots,
  batchReleaseReservedSlots,
  batchUpdateSlotLabels,
  deleteSlot,
  releaseSlot,
} from "@/lib/actions/slot-admin";
import { formatUnix } from "@/lib/utils/format";
import {
  buildSlotParts,
  collapseReservationGroups,
  type SlotBase,
} from "@/lib/utils/slotGrouping";

export interface SlotRowLite {
  id: string;
  slot_kind: "time" | "count" | null;
  slot_label: string | null;
  start_time: number | null;
  sort_order?: number | null;
  status: "available" | "reserved" | "submitted";
  display_name: string | null;
  x_user_id: string | null;
  discord_user_id?: string | null;
  reservation_group_id?: string | null;
  video_id?: string | null;
}

const STATUS_LABELS: Record<SlotRowLite["status"], string> = {
  available: "空き",
  reserved: "確保済",
  submitted: "提出済",
};

interface SlotListProps {
  eventId: string;
  slots: SlotRowLite[];
  slotPartGapSec?: number;
}

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
  slotPartGapSec,
}: SlotListProps): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [batchLabel, setBatchLabel] = React.useState("");
  const [confirm, setConfirm] = React.useState<ConfirmState>(null);

  const displayRows = React.useMemo(
    () => collapseReservationGroups(slots as SlotBase[]),
    [slots],
  );

  const slotById = React.useMemo(() => {
    const map = new Map<string, SlotRowLite>();
    for (const row of slots) map.set(row.id, row);
    return map;
  }, [slots]);

  const partLabelMap = React.useMemo(() => {
    const parts = buildSlotParts(slots as SlotBase[], slotPartGapSec);
    const map = new Map<string, string>();
    for (const part of parts) {
      const label = part.is_timeless ? "時間なし" : `第${part.index}部`;
      for (const row of part.rows) map.set(row.id, label);
    }
    return map;
  }, [slots, slotPartGapSec]);

  const selectedIds = React.useMemo(() => [...selected], [selected]);

  const toggleRow = (slotIds: string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of slotIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(displayRows.flatMap((row) => row.slot_ids)));
  };

  const allSelected =
    displayRows.length > 0 &&
    displayRows.every((row) => row.slot_ids.every((id) => selected.has(id)));

  const runBatch = (action: "delete" | "release" | "label", label?: string) => {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("event_id", eventId);
    fd.set("slot_ids", JSON.stringify(selectedIds));
    if (label) fd.set("label", label);

    const call =
      action === "delete"
        ? batchDeleteAvailableSlots
        : action === "release"
          ? batchReleaseReservedSlots
          : batchUpdateSlotLabels;

    React.startTransition(async () => {
      const r = await call(fd);
      if (!r.ok) setError(r.message ?? "操作に失敗しました。");
      else setSelected(new Set());
      router.refresh();
      setBusy(false);
    });
  };

  const runRelease = (slotId: string) => {
    setBusyId(slotId);
    setError(null);
    const fd = new FormData();
    fd.set("slot_id", slotId);
    React.startTransition(async () => {
      const r = await releaseSlot(fd);
      if (!r.ok) setError(r.message ?? "解放に失敗しました。");
      router.refresh();
      setBusyId(null);
    });
  };

  const runDelete = (slotId: string) => {
    setBusyId(slotId);
    setError(null);
    const fd = new FormData();
    fd.set("slot_id", slotId);
    React.startTransition(async () => {
      const r = await deleteSlot(fd);
      if (!r.ok) setError(r.message ?? "削除に失敗しました。");
      router.refresh();
      setBusyId(null);
    });
  };

  if (slots.length === 0) {
    return (
      <p className="fn-muted fn-text-sm">枠はまだありません。上のフォームから生成してください。</p>
    );
  }

  const selectedAvailable = selectedIds.filter(
    (id) => slotById.get(id)?.status === "available",
  ).length;
  const selectedReserved = selectedIds.filter(
    (id) => slotById.get(id)?.status === "reserved",
  ).length;

  return (
    <div>
      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 12, marginBottom: 8 }}>
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
            padding: "10px 12px",
            background: "var(--bg-elevated)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <span className="fn-text-sm">{selectedIds.length} 件選択中</span>
          {selectedAvailable > 0 ? (
            <button
              type="button"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              disabled={busy}
              onClick={() => setConfirm({ kind: "batch-delete" })}
            >
              空き枠を削除 ({selectedAvailable})
            </button>
          ) : null}
          {selectedReserved > 0 ? (
            <button
              type="button"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              disabled={busy}
              onClick={() => setConfirm({ kind: "batch-release" })}
            >
              確保済を解放 ({selectedReserved})
            </button>
          ) : null}
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 }}>
            ラベル一括
            <input
              className="fn-input"
              value={batchLabel}
              onChange={(e) => setBatchLabel(e.target.value)}
              placeholder="新しいラベル"
              style={{ width: 140 }}
            />
          </label>
          <button
            type="button"
            className="fn-btn fn-btn-primary fn-btn-sm"
            disabled={busy || !batchLabel.trim()}
            onClick={() => setConfirm({ kind: "batch-label", label: batchLabel.trim() })}
          >
            ラベル変更
          </button>
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            disabled={busy}
            onClick={() => setSelected(new Set())}
          >
            選択解除
          </button>
        </div>
      ) : null}

      <table className="fn-table">
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <input
                type="checkbox"
                aria-label="すべて選択"
                checked={allSelected}
                onChange={(e) => toggleAll(e.target.checked)}
              />
            </th>
            <th>日時 / ラベル</th>
            <th>部</th>
            <th>取得者</th>
            <th>状態</th>
            <th>予約グループ</th>
            <th>作品</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map((s) => {
            const partLabel = partLabelMap.get(s.id) ?? "—";
            const rowChecked = s.slot_ids.every((id) => selected.has(id));
            const rowIndeterminate =
              !rowChecked && s.slot_ids.some((id) => selected.has(id));
            const videoIds = [
              ...new Set(
                s.slot_ids
                  .map((id) => slotById.get(id)?.video_id)
                  .filter((id): id is string => Boolean(id)),
              ),
            ];
            return (
              <tr key={s.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label="枠を選択"
                    checked={rowChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = rowIndeterminate;
                    }}
                    onChange={(e) => toggleRow(s.slot_ids, e.target.checked)}
                  />
                </td>
                <td>
                  {s.start_time
                    ? `${formatUnix(s.start_time, { dateOnly: true })} ${formatUnix(s.start_time, { timeOnly: true })}`
                    : (s.slot_label ?? "—")}
                  {s.is_group ? (
                    <span className="fn-badge fn-badge-soft" style={{ marginLeft: 6 }}>
                      {s.group_size}連続
                    </span>
                  ) : null}
                </td>
                <td>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    {partLabel}
                  </span>
                </td>
                <td>
                  {s.display_name || s.x_user_id ? (
                    <span>
                      <strong>{s.display_name ?? `@${s.x_user_id}`}</strong>
                      {s.x_user_id ? (
                        <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                          @{s.x_user_id}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <span
                    className={`fn-badge ${
                      s.status === "submitted"
                        ? "fn-badge-accent"
                        : s.status === "reserved"
                          ? "fn-badge-warning"
                          : "fn-badge-soft"
                    }`}
                  >
                    {STATUS_LABELS[s.status]}
                  </span>
                </td>
                <td style={{ fontSize: 11, maxWidth: 120 }}>
                  {s.reservation_group_id ? (
                    <details>
                      <summary style={{ cursor: "pointer" }}>グループ</summary>
                      <code style={{ wordBreak: "break-all" }}>{s.reservation_group_id}</code>
                      <div className="fn-muted" style={{ marginTop: 4 }}>
                        {s.slot_ids.length} 枠
                      </div>
                    </details>
                  ) : (
                    <span className="fn-muted">—</span>
                  )}
                </td>
                <td>
                  {videoIds.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {videoIds.map((vid) => (
                        <Link
                          key={vid}
                          href={`/admin/videos/${vid}`}
                          className="fn-text-sm"
                          style={{ fontSize: 11 }}
                        >
                          {vid.slice(0, 8)}…
                        </Link>
                      ))}
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td style={{ display: "flex", gap: 6 }}>
                  {s.status !== "available" ? (
                    <button
                      type="button"
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                      disabled={busyId === s.id || busy}
                      onClick={() => setConfirm({ kind: "release", id: s.id })}
                    >
                      解放
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                      disabled={busyId === s.id || busy}
                      onClick={() => setConfirm({ kind: "delete", id: s.id })}
                    >
                      削除
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === "release" || confirm?.kind === "batch-release"
            ? "枠を強制解放しますか?"
            : confirm?.kind === "batch-label"
              ? "ラベルを一括変更しますか?"
              : "空き枠を削除しますか?"
        }
        message={
          confirm?.kind === "release"
            ? "この枠を強制的に解放します。確保者には通知が必要な場合があります。続行しますか?"
            : confirm?.kind === "batch-release"
              ? `選択した ${selectedReserved} 件の確保済枠を解放します。`
              : confirm?.kind === "batch-delete"
                ? `選択した ${selectedAvailable} 件の空き枠を削除します。`
                : confirm?.kind === "batch-label"
                  ? `${selectedIds.length} 件のラベルを「${confirm.label}」に変更します。`
                  : "この空き枠を削除します。"
        }
        confirmLabel={
          confirm?.kind === "release" || confirm?.kind === "batch-release"
            ? "解放する"
            : confirm?.kind === "batch-label"
              ? "変更する"
              : "削除する"
        }
        tone="danger"
        onConfirm={() => {
          if (!confirm) return;
          const state = confirm;
          setConfirm(null);
          if (state.kind === "release") runRelease(state.id);
          else if (state.kind === "delete") runDelete(state.id);
          else if (state.kind === "batch-delete") runBatch("delete");
          else if (state.kind === "batch-release") runBatch("release");
          else if (state.kind === "batch-label") runBatch("label", state.label);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
