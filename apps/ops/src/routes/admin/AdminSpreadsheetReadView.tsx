import * as React from "react";
import type { AdminSpreadsheetPageResponse, AdminSpreadsheetTableDef } from "@flamenode/contracts";
import type { OpsFetch } from "../../api/read.js";
import {
  loadSpreadsheetCatalog,
  loadSpreadsheetPage,
} from "../../api/adminSpreadsheet.js";
import { AdminSpreadsheetDisabled } from "./AdminSpreadsheetDisabled.js";

type CatalogState =
  | { status: "loading" }
  | { status: "ready"; tables: AdminSpreadsheetTableDef[] }
  | { status: "disabled" | "anonymous" | "forbidden" | "unavailable" | "notFound" | "unsupported" };

type PageState =
  | { status: "loading" }
  | { status: "ready"; data: AdminSpreadsheetPageResponse }
  | { status: "unavailable" | "disabled" | "anonymous" | "forbidden" | "notFound" | "unsupported" };

function failureMessage(status: string): string {
  if (status === "anonymous") return "ログインが必要です。";
  if (status === "forbidden") return "管理者権限が必要です。";
  if (status === "notFound") return "テーブルが見つかりません。";
  return "データを取得できませんでした。再読み込みしてください。";
}

/** Read-only Ops projection. Writes, import and router mounting await MIG-0737 U01–U03 parity. */
export function AdminSpreadsheetReadView({
  fetchFn = fetch,
  initialTable,
}: {
  fetchFn?: OpsFetch;
  initialTable?: string;
}): React.ReactElement {
  const [catalog, setCatalog] = React.useState<CatalogState>({ status: "loading" });
  const [selectedTable, setSelectedTable] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [rows, setRows] = React.useState<PageState>({ status: "loading" });

  React.useEffect(() => {
    const controller = new AbortController();
    setCatalog({ status: "loading" });
    void loadSpreadsheetCatalog(fetchFn, false, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.status !== "ok") {
        setCatalog({ status: result.status });
        return;
      }
      const tables = result.data.tables;
      setCatalog({ status: "ready", tables });
      setSelectedTable(tables.some((t) => t.table === initialTable)
        ? initialTable! : (tables[0]?.table ?? ""));
      setPage(1);
    });
    return () => controller.abort();
  }, [fetchFn, initialTable]);

  React.useEffect(() => {
    if (catalog.status !== "ready" || !selectedTable) return;
    const controller = new AbortController();
    setRows({ status: "loading" });
    void loadSpreadsheetPage(fetchFn, selectedTable, page, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setRows(result.status === "ok"
        ? { status: "ready", data: result.data }
        : { status: result.status });
    });
    return () => controller.abort();
  }, [fetchFn, catalog.status, selectedTable, page]);

  if (catalog.status === "disabled" || rows.status === "disabled") return <AdminSpreadsheetDisabled />;
  if (catalog.status !== "ready") {
    return <p role="status">{catalog.status === "loading" ? "テーブルを読み込み中…" : failureMessage(catalog.status)}</p>;
  }
  const active = catalog.tables.find((t) => t.table === selectedTable);
  const data = rows.status === "ready" && rows.data.def.table === selectedTable ? rows.data : null;
  return (
    <section aria-labelledby="ops-spreadsheet-title">
      <h1 id="ops-spreadsheet-title">DB スプレッドシート</h1>
      <p>データの確認専用です。編集・インポート操作は移行準備中です。</p>
      <nav aria-label="テーブル一覧">
        {catalog.tables.map((item) => (
          <button type="button" key={item.table} aria-pressed={item.table === selectedTable}
            onClick={() => { setRows({ status: "loading" }); setSelectedTable(item.table); setPage(1); }}>
            {item.label} ({item.mode === "readonly" ? "RO" : "RW"})
          </button>
        ))}
      </nav>
      {active ? (
        <div aria-live="polite">
          <h2>{active.label}</h2>
          {data ? (
            <>
              <p>ページ {data.page} ・ {data.limit} 件/ページ ・ 読み取り専用</p>
              {data.truncated ? <p role="status">一部の行が表示上限により省略されました。</p> : null}
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr>{data.columns.map((column) => <th key={column.name} scope="col">{column.name}</th>)}</tr></thead>
                  <tbody>
                    {data.rows.map((row, i) => (
                      <tr key={i}>{data.columns.map((column) => (
                        <td key={column.name}>{row[column.name] == null ? "" :
                          typeof row[column.name] === "object"
                            ? JSON.stringify(row[column.name]) : String(row[column.name])}</td>
                      ))}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.rows.length === 0 ? <p>データがありません。</p> : null}
              <div>
                <button type="button" disabled={page <= 1} onClick={() => setPage((n) => Math.max(1, n - 1))}>前へ</button>
                <button type="button" disabled={!data.hasMore} onClick={() => { setRows({ status: "loading" }); setPage((n) => n + 1); }}>次へ</button>
              </div>
            </>
          ) : <p role="status">{rows.status === "loading" ? "読み込み中…" : failureMessage(rows.status)}</p>}
        </div>
      ) : <p>テーブルがありません。</p>}
    </section>
  );
}
