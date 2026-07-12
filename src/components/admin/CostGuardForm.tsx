"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { setCostGuardMode, setMaintenanceMode } from "@/lib/actions/cost-guard";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface Props {
  mode: "normal" | "economy" | "read_only" | "static_only" | "maintenance";
  reason: string | null;
  isMaintenance: number;
}

const MODES = [
  ["normal", "通常"], ["economy", "省エネ"], ["read_only", "読み取り専用"],
  ["static_only", "静的のみ"], ["maintenance", "メンテナンス"],
] as const;

export function CostGuardForm(props: Props): React.ReactElement {
  const router = useRouter();
  const [mode, setMode] = React.useState(props.mode);
  const [reason, setReason] = React.useState(props.reason ?? "");
  const [busy, startTransition] = React.useTransition();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const run = (fd: FormData, maintenance = false) => {
    setMessage(null);
    startTransition(async () => {
      const result = maintenance ? await setMaintenanceMode(fd) : await setCostGuardMode(fd);
      setMessage(result.message ?? (result.ok ? "更新しました。" : "失敗しました。"));
      if (result.ok) router.refresh();
    });
  };

  const maintenance = (next: 0 | 1) => {
    const fd = new FormData();
    fd.set("is_maintenance_mode", String(next));
    fd.set("reason", reason);
    run(fd, true);
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section>
        <h2 style={{ fontSize: 14, fontWeight: 700 }}>手動動作モード</h2>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {MODES.map(([value, label]) => (
            <button key={value} type="button" className={`fn-btn fn-btn-sm ${mode === value ? "fn-btn-primary" : "fn-btn-ghost"}`} onClick={() => setMode(value)} disabled={busy}>{label}</button>
          ))}
        </div>
        <input className="fn-input" value={reason} onChange={(event) => setReason(event.currentTarget.value)} maxLength={500} placeholder="変更理由（normalへの復帰時も必須）" disabled={busy} />
        <button type="button" className="fn-btn fn-btn-primary" disabled={busy || !reason.trim()} onClick={() => {
          const fd = new FormData(); fd.set("mode", mode); fd.set("reason", reason); run(fd);
        }}>モードを更新</button>
      </section>
      <section>
        <h2 style={{ fontSize: 14, fontWeight: 700 }}>メンテナンス即時切替</h2>
        <button type="button" className="fn-btn fn-btn-danger fn-btn-sm" disabled={busy || !reason.trim()} onClick={() => props.isMaintenance === 1 ? maintenance(0) : setConfirmOpen(true)}>
          {props.isMaintenance === 1 ? "OFFにする" : "ONにする"}
        </button>
      </section>
      {message ? <p role="status" style={{ fontSize: 12 }}>{message}</p> : null}
      <ConfirmDialog open={confirmOpen} title="メンテナンスモードをONにする" message="一般ユーザーの通常操作を停止します。理由と監査記録を確認して続行してください。" confirmLabel="ONにする" cancelLabel="キャンセル" tone="danger" onConfirm={() => { setConfirmOpen(false); maintenance(1); }} onCancel={() => setConfirmOpen(false)} />
    </div>
  );
}
