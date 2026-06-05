"use client";

import * as React from "react";
import {
  buildPrimaryKeyFromDisplayRow,
  buildSpreadsheetInsertPayload,
  getPrimaryKeyIssue,
  validatePrimaryKeyFromDisplayRow,
} from "@/lib/admin/spreadsheet/validation";
import {
  deleteSpreadsheetRow as apiDeleteRow,
  fetchSpreadsheetCatalog,
  fetchSpreadsheetPage,
  insertSpreadsheetRow as apiInsertRow,
  patchSpreadsheetCell,
  spreadsheetUserMessage,
} from "./spreadsheetApi";
import { formatPrimaryKeyIssue } from "./spreadsheetClientUtils";
import {
  createEmptyHistoryStacks,
  createHistoryEntry,
  popRedo,
  popUndo,
  pushUndoEntry,
  valuesEqual,
  type SpreadsheetCellChange,
  type SpreadsheetHistoryEntry,
  type SpreadsheetHistoryStacks,
} from "./spreadsheetHistory";
import { formatSpreadsheetCellValue } from "@/lib/admin/spreadsheet/cellFormat";
import { findRowIndexByPrimaryKey } from "@/lib/admin/spreadsheet/validation";
import type { SpreadsheetPageData, SpreadsheetTableDef } from "./spreadsheetTypes";

