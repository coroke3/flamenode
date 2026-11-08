import * as React from "react";

/**
 * MIG-0722 U02b-1: unmounted Ops batch form. This view receives explicit
 * handlers; no Hono write route is available until MIG-0656 is integrated.
 * All successful mutations must be re-authorized and validated on the server.
 */
export type SlotGenerateRequest =
  | { mode: "time"; start_at: string; end_at: string; interval_minutes: number }
  | { mode: "count"; count: number; label_prefix: string; start_index: number };

export type SlotMutationResult = {
  ok: boolean;
  message?: string;
  created?: number;
  pendingPublicReflection?: boolean;
};

export type SlotBatchFormProps = {
  eventId: string;
  totalSlots: number;
  onGenerate: (body: SlotGenerateRequest) => Promise<SlotMutationResult>;
  onClearAvailable: () => Promise<SlotMutationResult>;
  onChanged?: () => void;
};

export type SlotFormParse =
  | { ok: true; value: SlotGenerateRequest }
  | { ok: false; message: string };

const MAX_GENERATE_COUNT = 100;
const INTERVAL_PRESETS = [5, 6, 10, 15, 30] as const;

/** Parse a local datetime as JST, validating the calendar without Date overflow normalization. */
function parseJstMinute(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 ||
      hour > 23 || minute > 59) return null;
  // Date.UTC(y, ...) converts years 0–99 to 1900–1999. Preserve the
  // literal year, including values below 100, before adjusting from JST.
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, 0, 0);
  const utc = calendar.getTime() - 9 * 60 * 60 * 1000;
  if (!Number.isFinite(utc)) return null;
  const roundTrip = new Date(utc + 9 * 60 * 60 * 1000);
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() + 1 !== month ||
      roundTrip.getUTCDate() !== day || roundTrip.getUTCHours() !== hour ||
      roundTrip.getUTCMinutes() !== minute) return null;
  return utc / 60000;
}

