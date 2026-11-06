// Port of CURRENT src/components/admin/CostGuardForm.tsx (MIG-0734 U01, SA-016/017). router.refresh() -> onSuccess (D-17-3).
import * as React from "react";
import type { AdminCostGuardResponse } from "@flamenode/contracts";
import type { AdminCostGuardApi } from "../../api/adminCostGuard.js";
import { ConfirmDialog } from "../../components/shared/ConfirmDialog.js";
import { leaveWhenAnonymous } from "./adminWrite.js";

const MODES = [
  ["normal", "通常"], ["economy", "省エネ"], ["read_only", "読み取り専用"],
  ["static_only", "静的のみ"],
] as const;

export function CostGuardForm({ settings, api, onSuccess }: {
  settings: AdminCostGuardResponse; api: AdminCostGuardApi; onSuccess: (message?: string) => void;
}): React.ReactElement {
  const [mode, setMode] = React.useState<string>(settings.mode);
  const [reason, setReason] = React.useState(settings.reason ?? "");
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmationSnapshot, setConfirmationSnapshot] = React.useState<string | null>(null);
  const [confirmationReason, setConfirmationReason] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  // Another admin can change Cost Guard while the maintenance confirmation is open.
  // Bind the confirmation to the observed settings rather than reusing stale intent.
  const settingsSnapshot = JSON.stringify([
    settings.mode, settings.isMaintenance, settings.reason, settings.updatedAt,
  ]);
  React.useEffect(() => {
    setConfirmOpen(false);
    setConfirmationSnapshot(null);
    setConfirmationReason(null);
  }, [settingsSnapshot]);
  // A D1 maintenance mode is not a valid SA-016 manual-mode input.
  const manualModeSelected = MODES.some(([value]) => value === mode);
  React.useEffect(() => { setMode(settings.mode); setReason(settings.reason ?? ""); }, [settings.mode, settings.reason]);

  const run = async (write: () => ReturnType<AdminCostGuardApi["setMode"]>): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await write();
      if (leaveWhenAnonymous(result)) return;
      setMessage(result.message ?? (result.ok ? "更新しました。" : "失敗しました。"));
      if (result.ok) onSuccess(result.message ?? "更新しました。");
    } catch {
      setMessage("失敗しました。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const maintenance = (next: 0 | 1) => void run(() => api.setMaintenance(next === 1, reason));

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section>
        <h2 style={{ fontSize: 14, fontWeight: 700 }}>手動動作モード</h2>
        <div role="group" aria-label="動作モード選択" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {MODES.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={mode === value}
              className={`fn-btn fn-btn-sm ${mode === value ? "fn-btn-primary" : "fn-btn-ghost"}`}
              onClick={() => setMode(value)} disabled={busy}>{label}</button>
          ))}
        </div>
        <input className="fn-input" value={reason} aria-label="変更理由" onChange={(event) => {
          setReason(event.currentTarget.value);
          // The modal confirms an audited reason. A change to that reason
          // invalidates the previous confirmation, even without a server refresh.
          if (confirmOpen) {
            setConfirmOpen(false);
            setConfirmationSnapshot(null);
            setConfirmationReason(null);
          }
        }}
          maxLength={500} placeholder="変更理由（normalへの復帰時も必須）" disabled={busy} />
        <button type="button" className="fn-btn fn-btn-primary" disabled={busy || !reason.trim() || !manualModeSelected}
          onClick={() => void run(() => api.setMode(mode, reason))}>モードを更新</button>
        {!manualModeSelected ? <p role="status" style={{ fontSize: 12 }}>手動モードを選択するか、下の「OFFにする」でメンテナンスを解除してください。</p> : null}
      </section>
      <section>
        <h2 style={{ fontSize: 14, fontWeight: 700 }}>メンテナンス即時切替</h2>
        <button type="button" className="fn-btn fn-btn-danger fn-btn-sm" disabled={busy || !reason.trim()}
          onClick={() => {
            if (settings.isMaintenance) {
              maintenance(0);
            } else {
              setConfirmationSnapshot(settingsSnapshot);
              setConfirmationReason(reason);
              setConfirmOpen(true);
            }
          }}>
          {settings.isMaintenance ? "OFFにする" : "ONにする"}
        </button>
      </section>
      {message ? <p role="status" style={{ fontSize: 12 }}>{message}</p> : null}
      <ConfirmDialog
        open={confirmOpen}
        title="メンテナンスモードをONにする"
        message="一般ユーザーの通常操作を停止します。理由と監査記録を確認して続行してください。"
        confirmLabel="ONにする"
        cancelLabel="キャンセル"
        tone="danger"
        busy={busy || confirmationSnapshot !== settingsSnapshot || confirmationReason !== reason}
        onConfirm={() => {
          if (confirmationSnapshot !== settingsSnapshot || confirmationReason !== reason || settings.isMaintenance || !reason.trim()) return;
          setConfirmOpen(false);
          setConfirmationSnapshot(null);
          setConfirmationReason(null);
          maintenance(1);
        }}
        onCancel={() => {
          setConfirmOpen(false);
          setConfirmationSnapshot(null);
          setConfirmationReason(null);
        }}
      />
    </div>
  );
}
