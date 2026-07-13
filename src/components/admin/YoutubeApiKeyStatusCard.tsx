import * as React from "react";
import {
  type YoutubeApiKeyLabel,
  type YoutubeApiKeyRuntimeStatus,
} from "@/lib/admin/youtubeApiKeyStatus";
import { formatRelative, formatUnix } from "@/lib/utils/format";

type CardLevel = "ok" | "warn" | "critical" | "unknown";

function keyLabel(value: YoutubeApiKeyLabel | null): string {
  if (value === "primary") return "主キー";
  if (value === "secondary") return "副キー";
  return "未確認";
}

function badgeClass(level: CardLevel): string {
  if (level === "critical") return "fn-badge-danger";
  if (level === "warn") return "fn-badge-warning";
  if (level === "ok") return "fn-badge-accent";
  return "fn-badge-soft";
}

function levelLabel(level: CardLevel): string {
  if (level === "critical") return "要対応";
  if (level === "warn") return "注意";
  if (level === "ok") return "正常";
  return "未確認";
}

function cardStyle(level: CardLevel): React.CSSProperties {
  if (level === "critical") {
    return {
      background: "var(--accent-danger-soft, #fee2e2)",
      borderColor: "var(--accent-danger, #dc2626)",
      color: "var(--accent-danger, #991b1b)",
    };
  }
  if (level === "warn" || level === "unknown") {
    return {
      background: "var(--accent-warning-soft, #fef3c7)",
      borderColor: "var(--accent-warning, #d97706)",
      color: "var(--accent-warning, #92400e)",
    };
  }
  return {
    background: "var(--accent-success-soft, #dcfce7)",
    borderColor: "var(--accent-success, #16a34a)",
    color: "var(--accent-success, #166534)",
  };
}

function statusLevel(
  status: YoutubeApiKeyRuntimeStatus | null,
  now: number,
): CardLevel {
  if (!status) return "unknown";
  if (status.lastFailureKind === "quota") return "critical";
  const disabled = (["primary", "secondary"] as const).some(
    (label) => Number(status.disabledUntil[label] ?? 0) > now,
  );
  if (disabled || status.activeKey === "secondary") return "warn";
  if (status.configured.length >= 2 && status.activeKey === "primary") {
    return "ok";
  }
  return "unknown";
}

export function YoutubeApiKeyStatusCard({
  status,
  now,
}: {
  status: YoutubeApiKeyRuntimeStatus | null;
  now: number;
}): React.ReactElement {
  const level = statusLevel(status, now);
  const disabledKeys = status
    ? (["primary", "secondary"] as const).filter(
        (label) => Number(status.disabledUntil[label] ?? 0) > now,
      )
    : [];

  return (
    <section
      className="fn-card"
      style={{
        marginTop: 24,
        padding: 16,
        borderWidth: 1,
        borderStyle: "solid",
        ...cardStyle(level),
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>
            YouTube APIキー冗長化
          </h2>
          <p style={{ margin: "5px 0 0", fontSize: 13 }}>
            {status
              ? `登録 ${status.configured.length}個 / 使用中 ${keyLabel(status.activeKey)}`
              : "同期Workerから状態がまだ記録されていません。"}
          </p>
        </div>
        <span className={`fn-badge ${badgeClass(level)}`}>
          {levelLabel(level)}
        </span>
      </div>

      {status ? (
        <div className="fn-muted fn-text-sm" style={{ marginTop: 10 }}>
          <div>
            直近切替: {status.lastFailoverAt == null
              ? "なし"
              : `${formatRelative(status.lastFailoverAt)} (${keyLabel(status.lastFailoverFrom)}から)`}
          </div>
          <div>
            一時回避: {disabledKeys.length === 0
              ? "なし"
              : disabledKeys
                  .map(
                    (label) =>
                      `${keyLabel(label)} (${formatUnix(status.disabledUntil[label])}まで)`,
                  )
                  .join(" / ")}
          </div>
          <div>
            状態更新: {status.updatedAt == null
              ? "未確認"
              : formatRelative(status.updatedAt)}
          </div>
          {status.lastFailureKind ? (
            <div>
              直近障害: {status.lastFailureKind}
              {status.lastFailureReason
                ? ` / ${status.lastFailureReason}`
                : ""}
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="fn-muted fn-text-sm" style={{ margin: "10px 0 0" }}>
        副キーはcredential障害時だけ使用します。quota超過時は切り替えず、Google Cloud Consoleの割当量を正本として確認します。
      </p>
    </section>
  );
}
