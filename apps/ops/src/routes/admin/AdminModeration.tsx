/** MIG-0731 U03a: unmounted moderation read-only candidate pending SA-044 parity. */
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import type { AdminModerationResponse } from "@flamenode/contracts";
import type { OpsResult } from "../../api/read.js";
import {
  createAdminModerationApi, moderationFilters, type ModerationFilters,
} from "../../api/adminModeration.js";
import { useApiResult } from "../useApiResult.js";
import { ModerationCaseStatusForm } from "./ModerationCaseStatusForm.js";
import { ModerationFlashNotice } from "./ModerationFlashNotice.js";

const api = createAdminModerationApi();
const typeOptions = ["all", "x_reapply", "void", "duplicate", "rights", "operator"] as const;
const statusOptions = ["all", "open", "resolved", "rejected", "expired", "cancelled"] as const;

function formatSeconds(value: number | null): string {
  if (value === null) return "—";
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ja-JP");
}

/** CURRENT AutoSubmitSelect / AutoSubmitCheckbox parity for GET filters. */
export function requestModerationFilterSubmit(form: Pick<HTMLFormElement, "requestSubmit"> | null): void {
  form?.requestSubmit();
}

/** Complete the flash transition only for an authorized, non-aborted GET success.
 * useApiResult preserves old data during same-key refresh, so refreshKey alone
 * would display the flash before the network response has finished.
 */
export function onModerationReadCompleted(
  signal: Pick<AbortSignal, "aborted">,
  result: OpsResult<AdminModerationResponse>,
  showNotice: () => void,
): void {
  if (!signal.aborted && result.status === "ok") showNotice();
}


/** React Router GET-filter transport; no document reload of the Ops SPA. */
export function moderationGetSearchParams(formData: FormData): URLSearchParams {
  const next = new URLSearchParams();
  for (const name of ["type", "status"] as const) {
    const value = formData.get(name);
    if (typeof value === "string") next.set(name, value);
  }
  if (formData.get("overdue") === "1") next.set("overdue", "1");
  return next;
}

export function AdminModerationContent({ data, filters, onSaved, onFilterChange }: {
  data: AdminModerationResponse; filters: ModerationFilters; onSaved?: () => void;
  onFilterChange?: (params: URLSearchParams) => void;
}): React.ReactElement {
  return <div className="fn-public-container fn-page">
    <header className="fn-page-head">
      <h1 className="fn-page-title">モデレーション</h1>
      <p>重複、権利、void、X ID再申請などのケースを最大100件表示します。</p>
    </header>
    <form method="get" action="/admin/moderation"
      key={filters.type + ":" + filters.status + ":" + filters.overdue}
      onSubmit={(event) => {
        if (!onFilterChange) return; // pure-view fallback: native GET navigation
        event.preventDefault();
        onFilterChange(moderationGetSearchParams(new FormData(event.currentTarget)));
      }}
      style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
      <label>種別 <select name="type" defaultValue={filters.type} className="fn-select"
          onChange={(event) => requestModerationFilterSubmit(event.currentTarget.form)}>
        {typeOptions.map((t) => <option key={t} value={t}>{t === "all" ? "type すべて" : t}</option>)}
      </select></label>
      <label>状態 <select name="status" defaultValue={filters.status} className="fn-select"
          onChange={(event) => requestModerationFilterSubmit(event.currentTarget.form)}>
        {statusOptions.map((s) => <option key={s} value={s}>{s === "all" ? "status すべて" : s}</option>)}
      </select></label>
      <label className="fn-btn fn-btn-ghost fn-btn-sm">
        <input type="checkbox" name="overdue" value="1" defaultChecked={filters.overdue}
          onChange={(event) => requestModerationFilterSubmit(event.currentTarget.form)} />
        期限切れのみ
      </label>
      <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm">絞り込み</button>
    </form>
    <div style={{ overflowX: "auto", marginTop: 18 }}>
      <table className="fn-table" style={{ width: "100%" }}>
        <thead><tr>
          <th>状態</th><th>作品</th><th>種別</th><th>期限/ロック</th>
          <th>関連X ID</th><th>理由/メモ</th><th>操作</th>
        </tr></thead>
        <tbody>{data.cases.map((row) => {
          const overdue = row.status === "open" && row.due_at !== null && row.due_at < data.now;
          return <tr key={row.id}>
            <td><span className={overdue ? "fn-badge fn-badge-danger" : "fn-badge"}>
              {row.status}</span><small style={{ display: "block" }}>attempt {row.attempt_count}</small></td>
            <td><a href={"/admin/videos/" + encodeURIComponent(row.video_id)}>
              {row.video_title ?? row.video_id}</a>
              <small style={{ display: "block" }}>{row.video_status ?? "video missing"}</small></td>
            <td><code>{row.case_type}</code></td>
            <td><small>due: {formatSeconds(row.due_at)}</small>
              <small style={{ display: "block" }}>lock: {formatSeconds(row.locked_until)}</small></td>
            <td>{row.related_x_user_id ?
              <a href={"/user/" + encodeURIComponent(row.related_x_user_id)}>
                {"@" + row.related_x_user_id}</a> : "—"}
              {row.related_x_name ? <small style={{ display: "block" }}>{row.related_x_name}</small> : null}</td>
            <td><details><summary>理由とメモ</summary>
              <p style={{ whiteSpace: "pre-wrap" }}>公開理由: {row.public_reason || "—"}</p>
              <p style={{ whiteSpace: "pre-wrap" }}>内部メモ: {row.private_note || "—"}</p>
            </details></td>
            <td>{row.status === "open"
              ? onSaved
                ? <ModerationCaseStatusForm caseId={row.id} onSaved={onSaved} />
                : <span aria-label="未移植操作">更新操作は未移植</span>
              : <a href={"/admin/audit?table=video_moderation_cases&record=" +
                  encodeURIComponent(row.id)}>監査</a>}</td>
          </tr>;
        })}{data.cases.length === 0 ?
          <tr><td colSpan={7}>該当するケースはありません。</td></tr> : null}</tbody>
      </table>
    </div>
  </div>;
}

/** Not mounted: case updates have no approved Hono SA-044 counterpart. */
export function AdminModeration(): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [successfulReadKey, setSuccessfulReadKey] = React.useState(0);
  const filters = moderationFilters(params);
  const key = params.toString();
  const result = useApiResult(async (signal) => {
    const response = await api.list(filters, signal);
    onModerationReadCompleted(signal, response, () => setSuccessfulReadKey((value) => value + 1));
    return response;
  }, "admin-moderation:" + key, refreshKey);
  React.useEffect(() => {
    if (result.status === "anonymous") window.location.assign("/entry");
    if (result.status === "forbidden") window.location.assign(result.redirect || "/dashboard");
  }, [result]);
  if (result.status === "loading" || result.status === "anonymous" || result.status === "forbidden")
    return <div role="status" aria-busy="true">読み込み中...</div>;
  if (result.status !== "ok") return <section role="alert">モデレーション情報を取得できませんでした。</section>;
  return <>
    <ModerationFlashNotice refreshKey={successfulReadKey} />
    <AdminModerationContent data={result.data} filters={filters}
      onSaved={() => setRefreshKey((value) => value + 1)}
      onFilterChange={(next) => setParams(next)} />
  </>;
}
