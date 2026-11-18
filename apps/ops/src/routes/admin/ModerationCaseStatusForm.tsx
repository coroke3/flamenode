/** MIG-0731 U03: unmounted SA-044 form candidate. Backend owned by MIG-0603. */
import * as React from "react";
import { createAdminModerationApi } from "../../api/adminModeration.js";
import { storeModerationSaveNotice } from "./ModerationFlashNotice.js";

const api = createAdminModerationApi();
const CASE_STATUS = ["resolved", "rejected", "cancelled", "expired"] as const;
const VIDEO_STATUS = ["", "pending", "public", "private", "voided"] as const;
export type ModerationResolution = (typeof CASE_STATUS)[number];
export type ModerationVideoStatus = (typeof VIDEO_STATUS)[number];

export function parseModerationFormInput(input: FormData):
  | { ok: true; body: { status: ModerationResolution; video_status: ModerationVideoStatus; private_note: string } }
  | { ok: false } {
  const status = input.get("status");
  const videoStatus = input.get("video_status");
  const note = input.get("private_note");
  if (typeof status !== "string" || !CASE_STATUS.some(s => s === status) ||
      typeof videoStatus !== "string" || !VIDEO_STATUS.some(s => s === videoStatus) ||
      typeof note !== "string" || note.length > 2000) {
    return { ok: false };
  }
  return { ok: true, body: {
    status: status as ModerationResolution,
    video_status: videoStatus as ModerationVideoStatus,
    private_note: note,
  } };
}

export function ModerationCaseStatusForm({ caseId, onSaved, client = api }: {
  caseId: string;
  onSaved: () => void;
  client?: Pick<ReturnType<typeof createAdminModerationApi>, "resolveCase">;
}): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(form: HTMLFormElement): Promise<void> {
    if (busyRef.current) return;
    const parsed = parseModerationFormInput(new FormData(form));
    if (!parsed.ok) { setError("入力値が不正です。"); return; }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await client.resolveCase(caseId, parsed.body);
      if (result.status === "anonymous") {
        window.location.assign("/entry");
        return;
      }
      if (result.status !== "ok" || !result.data.ok) {
        setError(result.status === "ok"
          ? (result.data.message ?? "更新に失敗しました。")
          : "更新に失敗しました。再度お試しください。");
        return;
      }
      // CURRENT stores a single-use notice first, then refreshes the list.
      storeModerationSaveNotice({
        message: result.data.message ?? "case を更新しました。",
        pendingPublicReflection: result.data.pendingPublicReflection,
      });
      onSaved();
    } catch {
      setError("更新に失敗しました。再度お試しください。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return <form onSubmit={(event) => {
    event.preventDefault();
    void submit(event.currentTarget);
  }} style={{ display: "grid", gap: 4, minWidth: 190 }}>
    <input type="hidden" name="id" value={caseId} />
    <select name="status" className="fn-select fn-input-sm" defaultValue="resolved" disabled={busy}>
      <option value="resolved">解決</option>
      <option value="rejected">却下</option>
      <option value="cancelled">キャンセル</option>
      <option value="expired">期限切れ</option>
    </select>
    <select name="video_status" className="fn-select fn-input-sm" defaultValue="" disabled={busy}>
      <option value="">作品状態は変更しない</option>
      <option value="pending">承認待ち</option>
      <option value="public">公開</option>
      <option value="private">非公開</option>
      <option value="voided">無効</option>
    </select>
    <textarea name="private_note" className="fn-input" rows={2}
      placeholder="対応メモ" maxLength={2000} disabled={busy} />
    {error ? <p role="alert" className="fn-text-danger">{error}</p> : null}
    <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm" disabled={busy}>
      {busy ? "更新中…" : "更新"}
    </button>
  </form>;
}
