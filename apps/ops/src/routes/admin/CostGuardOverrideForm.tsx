// Port of CURRENT src/components/admin/CostGuardOverrideForm.tsx (MIG-0734 U01, SA-018/020). router.refresh() -> onSuccess (D-17-3).
import * as React from "react";
import type { AdminCostGuardResponse } from "@flamenode/contracts";
import type { AdminCostGuardApi } from "../../api/adminCostGuard.js";
import { leaveWhenAnonymous } from "./adminWrite.js";
import { WRITE_FEATURE_KEYS } from "./costGuardFeatures.js";

export function CostGuardOverrideForm({ settings, api, onSuccess }: {
  settings: AdminCostGuardResponse; api: AdminCostGuardApi; onSuccess: () => void;
}): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [reason, setReason] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [features, setFeatures] = React.useState<string[]>([]);
  const [message, setMessage] = React.useState<string | null>(null);
  // An external admin may replace or clear an override while this form is open.
  // Never apply a confirmation entered for the previous authoritative snapshot.
  const snapshot = JSON.stringify([settings.exceptionUntil, settings.exceptionFeaturesJson]);
  const [confirmedSnapshot, setConfirmedSnapshot] = React.useState(snapshot);
  const snapshotCurrent = confirmedSnapshot === snapshot;
  React.useEffect(() => {
    setReason("");
    setConfirm("");
    setFeatures([]);
    setMessage(null);
    setConfirmedSnapshot(snapshot);
  }, [snapshot]);
  const active = Boolean(settings.exceptionUntil && settings.exceptionUntil > Math.floor(Date.now() / 1000));

  const submit = async (clear: boolean): Promise<void> => {
    if (busyRef.current || !snapshotCurrent || !reason.trim() ||
        (clear ? confirm !== "CLEAR" : confirm !== "OVERRIDE" || features.length === 0)) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = clear ? await api.clearOverride(reason, confirm) : await api.setOverride(reason, confirm, features);
      if (leaveWhenAnonymous(result)) return;
      setMessage(result.message ?? (result.ok ? "完了しました。" : "失敗しました。"));
      if (result.ok) {
        setReason("");
        setConfirm("");
        onSuccess();
      }
    } catch {
      setMessage("失敗しました。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <section aria-label="緊急override" style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border-subtle)" }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>15分限定の緊急override</h2>
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
        通常操作がmaintenance等で停止中でも、この専用操作だけ実行できます。理由・確認文字列・対象機能を監査します。
      </p>
      <p style={{ fontSize: 12 }}>
        状態: {active ? `有効（${new Date((settings.exceptionUntil ?? 0) * 1000).toLocaleString("ja-JP")}まで）` : "無効"}
        {settings.exceptionFeaturesJson ? ` / ${settings.exceptionFeaturesJson}` : ""}
      </p>
      <fieldset disabled={busy} style={{ display: "grid", gap: 6, maxHeight: 220, overflow: "auto", padding: 10 }}>
        <legend style={{ fontSize: 12 }}>対象機能（最大8件）</legend>
        {WRITE_FEATURE_KEYS.map((feature) => (
          <label key={feature} style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={features.includes(feature)}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setFeatures((current) => checked ? [...current, feature].slice(0, 8) : current.filter((item) => item !== feature));
              }}
            />{" "}
            {feature}
          </label>
        ))}
      </fieldset>
      <input className="fn-input" value={reason} aria-label="override理由" onChange={(event) => setReason(event.currentTarget.value)}
        maxLength={500} placeholder={active ? "設定または解除の理由（必須）" : "override理由（必須）"} disabled={busy} />
      <input className="fn-input" value={confirm} aria-label="確認文字列" onChange={(event) => setConfirm(event.currentTarget.value)}
        placeholder={active ? "有効化はOVERRIDE、解除はCLEAR" : "OVERRIDE"} disabled={busy} />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="fn-btn fn-btn-warning fn-btn-sm"
          disabled={busy || !snapshotCurrent || confirm !== "OVERRIDE" || !reason.trim() || features.length === 0} onClick={() => void submit(false)}>15分有効化</button>
        <button type="button" className="fn-btn fn-btn-danger fn-btn-sm"
          disabled={busy || !snapshotCurrent || confirm !== "CLEAR" || !reason.trim()} onClick={() => void submit(true)}>即時解除</button>
      </div>
      {message ? <p role="status" style={{ fontSize: 12 }}>{message}</p> : null}
    </section>
  );
}
