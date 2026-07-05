"use client";

import * as React from "react";
import { updateAuditLogSettingsAction } from "@/lib/actions/audit-admin";
import type { AuditLogSettings } from "@/lib/audit/types";

interface Props {
  initialSettings: AuditLogSettings;
}

export function AuditSettingsForm({ initialSettings }: Props): React.ReactElement {
  const [result, setResult] = React.useState<{
    ok: boolean;
    message?: string;
  } | null>(null);
  const [loading, setLoading] = React.useState(false);

  const [normalDays, setNormalDays] = React.useState(
    initialSettings.normal_retention_days,
  );
  const [restorableDays, setRestorableDays] = React.useState(
    initialSettings.restorable_retention_days,
  );
  const [longAuditDays, setLongAuditDays] = React.useState(
    initialSettings.long_audit_retention_days,
  );
  const [maxPayload, setMaxPayload] = React.useState(
    initialSettings.max_payload_bytes,
  );
  const [compactAfter, setCompactAfter] = React.useState(
    initialSettings.compact_after_days,
  );

  const shortenWarning =
    normalDays < initialSettings.normal_retention_days ||
    restorableDays < initialSettings.restorable_retention_days ||
    longAuditDays < initialSettings.long_audit_retention_days;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("normal_retention_days", String(normalDays));
      fd.set("restorable_retention_days", String(restorableDays));
      fd.set("long_audit_retention_days", String(longAuditDays));
      fd.set("max_payload_bytes", String(maxPayload));
      fd.set("compact_after_days", String(compactAfter));
      const res = await updateAuditLogSettingsAction(fd);
      setResult(res);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 20, maxWidth: 480 }}>
      <NumberField
        label="通常ログ 保持日数 (normal_retention_days)"
        value={normalDays}
        onChange={setNormalDays}
        min={7}
        max={365}
        unit="日"
      />
      <NumberField
        label="復元可能ログ 保持日数 (restorable_retention_days)"
        value={restorableDays}
        onChange={setRestorableDays}
        min={14}
        max={1095}
        unit="日"
      />
      <NumberField
        label="長期監査ログ 保持日数 (long_audit_retention_days)"
        value={longAuditDays}
        onChange={setLongAuditDays}
        min={30}
        max={3650}
        unit="日"
      />
      <NumberField
        label="最大ペイロードサイズ (max_payload_bytes)"
        value={maxPayload}
        onChange={setMaxPayload}
        min={1000}
        max={1000000}
        unit="bytes"
      />
      <NumberField
        label="コンパクト化開始日数 (compact_after_days)"
        value={compactAfter}
        onChange={setCompactAfter}
        min={1}
        max={365}
        unit="日"
      />

      {shortenWarning && (
        <div
          style={{
            padding: 12,
            background: "color-mix(in srgb, var(--accent-warning) 12%, transparent)",
            border: "1px solid var(--accent-warning)",
            borderRadius: "var(--radius-md)",
            fontSize: 13,
          }}
        >
          <strong>警告:</strong>{" "}
          保持日数を短くすると、既存ログが次回クリーンアップ時に削除される可能性があります。
          リストア可能なログが失われる場合があります。
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          type="submit"
          className="fn-btn fn-btn-primary fn-btn-sm"
          disabled={loading}
        >
          {loading ? "保存中…" : "設定を保存"}
        </button>
        {result && (
          <span
            style={{
              fontSize: 13,
              color: result.ok
                ? "var(--accent-success, #22c55e)"
                : "var(--accent-danger)",
            }}
          >
            {result.ok
              ? "保存しました"
              : result.message ?? "エラーが発生しました"}
          </span>
        )}
      </div>
    </form>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  unit: string;
}): React.ReactElement {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
      <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          min={min}
          max={max}
          className="fn-input"
          style={{ width: 120 }}
        />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{unit}</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          ({min}〜{max})
        </span>
      </div>
    </label>
  );
}
