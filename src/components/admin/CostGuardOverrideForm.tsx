"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  clearCostGuardOverride,
  setCostGuardOverride,
} from "@/lib/actions/cost-guard";
import { WRITE_FEATURE_KEYS } from "@/lib/auth/writeGuardCore";

interface Props {
  exceptionUntil: number | null;
  exceptionFeaturesJson: string | null;
}

export function CostGuardOverrideForm(props: Props): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [reason, setReason] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [features, setFeatures] = React.useState<string[]>(["edit_video"]);
  const [message, setMessage] = React.useState<string | null>(null);
  const active = Boolean(props.exceptionUntil && props.exceptionUntil > Math.floor(Date.now() / 1000));

  const submit = (clear: boolean) => {
    const fd = new FormData();
    fd.set("reason", reason);
    fd.set("confirm", confirm);
    if (!clear) features.forEach((feature) => fd.append("features", feature));
    setMessage(null);
    startTransition(async () => {
      const result = clear ? await clearCostGuardOverride(fd) : await setCostGuardOverride(fd);
      setMessage(result.message ?? (result.ok ? "完了しました。" : "失敗しました。"));
      if (result.ok) {
        setReason(""); setConfirm(""); router.refresh();
      }
    });
  };

  return (
    <section style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border-subtle)" }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>15分限定の緊急override</h2>
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
        通常操作がmaintenance等で停止中でも、この専用操作だけ実行できます。理由・確認文字列・対象機能を監査します。
      </p>
      <p style={{ fontSize: 12 }}>
        状態: {active ? `有効（${new Date((props.exceptionUntil ?? 0) * 1000).toLocaleString("ja-JP")}まで）` : "無効"}
        {props.exceptionFeaturesJson ? ` / ${props.exceptionFeaturesJson}` : ""}
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
                setFeatures((current) =>
                  checked
                    ? [...current, feature].slice(0, 8)
                    : current.filter((item) => item !== feature),
                );
              }}
            />{" "}
            {feature}
          </label>
        ))}
      </fieldset>
      <input className="fn-input" value={reason} onChange={(event) => setReason(event.currentTarget.value)} maxLength={500} placeholder={active ? "設定または解除の理由（必須）" : "override理由（必須）"} disabled={busy} />
      <input className="fn-input" value={confirm} onChange={(event) => setConfirm(event.currentTarget.value)} placeholder={active ? "有効化はOVERRIDE、解除はCLEAR" : "OVERRIDE"} disabled={busy} />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="fn-btn fn-btn-warning fn-btn-sm" disabled={busy || confirm !== "OVERRIDE" || !reason.trim() || features.length === 0} onClick={() => submit(false)}>15分有効化</button>
        <button type="button" className="fn-btn fn-btn-danger fn-btn-sm" disabled={busy || confirm !== "CLEAR" || !reason.trim()} onClick={() => submit(true)}>即時解除</button>
      </div>
      {message ? <p role="status" style={{ fontSize: 12 }}>{message}</p> : null}
    </section>
  );
}
