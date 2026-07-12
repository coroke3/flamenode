"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import {
  setAutoCostGuard,
  setCostGuardAdvancedSettings,
  setCostGuardMode,
  setMaintenanceMode,
} from "@/lib/actions/cost-guard";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface CostGuardFormProps {
  mode: "normal" | "economy" | "read_only" | "static_only" | "maintenance";
  reason: string | null;
  isMaintenance: number;
  autoEnabled: number;
  thresholdsJson: string | null;
}

const MODES = [
  { value: "normal", label: "通常" },
  { value: "economy", label: "省エネ" },
  { value: "read_only", label: "読み取り専用" },
  { value: "static_only", label: "静的のみ" },
  { value: "maintenance", label: "メンテナンス" },
] as const;

export function CostGuardForm(props: CostGuardFormProps): React.ReactElement {
  const router = useRouter();
  const [mode, setMode] = React.useState(props.mode);
  const [reason, setReason] = React.useState(props.reason ?? "");
  const [busy, startTransition] = React.useTransition();
  const [thresholdsJson, setThresholdsJson] = React.useState(
    props.thresholdsJson ?? '{ "economy": 0.75, "read_only": 0.9, "static_only": 0.97, "maintenance": 1 }',
  );
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [maintenanceConfirmOpen, setMaintenanceConfirmOpen] = React.useState(false);

  const run = (
    fd: FormData,
    fn: (fd: FormData) => Promise<{ ok: boolean; message?: string }>,
    ok: string,
  ) => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const r = await fn(fd);
      if (!r.ok) setError(r.message ?? "失敗しました。");
      else {
        setSuccess(ok);
        router.refresh();
      }
    });
  };

  const onSubmitMode = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set("mode", mode);
    fd.set("reason", reason);
    run(fd, setCostGuardMode, "コストガードモードを更新しました。");
  };

  const onSubmitAdvanced = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set("thresholds_json", thresholdsJson);
    run(fd, setCostGuardAdvancedSettings, "詳細設定を更新しました。");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
          動作モード
        </h2>
        <form onSubmit={onSubmitMode} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                className={`fn-btn fn-btn-sm ${mode === m.value ? "fn-btn-primary" : "fn-btn-ghost"}`}
                onClick={() => setMode(m.value)}
                disabled={busy}
              >
                {m.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            className="fn-input"
            placeholder={
              mode === "normal"
                ? "理由 (任意。normal の場合は省略可)"
                : "理由 (必須)"
            }
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <button type="submit" className="fn-btn fn-btn-primary" disabled={busy}>
            <Icon name="check" size={13} aria-hidden />
            {busy ? "更新中…" : "モードを更新"}
          </button>
        </form>
      </section>

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
          メンテナンスモード
        </h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          現在: {props.isMaintenance === 1 ? "ON" : "OFF"}
        </p>
        <button
          type="button"
          className={`fn-btn fn-btn-sm ${props.isMaintenance === 1 ? "fn-btn-danger" : "fn-btn-ghost"}`}
          disabled={busy}
          onClick={() => {
            const next = props.isMaintenance === 1 ? 0 : 1;
            if (next === 1) {
              setMaintenanceConfirmOpen(true);
              return;
            }
            const fd = new FormData();
            fd.set("is_maintenance_mode", String(next));
            run(fd, setMaintenanceMode, "メンテナンス状態を更新しました。");
          }}
        >
          {props.isMaintenance === 1 ? "OFF にする" : "ON にする"}
        </button>
      </section>

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
          自動コストガード
        </h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          現在: {props.autoEnabled === 1 ? "有効" : "無効"}
        </p>
        <button
          type="button"
          className={`fn-btn fn-btn-sm ${props.autoEnabled === 1 ? "fn-btn-primary" : "fn-btn-ghost"}`}
          disabled={busy}
          onClick={() => {
            const next = props.autoEnabled === 1 ? 0 : 1;
            const fd = new FormData();
            fd.set("auto_cost_guard_enabled", String(next));
            run(fd, setAutoCostGuard, "自動コストガード設定を更新しました。");
          }}
        >
          {props.autoEnabled === 1 ? "無効化" : "有効化"}
        </button>
      </section>

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
          閾値
        </h2>
        <form
          onSubmit={onSubmitAdvanced}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <label className="fn-label">
            閾値 JSON
            <textarea
              className="fn-input"
              rows={3}
              value={thresholdsJson}
              onChange={(e) => setThresholdsJson(e.target.value)}
              maxLength={4000}
            />
          </label>
          <button type="submit" className="fn-btn fn-btn-ghost" disabled={busy}>
            詳細設定を保存
          </button>
        </form>
      </section>
      <ConfirmDialog
        open={maintenanceConfirmOpen}
        title="メンテナンスモードを ON にする"
        message="メンテナンスモードを ON にすると一般ユーザーは閲覧不可になります。続行しますか?"
        confirmLabel="ON にする"
        cancelLabel="キャンセル"
        tone="danger"
        onConfirm={() => {
          setMaintenanceConfirmOpen(false);
          const fd = new FormData();
          fd.set("is_maintenance_mode", "1");
          run(fd, setMaintenanceMode, "メンテナンス状態を更新しました。");
        }}
        onCancel={() => setMaintenanceConfirmOpen(false)}
      />
    </div>
  );
}
