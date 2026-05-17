"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { deleteSlot, releaseSlot } from "@/lib/actions/slot-admin";
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
  end_time: number | null;
  sort_order?: number | null;
  status: "available" | "reserved" | "submitted";
  display_name: string | null;
  x_user_id: string | null;
  discord_user_id?: string | null;
  reservation_group_id?: string | null;
}

interface SlotListProps {
  slots: SlotRowLite[];
  /** 「部」分割閾値 (秒)。未指定で 30 分。 */
  slotPartGapSec?: number;
}

export function SlotList({
  slots,
  slotPartGapSec,
}: SlotListProps): React.ReactElement {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<
    | { kind: "release"; id: string }
    | { kind: "delete"; id: string }
    | null
  >(null);
  const displayRows = React.useMemo(
    () => collapseReservationGroups(slots as SlotBase[]),
    [slots],
  );

  /**
   * 各スロット id が属する「第N部」インデックスを引くマップ。
   * buildSlotParts は元スロット全件を時系列で部分割するので、
   * 折り畳み後の displayRows の先頭 id からも部番号を解決できる。
   */
  const partLabelMap = React.useMemo(() => {
    const parts = buildSlotParts(slots as SlotBase[], slotPartGapSec);
    const map = new Map<string, string>();
    for (const part of parts) {
      const label = part.is_timeless ? "時間なし" : `第${part.index}部`;
      for (const row of part.rows) {
        map.set(row.id, label);
      }
    }
    return map;
  }, [slots, slotPartGapSec]);

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

  return (
    <div>
      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 12 }}>
          <Icon name="warning" size={12} aria-hidden /> {error}
        </p>
      ) : null}
      <table className="fn-table">
        <thead>
          <tr>
            <th>日時 / ラベル</th>
            <th>部</th>
            <th>取得者</th>
            <th>状態</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map((s) => {
            // グループ折り畳み行では s.id が先頭スロットの id。
            // slot_ids の先頭からでも同じ値を参照できる。
            const partLabel = partLabelMap.get(s.id) ?? "-";
            return (
              <tr key={s.id}>
                <td>
                  {s.start_time
                    ? `${formatUnix(s.start_time, { dateOnly: true })} ${formatUnix(s.start_time, { timeOnly: true })}${s.end_time ? ` - ${formatUnix(s.end_time, { timeOnly: true })}` : ""}`
                    : (s.slot_label ?? "-")}
                  {s.is_group ? (
                    <span className="fn-badge fn-badge-soft" style={{ marginLeft: 6 }}>
                      {s.group_size}連続
                    </span>
                  ) : null}
                </td>
                <td>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {partLabel}
                  </span>
                </td>
                <td>
                  {s.display_name || s.x_user_id ? (
                    <span>
                      <strong>{s.display_name ?? `@${s.x_user_id}`}</strong>
                      {s.x_user_id ? (
                        <span
                          style={{
                            display: "block",
                            fontSize: 11,
                            color: "var(--text-muted)",
                          }}
                        >
                          @{s.x_user_id}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    "-"
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
                    {s.status}
                  </span>
                </td>
                <td style={{ display: "flex", gap: 6 }}>
                  {s.status !== "available" ? (
                    <button
                      type="button"
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                      disabled={busyId === s.id}
                      onClick={() => setConfirm({ kind: "release", id: s.id })}
                    >
                      解放
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                      disabled={busyId === s.id}
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
        title={confirm?.kind === "release" ? "枠を強制解放しますか?" : "空き枠を削除しますか?"}
        message={
          confirm?.kind === "release"
            ? "この枠を強制的に解放します。確保者には通知が必要な場合があります。続行しますか?"
            : "この空き枠を削除します。"
        }
        confirmLabel={confirm?.kind === "release" ? "解放する" : "削除する"}
        tone="danger"
        onConfirm={() => {
          if (!confirm) return;
          const { kind, id } = confirm;
          setConfirm(null);
          if (kind === "release") runRelease(id);
          else runDelete(id);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