export function useAdminSpreadsheet(initialTable?: string) {
  const [tables, setTables] = React.useState<SpreadsheetTableDef[]>([]);
  const [groups, setGroups] = React.useState<Record<string, SpreadsheetTableDef[]>>(
    {},
  );
  const [schemaNotice, setSchemaNotice] = React.useState<string | null>(null);
  const [tablesLoading, setTablesLoading] = React.useState(false);
  const [activeTable, setActiveTable] = React.useState(initialTable ?? "");
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<SpreadsheetPageData | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);

  const [addOpen, setAddOpen] = React.useState(false);
  const [addDraft, setAddDraft] = React.useState<Record<string, string>>({});

  const [history, setHistory] = React.useState<SpreadsheetHistoryStacks>(
    createEmptyHistoryStacks,
  );
  const [historyBusy, setHistoryBusy] = React.useState(false);
  const historyApplyingRef = React.useRef(false);
  const historyRef = React.useRef(history);
  historyRef.current = history;
  const loadPageSeqRef = React.useRef(0);
  const loadPageAbortRef = React.useRef<AbortController | null>(null);

  const shellRef = React.useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = React.useState(false);

  const resetHistory = React.useCallback(() => {
    setHistory(createEmptyHistoryStacks());
  }, []);

  const syncFullscreenState = React.useCallback(() => {
    const el = shellRef.current;
    setFullscreen(el != null && document.fullscreenElement === el);
  }, []);

  const toggleFullscreen = React.useCallback(async () => {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    if (fullscreen && !document.fullscreenElement) {
      setFullscreen(false);
      return;
    }
    try {
      await el.requestFullscreen();
    } catch {
      setFullscreen(true);
    }
  }, [fullscreen]);

  React.useEffect(() => {
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
    };
  }, [syncFullscreenState]);

  React.useEffect(() => {
    const active =
      fullscreen ||
      (shellRef.current != null &&
        document.fullscreenElement === shellRef.current);
    document.body.classList.toggle("admin-spreadsheet-fullscreen", active);
    document.body.style.overflow = active ? "hidden" : "";
    return () => {
      document.body.classList.remove("admin-spreadsheet-fullscreen");
      document.body.style.overflow = "";
    };
  }, [fullscreen]);

  React.useEffect(() => {
    if (!fullscreen || document.fullscreenElement) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const loadTableList = React.useCallback(
    async (forceRefresh = false) => {
      setTablesLoading(true);
      try {
        const json = await fetchSpreadsheetCatalog(forceRefresh);
        setTables(json.tables);
        setGroups(json.groups);

        const notices: string[] = [];
        if (json.inSchemaNotInDb?.length) {
          notices.push(
            `未マイグレーション: ${json.inSchemaNotInDb.join(", ")}（schema のみ）`,
          );
        }
        if (json.notInSchema?.length) {
          notices.push(
            `schema 未定義: ${json.notInSchema.join(", ")}（DB のみ・要 schema 追加）`,
          );
        }
        setSchemaNotice(notices.length > 0 ? notices.join(" · ") : null);

        setActiveTable((prev) => {
          if (prev && json.tables.some((t) => t.table === prev)) return prev;
          if (
            initialTable &&
            json.tables.some((t) => t.table === initialTable)
          ) {
            return initialTable;
          }
          return json.tables[0]?.table ?? "";
        });
      } catch (e) {
        setError(spreadsheetUserMessage(e, "load_failed"));
      } finally {
        setTablesLoading(false);
      }
    },
    [initialTable],
  );

  React.useEffect(() => {
    void loadTableList();
  }, [loadTableList]);

  const loadPage = React.useCallback(async () => {
    if (!activeTable) return;
    loadPageAbortRef.current?.abort();
    const abort = new AbortController();
    loadPageAbortRef.current = abort;
    const seq = ++loadPageSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchSpreadsheetPage(activeTable, page, abort.signal);
      if (abort.signal.aborted || seq !== loadPageSeqRef.current) return;
      setData(json);
      if (typeof json.page === "number" && json.page >= 1 && json.page !== page) {
        setPage(json.page);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (seq !== loadPageSeqRef.current) return;
      setError(spreadsheetUserMessage(e, "load_failed"));
      setData(null);
    } finally {
      if (seq === loadPageSeqRef.current) setLoading(false);
    }
  }, [activeTable, page]);

  React.useEffect(() => {
    void loadPage();
  }, [loadPage]);

  React.useEffect(() => {
    if (!data) return;
    const maxPage = Math.max(1, Math.ceil(data.total / Math.max(1, data.limit)));
    if (page > maxPage) setPage(maxPage);
  }, [data, page]);

  React.useEffect(() => {
    resetHistory();
  }, [activeTable, resetHistory]);

  const onSelectTable = (table: string) => {
    setActiveTable(table);
    setPage(1);
    setStatus(null);
    resetHistory();
  };

  const requirePrimaryKeyFromRow = React.useCallback(
    (row: Record<string, unknown>): Record<string, string> | null => {
      if (!data) return null;
      const issue = validatePrimaryKeyFromDisplayRow(row, data.primaryKeys);
      if (issue) {
        setError(formatPrimaryKeyIssue(issue));
        return null;
      }
      return buildPrimaryKeyFromDisplayRow(row, data.primaryKeys);
    },
    [data],
  );

  const patchCellByPk = React.useCallback(
    async (
      primaryKey: Record<string, string>,
      column: string,
      value: string | null,
      rowIndexHint: number,
    ): Promise<boolean> => {
      if (!data) return false;
      const issue = getPrimaryKeyIssue(data.primaryKeys, primaryKey);
      if (issue) {
        setError(formatPrimaryKeyIssue(issue));
        return false;
      }
      try {
        await patchSpreadsheetCell({
          table: data.def.table,
          primaryKey,
          column,
          value,
        });
      } catch (e) {
        setError(spreadsheetUserMessage(e, "save_failed"));
        return false;
      }
      setData((prev) => {
        if (!prev) return prev;
        const idx = findRowIndexByPrimaryKey(
          prev.rows,
          prev.primaryKeys,
          primaryKey,
        );
        const rowIndex = idx >= 0 ? idx : rowIndexHint;
        if (rowIndex < 0 || rowIndex >= prev.rows.length) return prev;
        const rows = prev.rows.map((r, i) =>
          i === rowIndex ? { ...r, [column]: value } : r,
        );
        return { ...prev, rows };
      });
      return true;
    },
    [data],
  );

  const recordHistory = React.useCallback(
    (label: string, changes: SpreadsheetCellChange[]) => {
      if (historyApplyingRef.current || changes.length === 0 || !data) return;
      const entry = createHistoryEntry({
        label,
        table: data.def.table,
        page: data.page,
        changes,
      });
      setHistory((stacks) => pushUndoEntry(stacks, entry));
    },
    [data],
  );

  const saveCell = React.useCallback(
    async (
      rowIndex: number,
      column: string,
      value: string | null,
      options?: { skipHistory?: boolean; before?: string | null },
    ): Promise<boolean> => {
      if (!data) return false;
      const row = data.rows[rowIndex];
      if (!row) return false;

      const beforeRaw =
        options?.before !== undefined
          ? options.before
          : formatSpreadsheetCellValue(row[column]);
      const before =
        beforeRaw === "" || beforeRaw == null ? null : beforeRaw;

      if (valuesEqual(before, value)) return true;

      const pk = requirePrimaryKeyFromRow(row);
      if (!pk) return false;

      const ok = await patchCellByPk(pk, column, value, rowIndex);
      if (!ok) {
        await loadPage();
        return false;
      }

      if (!options?.skipHistory) {
        recordHistory("セル編集", [
          {
            rowIndex,
            primaryKey: pk,
            column,
            before,
            after: value,
          },
        ]);
      }
      return true;
    },
    [data, loadPage, patchCellByPk, recordHistory, requirePrimaryKeyFromRow],
  );

  const saveCellsBatch = React.useCallback(
    async (
      patches: Array<{
        rowIndex: number;
        column: string;
        value: string | null;
      }>,
      label: string,
    ): Promise<boolean> => {
      if (!data || patches.length === 0) return true;

      const changes: SpreadsheetCellChange[] = [];
      for (const p of patches) {
        const row = data.rows[p.rowIndex];
        if (!row) continue;
        const beforeRaw = formatSpreadsheetCellValue(row[p.column]);
        const before =
          beforeRaw === "" || beforeRaw == null ? null : beforeRaw;
        if (valuesEqual(before, p.value)) continue;
        const pk = requirePrimaryKeyFromRow(row);
        if (!pk) return false;
        changes.push({
          rowIndex: p.rowIndex,
          primaryKey: pk,
          column: p.column,
          before,
          after: p.value,
        });
      }
      if (changes.length === 0) return true;

      for (const ch of changes) {
        const ok = await patchCellByPk(
          ch.primaryKey,
          ch.column,
          ch.after,
          ch.rowIndex,
        );
        if (!ok) {
          await loadPage();
          return false;
        }
      }

      recordHistory(label, changes);
      return true;
    },
    [data, loadPage, patchCellByPk, recordHistory, requirePrimaryKeyFromRow],
  );

  const applyHistoryEntry = React.useCallback(
    async (
      entry: SpreadsheetHistoryEntry,
      direction: "undo" | "redo",
    ): Promise<boolean> => {
      if (!data || entry.table !== data.def.table) {
        setStatus("別テーブルの履歴のため操作できません");
        return false;
      }

      setHistoryBusy(true);
      historyApplyingRef.current = true;
      try {
        for (const ch of entry.changes) {
          const value = direction === "undo" ? ch.before : ch.after;
          const ok = await patchCellByPk(
            ch.primaryKey,
            ch.column,
            value,
            ch.rowIndex,
          );
          if (!ok) {
            setError("元に戻す / やり直しに失敗しました");
            await loadPage();
            return false;
          }
        }
        setStatus(
          direction === "undo"
            ? `元に戻しました: ${entry.label}`
            : `やり直しました: ${entry.label}`,
        );
        return true;
      } finally {
        historyApplyingRef.current = false;
        setHistoryBusy(false);
      }
    },
    [data, loadPage, patchCellByPk],
  );

  const undo = React.useCallback(async () => {
    const stacks = historyRef.current;
    const entry = stacks.undo[stacks.undo.length - 1];
    if (!entry) return;
    const ok = await applyHistoryEntry(entry, "undo");
    if (!ok) return;
    setHistory(popUndo(stacks).stacks);
  }, [applyHistoryEntry]);

  const redo = React.useCallback(async () => {
    const stacks = historyRef.current;
    const entry = stacks.redo[stacks.redo.length - 1];
    if (!entry) return;
    const ok = await applyHistoryEntry(entry, "redo");
    if (!ok) return;
    setHistory(popRedo(stacks).stacks);
  }, [applyHistoryEntry]);

  const deleteRow = React.useCallback(
    async (rowIndex: number) => {
      if (!data) return;
      const row = data.rows[rowIndex];
      if (!row) return;
      const pk = requirePrimaryKeyFromRow(row);
      if (!pk) return;
      try {
        await apiDeleteRow({ table: data.def.table, primaryKey: pk });
      } catch (e) {
        setError(spreadsheetUserMessage(e, "delete_failed"));
        return;
      }
      resetHistory();
      setStatus("行を削除しました");
      await loadPage();
    },
    [data, loadPage, requirePrimaryKeyFromRow, resetHistory],
  );

  const openAddRow = React.useCallback(
    (draft: Record<string, string>, mode: "blank" | "copy" | "duplicate") => {
      if (!data) return;
      if (mode === "blank") {
        const empty: Record<string, string> = {};
        for (const col of data.columns) {
          empty[col.name] = "";
        }
        setAddDraft(empty);
      } else {
        setAddDraft(draft);
      }
      setAddOpen(true);
      setStatus(
        mode === "duplicate"
          ? "行を複製: PK を確認してから追加してください"
          : "行を追加",
      );
    },
    [data],
  );

  const insertRow = React.useCallback(async () => {
    if (!data) return;
    const pk = requirePrimaryKeyFromRow(addDraft);
    if (!pk) return;
    const row = buildSpreadsheetInsertPayload(addDraft, data.columns);
    if (Object.keys(row).length === 0) {
      setError("追加する列がありません");
      return;
    }
    try {
      await apiInsertRow({ table: data.def.table, row });
    } catch (e) {
      setError(spreadsheetUserMessage(e, "insert_failed"));
      return;
    }
    setAddOpen(false);
    setAddDraft({});
    resetHistory();
    setStatus("行を追加しました");
    await loadPage();
  }, [addDraft, data, loadPage, requirePrimaryKeyFromRow, resetHistory]);

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / Math.max(1, data.limit)))
    : 1;
  const editable = data?.def.mode === "editable";
  const canUndo = history.undo.length > 0 && !historyBusy;
  const canRedo = history.redo.length > 0 && !historyBusy;

  return {
    tables,
    groups,
    schemaNotice,
    tablesLoading,
    activeTable,
    page,
    setPage,
    data,
    loading,
    error,
    status,
    addOpen,
    setAddOpen,
    addDraft,
    setAddDraft,
    history,
    historyBusy,
    shellRef,
    fullscreen,
    toggleFullscreen,
    loadTableList,
    loadPage,
    onSelectTable,
    saveCell,
    saveCellsBatch,
    deleteRow,
    openAddRow,
    insertRow,
    undo,
    redo,
    resetHistory,
    totalPages,
    editable,
    canUndo,
    canRedo,
  };
}
