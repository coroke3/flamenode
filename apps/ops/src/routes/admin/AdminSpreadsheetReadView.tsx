import * as React from "react";
import type { AdminSpreadsheetPageResponse, AdminSpreadsheetTableDef } from "@flamenode/contracts";
import type { OpsFetch } from "../../api/read.js";
import {
  loadSpreadsheetCatalog,
  loadSpreadsheetExport,
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
  const [exportBusy, setExportBusy] = React.useState(false);
  const [exportMessage, setExportMessage] = React.useState<string | null>(null);
  const exportRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => exportRef.current?.abort(), [selectedTable]);

  async function exportDelimited(format: "csv" | "tsv", destination: "download" | "copy"): Promise<void> {
    if (!selectedTable || exportRef.current) return;
    const controller = new AbortController();
    exportRef.current = controller;
    setExportBusy(true);
    setExportMessage(null);
    try {
      const result = await loadSpreadsheetExport(fetchFn, selectedTable, format, controller.signal);
      if (controller.signal.aborted) return;
      if (result.status === "disabled") {
        setCatalog({ status: "disabled" });
        return;
      }
      if (result.status !== "ok") {
        setExportMessage(failureMessage(result.status));
        return;
      }
      if (destination === "copy") {
        const body = await result.data.blob.text();
        if (controller.signal.aborted) return;
        let copied = false;
        try {
          await navigator.clipboard.writeText(body);
          copied = true;
        } catch {
          // Matches CURRENT's fallback for browsers without Clipboard API grants.
          const textarea = document.createElement("textarea");
          textarea.value = body;
          textarea.readOnly = true;
          textarea.style.position = "fixed";
          textarea.style.left = "-9999px";
          document.body.append(textarea);
          try {
            textarea.select();
            copied = document.execCommand("copy");
          } catch {
            copied = false;
          } finally {
            textarea.remove();
          }
        }
        if (!copied) {
          setExportMessage("クリップボードへのコピーに失敗しました。");
          return;
        }
        setExportMessage(result.data.truncated
          ? "クリップボードにコピーしました（件数上限で一部のみ）"
          : "クリップボードにコピーしました。");
        return;
      }
      // No remote filename is trusted: the table ID is sanitized before download.
      const safeName = selectedTable.replace(/[^A-Za-z0-9_-]/g, "_");
      const name = `${safeName}${result.data.truncated ? "-partial" : ""}.${format}`;
      const objectUrl = URL.createObjectURL(result.data.blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = name;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      setExportMessage(result.data.truncated
        ? "件数またはサイズ上限により一部のデータのみ保存しました。"
        : `${format.toUpperCase()} をダウンロードしました。`);
    } catch {
      if (!controller.signal.aborted) setExportMessage("エクスポートに失敗しました。");
    } finally {
      if (exportRef.current === controller) {
        exportRef.current = null;
        if (!controller.signal.aborted) setExportBusy(false);
      }
    }
  }

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
            onClick={() => { exportRef.current?.abort(); exportRef.current = null; setExportBusy(false); setExportMessage(null); setRows({ status: "loading" }); setSelectedTable(item.table); setPage(1); }}>
            {item.label} ({item.mode === "readonly" ? "RO" : "RW"})
          </button>
        ))}
      </nav>
      {active ? (
        <div aria-live="polite">
          <h2>{active.label}</h2>
          <div role="toolbar" aria-label="CSV / TSV エクスポート">
            <button type="button" disabled={exportBusy} onClick={() => void exportDelimited("csv", "download")}>CSV ダウンロード</button>
            <button type="button" disabled={exportBusy} onClick={() => void exportDelimited("tsv", "download")}>TSV ダウンロード</button>
            <button type="button" disabled={exportBusy} onClick={() => void exportDelimited("csv", "copy")}>コピー (CSV)</button>
          </div>
          {exportMessage ? <p role="status">{exportMessage}</p> : null}
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