function decimalInteger(raw: FormDataEntryValue | null, min: number, max: number): number | null {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

/** Client validation only; the server is the authoritative validation and permission boundary. */
export function parseSlotGenerateForm(data: FormData, mode: "time" | "count"): SlotFormParse {
  if (mode === "time") {
    const start = data.get("start_at");
    const end = data.get("end_at");
    const interval = decimalInteger(data.get("interval_minutes"), 1, 1440);
    const from = typeof start === "string" ? parseJstMinute(start) : null;
    const to = typeof end === "string" ? parseJstMinute(end) : null;
    if (from === null || to === null || to <= from || interval === null) {
      return { ok: false, message: "開始・終了日時と枠の間隔を正しく指定してください。" };
    }
    const count = Math.floor((to - from) / interval);
    if (count < 1 || count > MAX_GENERATE_COUNT) {
      return { ok: false, message: "1回に生成できる枠は1〜100件です。" };
    }
    return { ok: true, value: {
      mode: "time", start_at: start as string, end_at: end as string,
      interval_minutes: interval,
    } };
  }

  const count = decimalInteger(data.get("count"), 1, MAX_GENERATE_COUNT);
  const start = decimalInteger(data.get("start_index"), 0, 9999);
  const prefix = data.get("label_prefix");
  if (count === null || start === null || typeof prefix !== "string" ||
      prefix.trim().length > 40) {
    return { ok: false, message: "作成枠数・開始番号・ラベル接頭辞を確認してください。" };
  }
  return { ok: true, value: {
    mode: "count", count, start_index: start, label_prefix: prefix.trim(),
  } };
}

export function SlotBatchForm({
  eventId, totalSlots, onGenerate, onClearAvailable, onChanged,
}: SlotBatchFormProps): React.ReactElement {
  const [mode, setMode] = React.useState<"time" | "count">("time");
  const [interval, setInterval] = React.useState("5");
  const [busy, setBusy] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const perform = async (action: () => Promise<SlotMutationResult>, success: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.message || "枠操作に失敗しました。");
      } else {
        const message = result.message ?? success;
        setNotice(result.pendingPublicReflection
          ? message + " 公開画面への反映は処理中です。" : message);
        onChanged?.();
      }
    } catch {
      setError("枠操作中に通信エラーが発生しました。");
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseSlotGenerateForm(new FormData(event.currentTarget), mode);
    if (!parsed.ok) {
      setError(parsed.message);
      setNotice(null);
      return;
    }
    void perform(() => onGenerate(parsed.value), "枠を生成しました。");
  };

  const form = <div className="manage-slot-batch-form">
    <div className="manage-slot-mode-switch" aria-label="枠の生成方法">
      <button type="button" className={mode === "time" ? "fn-btn fn-btn-primary" : "fn-btn fn-btn-ghost"}
        aria-pressed={mode === "time"} onClick={() => setMode("time")} disabled={busy}>時間付き</button>
      <button type="button" className={mode === "count" ? "fn-btn fn-btn-primary" : "fn-btn fn-btn-ghost"}
        aria-pressed={mode === "count"} onClick={() => setMode("count")} disabled={busy}>時間なし</button>
    </div>
    <form onSubmit={onSubmit} aria-label="枠の一括生成">
      {mode === "time" ? <div className="manage-slot-fields">
        <label className="fn-label">開始日時
          <input className="fn-input" type="datetime-local" name="start_at" required disabled={busy} />
        </label>
        <label className="fn-label">終了日時
          <input className="fn-input" type="datetime-local" name="end_at" required disabled={busy} />
        </label>
        <label className="fn-label">枠の間隔・長さ（分）
          <input className="fn-input" type="number" name="interval_minutes" min={1} max={1440}
            value={interval} onChange={event => setInterval(event.target.value)}
            required disabled={busy} />
        </label>
        <div className="manage-slot-presets" aria-label="間隔のプリセット">
          {INTERVAL_PRESETS.map(n => <button type="button" key={n}
            className={interval === String(n) ? "fn-btn fn-btn-primary" : "fn-btn fn-btn-ghost"}
            onClick={() => setInterval(String(n))} disabled={busy}>{n}分</button>)}
        </div>
      </div> : <div className="manage-slot-fields">
        <label className="fn-label">作成枠数
          <input className="fn-input" type="number" name="count" min={1} max={100}
            defaultValue={10} required disabled={busy} />
        </label>
        <label className="fn-label">ラベル接頭辞
          <input className="fn-input" type="text" name="label_prefix"
            maxLength={40} defaultValue="No." disabled={busy} />
        </label>
        <label className="fn-label">開始番号
          <input className="fn-input" type="number" name="start_index"
            min={0} max={9999} defaultValue={1} required disabled={busy} />
        </label>
      </div>}
      <p className="fn-console-note">1回につき最大100件。生成時はサーバー側で権限と既存枠を再検証します。</p>
      {error && <p role="alert" className="fn-alert fn-alert--danger">{error}</p>}
      {notice && <p role="status" className="fn-console-note">{notice}</p>}
      <div className="manage-slot-actions">
        <button type="submit" className="fn-btn fn-btn-primary" disabled={busy}>
          {busy ? "生成中…" : "一括生成"}</button>
        <button type="button" className="fn-btn fn-btn-ghost"
          onClick={() => setConfirmClear(true)} disabled={busy}>空き枠を全削除</button>
      </div>
    </form>
    {confirmClear && <div role="group"
      aria-label="空き枠の全削除確認" className="manage-slot-confirm">
      <p>空き枠（available）を全て削除します。予約・提出済みの枠は対象外です。</p>
      <button type="button" className="fn-btn fn-btn-ghost"
        onClick={() => setConfirmClear(false)} disabled={busy}>キャンセル</button>
      <button type="button" className="fn-btn fn-btn-primary"
        onClick={() => {
          if (busy) return;
          setConfirmClear(false);
          void perform(onClearAvailable, "空き枠を削除しました。");
        }} disabled={busy}>全削除する</button>
    </div>}
  </div>;

  return <section aria-label="枠を追加・一括編集" data-event-id={eventId}>
    {totalSlots > 0
      ? <details className="manage-collapsible manage-slot-batch-collapsible">
          <summary>枠を追加・一括編集</summary>
          <div className="manage-collapsible-body">{form}</div>
        </details>
       : <><p className="fn-console-note">枠がまだないため、一括生成フォームを表示しています。</p>{form}</>}
  </section>;
}
