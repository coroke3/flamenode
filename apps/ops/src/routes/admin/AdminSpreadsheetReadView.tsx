import * as React from "react";
import type { AdminSpreadsheetPageResponse, AdminSpreadsheetTableDef } from "@flamenode/contracts";
import type { OpsFetch } from "../../api/read.js";
import {
  loadSpreadsheetCatalog,
  loadSpreadsheetExport,
  loadSpreadsheetPage,
  type SpreadsheetReadResult,
} from "../../api/adminSpreadsheet.js";
import { AdminSpreadsheetDisabled } from "./AdminSpreadsheetDisabled.js";
import { AdminSpreadsheetEditableGrid } from "./AdminSpreadsheetEditableGrid.js";

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
  enableMutations = false,
}: {
  fetchFn?: OpsFetch;
  initialTable?: string;
  /** Explicit opt-in; not exposed by the router until MIG-0638/0726 gates pass. */
  enableMutations?: boolean;
}): React.ReactElement {
  const [catalog, setCatalog] = React.useState<CatalogState>({ status: "loading" });
  const [catalogOrigin, setCatalogOrigin] = React.useState<{ fetchFn: OpsFetch; initialTable?: string } | null>(null);
  const [selectedTable, setSelectedTable] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [reloadVersion, setReloadVersion] = React.useState(0);
  const [rows, setRows] = React.useState<PageState>({ status: "loading" });
  const [exportBusy, setExportBusy] = React.useState(false);
  const [exportMessage, setExportMessage] = React.useState<string | null>(null);
  const exportRef = React.useRef<AbortController | null>(null);
  const visibleContext = React.useRef({ fetchFn, initialTable, selectedTable, page });
  visibleContext.current = { fetchFn, initialTable, selectedTable, page };

  // Both initial/page reads and post-mutation reloads share one committed
  // context and request lease. A→B→A is not the same read generation.
  const catalogReady = catalog.status === "ready" && catalogOrigin?.fetchFn === fetchFn &&
    catalogOrigin.initialTable === initialTable;
  const pageContext = React.useMemo(() => ({
    fetchFn, initialTable, selectedTable, page, enableMutations, catalogReady, reloadVersion,
  }), [fetchFn, initialTable, selectedTable, page, enableMutations, catalogReady, reloadVersion]);
  const committedPageContext = React.useRef<typeof pageContext | null>(null);
  const pageReadRef = React.useRef<AbortController | null>(null);
  React.useLayoutEffect(() => {
    committedPageContext.current = pageContext;
    return () => {
      committedPageContext.current = null;
      pageReadRef.current?.abort();
      pageReadRef.current = null;
    };
  }, [pageContext]);

  const beginPageRead = React.useCallback((): AbortController | null => {
    if (committedPageContext.current !== pageContext || !pageContext.catalogReady ||
        !pageContext.selectedTable) return null;
    pageReadRef.current?.abort();
    const controller = new AbortController();
    pageReadRef.current = controller;
    return controller;
  }, [pageContext]);
  const isCurrentPageRead = React.useCallback((controller: AbortController): boolean =>
    committedPageContext.current === pageContext && pageReadRef.current === controller &&
    !controller.signal.aborted, [pageContext]);

  const commitPageRead = React.useCallback((
    controller: AbortController,
    result: SpreadsheetReadResult<AdminSpreadsheetPageResponse>,
  ): boolean => {
    if (!isCurrentPageRead(controller)) return false;
    if (result.status === "anonymous" || result.status === "forbidden" || result.status === "disabled") {
      // A current denial ends pending browser delivery; stale reads and transient failures do not.
      exportRef.current?.abort();
      exportRef.current = null;
      setExportBusy(false);
      setExportMessage(null);
    }
    setRows(result.status === "ok"
      ? { status: "ready", data: result.data }
      : { status: result.status });
    return true;
  }, [isCurrentPageRead]);

  async function refreshAfterMutation(): Promise<void> {
    const controller = beginPageRead();
    if (!controller) return;
    try {
      const result = await loadSpreadsheetPage(pageContext.fetchFn, pageContext.selectedTable,
        pageContext.page, controller.signal);
      if (!commitPageRead(controller, result)) return;
      if (result.status !== "ok") throw new Error("spreadsheet_reload_failed");
    } finally {
      if (pageReadRef.current === controller) pageReadRef.current = null;
    }
  }

  React.useEffect(() => {
    setExportBusy(false);
    setExportMessage(null);
    return () => {
      exportRef.current?.abort();
      exportRef.current = null;
    };
  }, [fetchFn, initialTable, selectedTable]);

  // Keep both browser delivery paths under the same async operation guard.
  async function exportDelimited(format: "csv" | "tsv", destination: "download" | "copy"): Promise<void> {
    if (!selectedTable || exportRef.current) return;
    const controller = new AbortController();
    exportRef.current = controller;
    const isCurrent = (): boolean => {
      const live = visibleContext.current;
      // Render-time context tracking closes the gap before cleanup; exports span all pages.
      return exportRef.current === controller && !controller.signal.aborted &&
        live.fetchFn === fetchFn && live.initialTable === initialTable && live.selectedTable === selectedTable;
    };
    if (!isCurrent()) {
      exportRef.current = null;
      return;
    }
    setExportBusy(true);
    setExportMessage(null);
    try {
      const result = await loadSpreadsheetExport(fetchFn, selectedTable, format, controller.signal);
      if (!isCurrent()) return;
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
        if (!isCurrent()) return;
        let copied = false;
        try {
          await navigator.clipboard.writeText(body);
          copied = true;
        } catch {
          if (!isCurrent()) return;
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
        if (!isCurrent()) return;
        if (!copied) {
          setExportMessage("クリップボードへのコピーに失敗しました。");
          return;
        }
        setExportMessage(result.data.truncated
          ? "クリップボードにコピーしました（件数上限で一部のみ）"
          : "クリップボードにコピーしました。");
        return;
      }
      if (!isCurrent()) return;
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
      if (!isCurrent()) return;
      setExportMessage(result.data.truncated
        ? "件数またはサイズ上限により一部のデータのみ保存しました。"
        : `${format.toUpperCase()} をダウンロードしました。`);
    } catch {
      if (isCurrent()) setExportMessage("エクスポートに失敗しました。");
    } finally {
      const current = isCurrent();
      if (exportRef.current === controller) {
        exportRef.current = null;
        if (current) setExportBusy(false);
      }
    }
  }

  React.useEffect(() => {
    const controller = new AbortController();
    setCatalogOrigin(null);
    setCatalog({ status: "loading" });
    // Identity/transport changes must never keep rows from an earlier session visible.
    setRows({ status: "loading" });
    void loadSpreadsheetCatalog(fetchFn, false, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setCatalogOrigin({ fetchFn, initialTable });
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
    const controller = beginPageRead();
    if (!controller) return;
    setRows({ status: "loading" });
    void loadSpreadsheetPage(pageContext.fetchFn, pageContext.selectedTable, pageContext.page,
      controller.signal).then((result) => {
      commitPageRead(controller, result);
    }).finally(() => {
      if (pageReadRef.current === controller) pageReadRef.current = null;
    });
    return () => {
      controller.abort();
      if (pageReadRef.current === controller) pageReadRef.current = null;
    };
  }, [pageContext, beginPageRead, commitPageRead]);

  // Render-time origin verification prevents even a transient old-session paint
  // before the effect can clear state on a changed fetch function or URL selection.
  if (!catalogOrigin || catalogOrigin.fetchFn !== fetchFn || catalogOrigin.initialTable !== initialTable) {
    return <p role="status">テーブルを読み込み中…</p>;
  }
  if (catalog.status === "disabled" || rows.status === "disabled") return <AdminSpreadsheetDisabled />;
  if (catalog.status !== "ready") {
    return <p role="status">{catalog.status === "loading" ? "テーブルを読み込み中…" : failureMessage(catalog.status)}</p>;
  }
  const active = catalog.tables.find((t) => t.table === selectedTable);
  const data = rows.status === "ready" && rows.data.def.table === selectedTable && rows.data.page === page ? rows.data : null;
  return (
    <section aria-labelledby="ops-spreadsheet-title">
      <h1 id="ops-spreadsheet-title">DB スプレッドシート</h1>
      <p>{enableMutations ? "編集機能は移行検証中です。管理者権限と機能設定が必要です。" : "データの確認専用です。編集・インポート操作は移行準備中です。"}</p>
      <nav aria-label="テーブル一覧">
        {catalog.tables.map((item) => (
          <button type="button" key={item.table} aria-pressed={item.table === selectedTable}
            onClick={() => {
              // Selecting the same table and page cannot schedule another GET.
              // Keep existing rows, export and any live editor draft in place.
              if (item.table === selectedTable && page === 1) return;
              exportRef.current?.abort(); exportRef.current = null;
              setExportBusy(false); setExportMessage(null); setRows({ status: "loading" });
              setSelectedTable(item.table); setPage(1);
            }}>
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
          {/* Explicit read retry uses the same committed page lease. A ready
              editable grid must not be unmounted by a reload until its draft
              and mutation lifecycle is reconciled with CURRENT. */}
          {!enableMutations || !data || active.mode === "readonly" ? (
            <button type="button" disabled={rows.status === "loading"}
              onClick={() => { setRows({ status: "loading" }); setReloadVersion(n => n + 1); }}>
              再読込
            </button>
          ) : null}
          {data ? (
            <>
              <p>ページ {data.page} ・ {data.limit} 件/ページ ・ {enableMutations ? "編集可能列のみ操作可" : "読み取り専用"}</p>
              {data.truncated ? <p role="status">一部の行が表示上限により省略されました。</p> : null}
              {enableMutations ? (
                <AdminSpreadsheetEditableGrid data={data} fetchFn={fetchFn}
                  onRefresh={refreshAfterMutation} allowMutations={true} />
              ) : (
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
              )}
              {data.rows.length === 0 ? <p>データがありません。</p> : null}
              <div>
                <button type="button" disabled={page <= 1} onClick={() => { setRows({ status: "loading" }); setPage((n) => Math.max(1, n - 1)); }}>前へ</button>
                <button type="button" disabled={!data.hasMore} onClick={() => { setRows({ status: "loading" }); setPage((n) => n + 1); }}>次へ</button>
              </div>
            </>
          ) : <p role="status">{rows.status === "loading" ? "読み込み中…" : failureMessage(rows.status)}</p>}
        </div>
      ) : <p>テーブルがありません。</p>}
    </section>
  );
}
