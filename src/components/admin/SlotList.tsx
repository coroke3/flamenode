"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { deleteSlot, releaseSlot } from "@/lib/actions/slot-admin";
import { formatUnix } from "@/lib/utils/format";

export interface SlotRowLite {
  id: string;
  slot_kind: "time" | "count" | null;
  slot_label: string | null;
  start_time: number | null;
  end_time: number | null;
  status: "available" | "reserved" | "submitted";
  display_name: string | null;
  x_user_id: string | null;
  discord_user_id?: string | null;
}

interface SlotListProps {
  slots: SlotRowLite[];
}

export function SlotList({ slots }: SlotListProps): React.ReactElement {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const runRelease = (slotId: string) => {
    if (
      !confirm("この枠を強制的に解放します。確保者には通知が必要な場合があります。続行しますか?")
    )
      return;
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
    if (!confirm("この空き枠を削除します。")) return;
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
            <th>取得者</th>
            <th>状態</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.id}>
              <td>
                {s.start_time
                  ? `${formatUnix(s.start_time, { dateOnly: true })} ${formatUnix(s.start_time, { timeOnly: true })}`
                  : (s.slot_label ?? "-")}
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
                    onClick={() => runRelease(s.id)}
                  >
                    解放
                  </button>
                ) : (
                  <button
                    type="button"
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    disabled={busyId === s.id}
                    onClick={() => runDelete(s.id)}
                  >
                    削除
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
