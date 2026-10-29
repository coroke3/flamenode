/** MIG-0736 U01: CURRENT DiagnosticStatusResults port, without Next router. */
import * as React from "react";
import type { AdminHealthResponse } from "@flamenode/contracts";
import { FnTable } from "../../components/shared/FnTable.js";

export type DiagnosticFilter = "all" | "warn" | "info" | "ok";
export type DiagnosticResult = AdminHealthResponse["results"][number];
type DiagnosticKind = "health" | "security";
const FILTERS: readonly [DiagnosticFilter, string][] = [
  ["all", "すべて"], ["warn", "WARN"], ["info", "INFO"], ["ok", "OK"],
];

export function normalizeDiagnosticFilter(value: string | null | undefined): DiagnosticFilter {
  return value === "warn" || value === "info" || value === "ok" ? value : "all";
}

function badgeClass(status: DiagnosticResult["status"], kind: DiagnosticKind): string {
  return status === "ok" ? "fn-badge-accent"
    : status === "info" ? (kind === "health" ? "fn-badge-neutral" : "fn-badge-soft")
    : "fn-badge-warning";
}

export function DiagnosticStatusResults({
  kind, results, initialFilter = "all", onRefresh,
}: {
  kind: DiagnosticKind;
  results: DiagnosticResult[];
  initialFilter?: DiagnosticFilter;
  onRefresh: () => void;
}): React.ReactElement {
  const [filter, setFilter] = React.useState<DiagnosticFilter>(initialFilter);
  // Browser back/forward changes ?status= without fetching from D1 again.
  React.useEffect(() => setFilter(initialFilter), [initialFilter]);

  const counts = React.useMemo(() => ({
    all: results.length,
    warn: results.filter((result) => result.status === "warn").length,
    info: results.filter((result) => result.status === "info").length,
    ok: results.filter((result) => result.status === "ok").length,
  }), [results]);
  const visible = React.useMemo(
    () => filter === "all" ? results : results.filter((result) => result.status === filter),
    [results, filter],
  );

  return (
    <>
      <nav aria-label="状態フィルタ" style={{ marginTop: 16, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {FILTERS.map(([key, label]) => (
          <button
            key={key} type="button"
            className={`fn-btn fn-btn-sm ${filter === key ? "fn-btn-primary" : "fn-btn-ghost"}`}
            aria-pressed={filter === key} onClick={() => setFilter(key)}
          >
            {label} ({counts[key]})
          </button>
        ))}
      </nav>
      <div style={{ marginTop: 10 }}>
        <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" onClick={onRefresh}>
          最新状態を再チェック
        </button>
      </div>
      <div role="status" style={{
        marginTop: 14, padding: "10px 14px",
        background: counts.warn > 0
          ? (kind === "security" ? "var(--accent-danger-soft, #fee2e2)" : "var(--accent-warning-soft, #fef3c7)")
          : "var(--accent-success-soft, #dcfce7)",
        border: `1px solid ${counts.warn > 0
          ? (kind === "security" ? "var(--accent-danger, #dc2626)" : "var(--accent-warning, #d97706)")
          : "var(--accent-success, #16a34a)"}`,
        borderRadius: "var(--radius-md)",
        color: counts.warn > 0
          ? (kind === "security" ? "var(--accent-danger, #991b1b)" : "var(--accent-warning, #92400e)")
          : "var(--accent-success, #166534)",
        fontSize: 13,
      }}>
        {counts.warn > 0
          ? <><strong>{kind === "security" ? "セキュリティ " : ""}WARN {counts.warn} 件</strong>
              {kind === "security" ? " — 漏洩・権限矛盾の可能性。一覧を確認してください。" : " が検出されています。一覧から確認してください。"}</>
          : <>{kind === "security" ? "セキュリティ " : ""}WARN はありません ({counts.ok} 件 OK, {counts.info} 件 INFO)。</>}
      </div>
      <section style={{ marginTop: 22 }}>
        <FnTable>
          <thead>
            <tr><th>チェック項目</th><th>状態</th><th>件数</th>
              <th>{kind === "security" ? "サンプル / 備考" : "サンプル (最大5件)"}</th></tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                フィルタ条件に該当する項目はありません。
              </td></tr>
            ) : null}
            {visible.map((result) => (
              <tr key={result.id}>
                <td>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{result.label}</div>
                  {kind === "health" && result.note ? (
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{result.note}</div>
                  ) : null}
                </td>
                <td><span className={`fn-badge ${badgeClass(result.status, kind)}`}>
                  {result.status === "ok" ? "OK" : result.status === "info" ? "INFO" : "WARN"}
                </span></td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>
                  {kind === "security" && result.status === "info" ? "—" : result.count}
                </td>
                <td>
                  {kind === "security" && result.note ? (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{result.note}</span>
                  ) : result.samples.length === 0 ? (
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
                  ) : (
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 11, lineHeight: 1.6 }}>
                      {result.samples.map((sample, i) => (
                        <li key={i} style={{ fontFamily: "monospace" }}>{sample}</li>
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
