"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { releaseOwnSlot, reserveSlot } from "@/lib/actions/slot";
import { formatUnix } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import {
  buildSlotParts,
  collapseReservationGroups,
  formatSlotPartLabel,
  type SlotBase,
  type SlotGroupRow,
} from "@/lib/utils/slotGrouping";
import styles from "./SlotGrid.module.css";

export interface SlotRow {
  id: string;
  slot_kind: "time" | "count" | null;
  slot_label: string | null;
  start_time: number | null;
  end_time: number | null;
  sort_order: number | null;
  status: "available" | "reserved" | "submitted";
  display_name: string | null;
  x_user_id: string | null;
  discord_user_id: string | null;
  reservation_group_id?: string | null;
}

export interface SlotGridProps {
  slots: SlotRow[];
  viewerXId: string | null;
  viewerDiscordId?: string | null;
  canReserve: boolean;
  slotKind: "time" | "count";
  maxConsecutiveSlots?: number;
}

interface SlotGroup {
  label: string;
  rows: SlotGroupRow[];
}

export function SlotGrid({
  slots,
  viewerXId,
  viewerDiscordId = null,
  canReserve,
  slotKind,
  maxConsecutiveSlots = 1,
}: SlotGridProps): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [reservedSlotId, setReservedSlotId] = React.useState<string | null>(null);
  const [confirmReleaseId, setConfirmReleaseId] = React.useState<string | null>(null);
  const displayRows = React.useMemo(
    () => collapseReservationGroups(slots as SlotBase[]),
    [slots],
  );

  const groups = React.useMemo<SlotGroup[]>(() => {
    if (slotKind !== "time") return [{ label: "枠", rows: displayRows }];
    const parts = buildSlotParts(displayRows);
    return parts.map((part) => ({
      label: formatSlotPartLabel(part, "full"),
      rows: part.rows,
    }));
  }, [displayRows, slotKind]);

  const canTakeSlot = canReserve && !!viewerXId;

  const onReserve = (slotId: string, form: HTMLFormElement) => {
    setError(null);
    setSuccess(null);
    const fd = new FormData(form);
    fd.set("slot_id", slotId);
    startTransition(async () => {
      const result = await reserveSlot(fd);
      if (!result.ok) {
        setError(result.message ?? "枠の確保に失敗しました。");
        return;
      }
      setSuccess("枠を確保しました。続けて作品情報を登録できます。");
      setReservedSlotId(result.slotId ?? slotId);
      router.refresh();
    });
  };

  const onRelease = (slotId: string) => {
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set("slot_id", slotId);
    startTransition(async () => {
      const result = await releaseOwnSlot(fd);
      if (!result.ok) {
        setError(result.message ?? "枠の解放に失敗しました。");
        return;
      }
      setSuccess("枠を解放しました。");
      setReservedSlotId(null);
      router.refresh();
    });
  };

  if (slots.length === 0) {
    return (
      <p className="fn-muted fn-text-sm" style={{ padding: 16 }}>
        まだ枠が作成されていません。
      </p>
    );
  }

  return (
    <div className={styles.wrap}>
      {error ? (
        <p role="alert" className={styles.errorBar}>
          <Icon name="warning" size={12} aria-hidden /> {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className={styles.successBar}>
          <Icon name="check" size={12} aria-hidden /> {success}
          {reservedSlotId ? (
            <Link
              href={`/dashboard/post/slotted?slot=${reservedSlotId}`}
              className={styles.inlineAction}
            >
              作品情報を登録
              <Icon name="chevron-right" size={11} aria-hidden />
            </Link>
          ) : null}
        </p>
      ) : null}

      <div className={styles.partsRow}>
        {groups.map((group, index) => (
          <section key={`part-${index}`} className={styles.partColumn}>
            <header className={styles.partHeader}>{group.label}</header>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{slotKind === "time" ? "日時" : "枠"}</th>
                  <th>状態 / 操作</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((slot) => {
                  const isMine =
                    (!!viewerXId && slot.x_user_id === viewerXId) ||
                    (!slot.x_user_id && !!viewerDiscordId && slot.discord_user_id === viewerDiscordId);
                  const filled = slot.status !== "available";
                  return (
                    <tr
                      key={slot.id}
                      className={cn(
                        styles.row,
                        filled && styles.rowFilled,
                        isMine && styles.rowMine,
                      )}
                    >
                      <td className={styles.cellTime}>
                        {slot.start_time ? (
                          <span className={styles.timeStack}>
                            <span>{formatUnix(slot.start_time, { dateOnly: true })}</span>
                            <strong>
                              {formatUnix(slot.start_time, { timeOnly: true })}
                              {slot.end_time
                                ? ` - ${formatUnix(slot.end_time, { timeOnly: true })}`
                                : ""}
                            </strong>
                          </span>
                        ) : (
                          (slot.slot_label ?? `#${slot.sort_order ?? "?"}`)
                        )}
                      </td>
                      <td className={styles.cellSlot}>
                        {filled ? (
                          <div className={styles.slotTaken}>
                            <div className={styles.slotIdentity}>
                              <span className={styles.slotName}>
                                {slot.display_name ??
                                  (slot.x_user_id ? `@${slot.x_user_id}` : "確保済み")}
                              </span>
                              {slot.x_user_id ? (
                                <span className={styles.slotId}>@{slot.x_user_id}</span>
                              ) : null}
                              {slot.is_group ? (
                                <span className="fn-badge fn-badge-soft">
                                  {slot.group_size}連続
                                </span>
                              ) : null}
                            </div>
                            <div className={styles.slotActions}>
                              {slot.status === "submitted" ? (
                                <span className="fn-badge fn-badge-accent">提出済</span>
                              ) : (
                                <span className="fn-badge fn-badge-warning">確保済</span>
                              )}
                              {isMine && slot.status === "reserved" ? (
                                <>
                                  <Link
                                    href={`/dashboard/post/slotted?slot=${slot.id}`}
                                    className="fn-btn fn-btn-primary fn-btn-sm"
                                  >
                                    <Icon name="upload" size={10} aria-hidden /> 作品登録
                                  </Link>
                                  <button
                                    type="button"
                                    className="fn-btn fn-btn-ghost fn-btn-sm"
                                    disabled={busy}
                                    onClick={() => setConfirmReleaseId(slot.id)}
                                  >
                                    <Icon name="trash" size={10} aria-hidden /> 解放
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>
                        ) : canTakeSlot ? (
                          <form
                            className={styles.reserveForm}
                            onSubmit={(ev) => {
                              ev.preventDefault();
                              onReserve(slot.id, ev.currentTarget);
                            }}
                          >
                            <input
                              name="display_name"
                              type="text"
                              className="fn-input"
                              placeholder="表示名・団体名"
                              maxLength={80}
                              required
                            />
                            {maxConsecutiveSlots > 1 ? (
                              <select
                                name="consecutive_count"
                                className="fn-select"
                                defaultValue="1"
                                aria-label="連続取得数"
                              >
                                {Array.from(
                                  { length: Math.min(maxConsecutiveSlots, 6) },
                                  (_, i) => i + 1,
                                ).map((n) => (
                                  <option key={n} value={n}>
                                    {n === 1 ? "単枠" : `${n}連続`}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input type="hidden" name="consecutive_count" value="1" />
                            )}
                            <button
                              type="submit"
                              className={cn("fn-btn", "fn-btn-primary", "fn-btn-sm", styles.reserveBtn)}
                              disabled={busy}
                            >
                              <Icon name="plus" size={11} aria-hidden /> 確保
                            </button>
                          </form>
                        ) : canReserve ? (
                          <span className={styles.emptySlot}>
                            {viewerDiscordId ? "空き (X ID 未選択)" : "空き (要ログイン)"}
                          </span>
                        ) : (
                          <span className={styles.emptySlot}>空き</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      <ConfirmDialog
        open={confirmReleaseId !== null}
        title="枠を解放しますか?"
        message="この枠を解放します。よろしいですか?"
        confirmLabel="解放する"
        tone="danger"
        onConfirm={() => {
          const id = confirmReleaseId;
          setConfirmReleaseId(null);
          if (id) onRelease(id);
        }}
        onCancel={() => setConfirmReleaseId(null)}
      />
    </div>
  );
}
