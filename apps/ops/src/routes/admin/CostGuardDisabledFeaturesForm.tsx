// Port of CURRENT src/components/admin/CostGuardDisabledFeaturesForm.tsx (MIG-0734 U01, SA-019). router.refresh() -> onSuccess (D-17-3).
import * as React from "react";
import type { AdminCostGuardResponse } from "@flamenode/contracts";
import type { AdminCostGuardApi } from "../../api/adminCostGuard.js";
import { leaveWhenAnonymous } from "./adminWrite.js";
import { FEATURE_LABELS, WRITE_FEATURE_KEYS, parseCostFeatures, type WriteFeatureKey } from "./costGuardFeatures.js";

export function CostGuardDisabledFeaturesForm({ settings, api, onSuccess }: {
  settings: AdminCostGuardResponse; api: AdminCostGuardApi; onSuccess: () => void;
}): React.ReactElement {
  const disabledFeaturesJson = settings.disabledFeaturesJson;
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const initial = React.useMemo(() => parseCostFeatures(disabledFeaturesJson), [disabledFeaturesJson]);
  const [features, setFeatures] = React.useState(initial.features);
  const [reason, setReason] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);
  React.useEffect(() => { setFeatures(initial.features); }, [initial.features]);

  const submit = async (): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      // expected_disabled_features_json is the CAS token: the value this form was rendered from.
      const result = await api.setDisabled(reason, confirm, features, disabledFeaturesJson);
      if (leaveWhenAnonymous(result)) return;
      setMessage(result.message ?? (result.ok ? "更新しました。" : "更新に失敗しました。"));
      if (result.ok) {
        setReason("");
        setConfirm("");
        onSuccess();
      }
    } catch {
      setMessage("更新に失敗しました。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <section aria-label="恒久的な無効化機能" style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border-subtle)" }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>恒久的な無効化機能</h2>
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
        一時的なoverrideではなく、Cost Guardが通常時にも停止する書込み機能を指定します。Spreadsheetからは変更できません。
      </p>
      {initial.malformed ? (
        <p role="alert" style={{ fontSize: 12, color: "var(--status-danger, #c33)" }}>
          現在の無効化機能設定が不正なため、安全のため書込み機能は停止中です。内容を確認して明示的に保存してください。
        </p>
      ) : null}
      <fieldset disabled={busy} style={{ display: "grid", gap: 6, maxHeight: 260, overflow: "auto", padding: 10 }}>
        <legend style={{ fontSize: 12 }}>無効化する機能（空欄で全て有効）</legend>
        {WRITE_FEATURE_KEYS.map((feature) => (
          <label key={feature} style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={features.includes(feature)}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setFeatures((current) => checked ? [...current, feature] : current.filter((item) => item !== feature));
              }}
            />{" "}{FEATURE_LABELS[feature as WriteFeatureKey] ?? feature}{" "}
            <code style={{ color: "var(--text-muted)", fontSize: 11 }}>({feature})</code>
          </label>
        ))}
      </fieldset>
      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
        <input className="fn-input" value={reason} aria-label="変更理由" onChange={(event) => setReason(event.currentTarget.value)}
          maxLength={500} placeholder="変更理由（必須）" disabled={busy} />
        <input className="fn-input" value={confirm} aria-label="確認文字列" onChange={(event) => setConfirm(event.currentTarget.value)}
          placeholder="APPLY" disabled={busy} />
      </div>
      <button type="button" className="fn-btn fn-btn-warning fn-btn-sm" disabled={busy || confirm !== "APPLY" || !reason.trim()}
        onClick={() => void submit()} style={{ marginTop: 8 }}>
        無効化設定を保存
      </button>
      {message ? <p role="status" style={{ fontSize: 12 }}>{message}</p> : null}
    </section>
  );
}
