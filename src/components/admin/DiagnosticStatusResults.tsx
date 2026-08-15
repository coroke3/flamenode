"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FnTable } from "@/components/ui/FnTable";

export type DiagnosticStatus = "ok" | "warn" | "info";
export type DiagnosticFilter = "all" | DiagnosticStatus;

export type DiagnosticStatusResult = {
  id: string;
  label: string;
  status: DiagnosticStatus;
  count: number;
  samples: string[];
  note?: string;
};

type Props = {
  kind: "health" | "security";
  results: DiagnosticStatusResult[];
  initialFilter?: DiagnosticFilter;
};

const FILTERS: readonly [DiagnosticFilter, string][] = [
  ["all", "すべて"],
  ["warn", "WARN"],
  ["info", "INFO"],
  ["ok", "OK"],
];

function statusLabel(status: DiagnosticStatus): string {
  return status === "ok" ? "OK" : status === "info" ? "INFO" : "WARN";
}

function statusBadgeClass(
  status: DiagnosticStatus,
  kind: Props["kind"],
): string {
  return status === "ok"
    ? "fn-badge-accent"
    : status === "info"
      ? kind === "health"
        ? "fn-badge-neutral"
        : "fn-badge-soft"
      : "fn-badge-warning";
}

function normalizeFilter(value: DiagnosticFilter | undefined): DiagnosticFilter {
  return value === "warn" || value === "info" || value === "ok" ? value : "all";
}

export function DiagnosticStatusResults({
  kind,
  results,
  initialFilter,
}: Props): React.ReactElement {
  const router = useRouter();
  const [filter, setFilter] = React.useState<DiagnosticFilter>(
    normalizeFilter(initialFilter),
  );
  // Next.js may preserve this client component while navigating between
  // server-rendered `?status=` URLs (for example browser back/forward). Keep
  // the visible filter aligned with the newest server-provided initial value
  // without issuing another D1 query.
  React.useEffect(() => {
    setFilter(normalizeFilter(initialFilter));
  }, [initialFilter]);
  const counts = React.useMemo(
    () => ({
      all: results.length,
      warn: results.filter((result) => result.status === "warn").length,
      info: results.filter((result) => result.status === "info").length,
      ok: results.filter((result) => result.status === "ok").length,
    }),
    [results],
  );
  const visible = React.useMemo(
    () =>
      filter === "all"
        ? results
        : results.filter((result) => result.status === filter),
    [filter, results],
  );

  return (
    <>
      <nav
        aria-label="状態フィルタ"
        style={{
          marginTop: 16,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`fn-btn fn-btn-sm ${filter === key ? "fn-btn-primary" : "fn-btn-ghost"}`}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label} ({counts[key]})
          </button>
        ))}
      </nav>

      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          onClick={() => router.refresh()}
        >
          最新状態を再チェック
        </button>
      </div>

      {counts.warn > 0 ? (
        <div
          role="status"
          style={{
            marginTop: 14,
            padding: "10px 14px",
            background:
              kind === "security"
                ? "var(--accent-danger-soft, #fee2e2)"
                : "var(--accent-warning-soft, #fef3c7)",
            border: `1px solid ${kind === "security" ? "var(--accent-danger, #dc2626)" : "var(--accent-warning, #d97706)"}`,
            borderRadius: "var(--radius-md)",
            color:
              kind === "security"
                ? "var(--accent-danger, #991b1b)"
                : "var(--accent-warning, #92400e)",
            fontSize: 13,
          }}
        >
          <strong>
            {kind === "security" ? "セキュリティ " : ""}WARN {counts.warn} 件
          </strong>
          {kind === "security"
            ? " — 漏洩・権限矛盾の可能性。一覧を確認してください。"
            : " が検出されています。一覧から確認してください。"}
        </div>
      ) : (
        <div
          role="status"
          style={{
            marginTop: 14,
            padding: "10px 14px",
            background: "var(--accent-success-soft, #dcfce7)",
            border: "1px solid var(--accent-success, #16a34a)",
            borderRadius: "var(--radius-md)",
            color: "var(--accent-success, #166534)",
            fontSize: 13,
          }}
        >
          {kind === "security" ? "セキュリティ " : ""}WARN はありません (
          {counts.ok} 件 OK, {counts.info} 件 INFO)。
        </div>
      )}

      <section style={{ marginTop: 22 }}>
        <FnTable>
          <thead>
            <tr>
              <th>チェック項目</th>
              <th>状態</th>
              <th>件数</th>
              <th>{kind === "security" ? "サンプル / 備考" : "サンプル (最大5件)"}</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{
                    padding: 16,
                    textAlign: "center",
                    color: "var(--text-muted)",
                    fontSize: 12,
                  }}
                >
                  フィルタ条件に該当する項目はありません。
                </td>
              </tr>
            ) : null}
            {visible.map((result) => (
              <tr key={result.id}>
                <td>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{result.label}</div>
                  {kind === "health" && result.note ? (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        marginTop: 2,
                      }}
                    >
                      {result.note}
                    </div>
                  ) : null}
                </td>
                <td>
                  <span className={`fn-badge ${statusBadgeClass(result.status, kind)}`}>
                    {statusLabel(result.status)}
                  </span>
                </td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>
                  {kind === "security" && result.status === "info"
                    ? "—"
                    : result.count}
                </td>
                <td>
                  {kind === "security" && result.note ? (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {result.note}
                    </span>
                  ) : result.samples.length === 0 ? (
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
                  ) : (
                    <ul
                      style={{
                        margin: 0,
                        padding: 0,
                        listStyle: "none",
                        fontSize: 11,
                        lineHeight: 1.6,
                      }}
                    >
                      {result.samples.map((sample, index) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <li key={index} style={{ fontFamily: "monospace" }}>
                          {sample}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </FnTable>
      </section>
    </>
  );
}
