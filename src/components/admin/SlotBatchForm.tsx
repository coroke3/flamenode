"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  deleteAvailableSlots,
  generateSlotsBatch,
} from "@/lib/actions/slot-admin";
import { MAX_SLOT_BATCH_GENERATE_COUNT } from "@/lib/slots/atomicLimits";

interface SlotBatchFormProps {
  eventId: string;
}

export function SlotBatchForm({
  eventId,
}: SlotBatchFormProps): React.ReactElement {
  const router = useRouter();
  const [mode, setMode] = React.useState<"time" | "count">("time");
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [intervalMinutes, setIntervalMinutes] = React.useState("5");
  const intervalOptions = [5, 6, 10, 15, 30];

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const fd = new FormData(e.currentTarget);
    fd.set("event_id", eventId);
    fd.set("mode", mode);
    startTransition(async () => {
      const r = await generateSlotsBatch(fd);
      if (!r.ok) {
        setError(r.message ?? "生成に失敗しました。");
        return;
      }
      setSuccess(`${r.created ?? 0} 件の枠を生成しました。`);
      router.refresh();
    });
  };

  const onClearAvailable = () => {
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set("event_id", eventId);
    startTransition(async () => {
      const r = await deleteAvailableSlots(fd);
      if (!r.ok) {
        setError(r.message ?? "削除に失敗しました。");
        return;
      }
      setSuccess(`${r.created ?? 0} 件の空き枠を削除しました。`);
      router.refresh();
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "inline-flex",
          gap: 4,
          padding: 4,
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-base)",
          width: "fit-content",
          maxWidth: "100%",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => setMode("time")}
          className={`fn-btn fn-btn-sm ${mode === "time" ? "fn-btn-primary" : "fn-btn-ghost"}`}
        >
          <Icon name="clock" size={11} aria-hidden />
          時間付き
        </button>
        <button
          type="button"
          onClick={() => setMode("count")}
          className={`fn-btn fn-btn-sm ${mode === "count" ? "fn-btn-primary" : "fn-btn-ghost"}`}
        >
          <Icon name="list" size={11} aria-hidden />
          時間なし
        </button>
      </div>
      <form
        onSubmit={onSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        {mode === "time" ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <div>
                <label className="fn-label">開始日時 *</label>
                <input
                  name="start_at"
                  type="datetime-local"
                  className="fn-input"
                  required
                />
              </div>
              <div>
                <label className="fn-label">終了日時 *</label>
                <input
                  name="end_at"
                  type="datetime-local"
                  className="fn-input"
                  required
                />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <div>
                <label className="fn-label">枠の間隔・長さ (分) *</label>
                <input
                  name="interval_minutes"
                  type="number"
                  min={1}
                  max={1440}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(e.target.value)}
                  className="fn-input"
                  required
                />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {intervalOptions.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`fn-btn fn-btn-sm ${intervalMinutes === String(n) ? "fn-btn-primary" : "fn-btn-ghost"}`}
                      onClick={() => setIntervalMinutes(String(n))}
                    >
                      {n}分
                    </button>
                  ))}
                </div>
                <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 12 }}>
                  終了日時までの範囲から、最大 {MAX_SLOT_BATCH_GENERATE_COUNT} 枠まで生成できます。
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              <div>
                <label className="fn-label">作成枠数 *</label>
                <input
                  name="count"
                  type="number"
                  min={1}
                  max={MAX_SLOT_BATCH_GENERATE_COUNT}
                  defaultValue={10}
                  className="fn-input"
                  required
                />
                <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 12 }}>
                  最大 {MAX_SLOT_BATCH_GENERATE_COUNT} 枠まで一度に生成できます。
                </p>
              </div>
              <div>
                <label className="fn-label">ラベル接頭辞</label>
                <input
                  name="label_prefix"
                  type="text"
                  defaultValue="No."
                  className="fn-input"
                  maxLength={40}
                />
              </div>
              <div>
                <label className="fn-label">開始番号</label>
                <input
                  name="start_index"
                  type="number"
                  min={0}
                  max={9999}
                  defaultValue={1}
                  className="fn-input"
                />
              </div>
            </div>
          </>
        )}

        {error ? (
          <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 12 }}>
            <Icon name="warning" size={12} aria-hidden /> {error}
          </p>
        ) : null}
        {success ? (
          <p role="status" style={{ color: "var(--accent-primary)", fontSize: 12 }}>
            <Icon name="check" size={12} aria-hidden /> {success}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="submit" className="fn-btn fn-btn-primary" disabled={busy}>
            <Icon name="plus" size={12} aria-hidden />
            {busy ? "生成中…" : "一括生成"}
          </button>
          <button
            type="button"
            className="fn-btn fn-btn-ghost"
            onClick={() => setConfirmClear(true)}
            disabled={busy}
          >
            <Icon name="trash" size={12} aria-hidden /> 空き枠を全削除
          </button>
        </div>
      </form>
      <ConfirmDialog
        open={confirmClear}
        title="空き枠を全削除しますか?"
        message="空き枠 (available) を全て削除します。よろしいですか?"
        confirmLabel="全削除する"
        tone="danger"
        onConfirm={() => {
          setConfirmClear(false);
          onClearAvailable();
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
