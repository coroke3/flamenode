"use client";

import * as React from "react";
import styles from "./AdminSpreadsheetClient.module.css";
import {
  SpreadsheetContextMenu,
  type ContextMenuAction,
} from "./SpreadsheetContextMenu";
import {
  looksLikeTabularClipboard,
  parseClipboardContent,
  readGridFromClipboard,
  readGridFromDataTransfer,
} from "./clipboardGrid";
import {
  buildClearCells,
  buildFillDownCells,
  buildGridPasteCellsFromGrid,
  clampCellPos,
  canEditCell,
  columnIndexToLetter,
  computeSelectionStats,
  copySelectionAsTsv,
  findNextSpreadsheetMatch,
  formatCellValue,
  getSelectionBounds,
  isPrintableKey,
  moveCell,
  parseSpreadsheetCellInput,
  rowToDraft,
  selectionSummary,
  writeTextToClipboard,
  type CellPos,
  type ColumnMeta,
} from "./spreadsheetGridUtils";
import {
  SPREADSHEET_GRID_DEFAULT_COL_WIDTH,
  SPREADSHEET_GRID_MAX_COL_WIDTH,
  SPREADSHEET_GRID_MIN_COL_WIDTH,
} from "./spreadsheetGridConstants";
import { SpreadsheetGridFindBar } from "./SpreadsheetGridFindBar";
import { SpreadsheetGridFormulaBar } from "./SpreadsheetGridFormulaBar";
import { SpreadsheetGridStatusBar } from "./SpreadsheetGridStatusBar";
import { cellMatchesFind } from "@/lib/admin/spreadsheet/cellFormat";

type EditState = {
  rowIndex: number;
  colIndex: number;
  value: string;
  original: string;
};

type ContextState = {
  x: number;
  y: number;
  rowIndex: number;
  colIndex: number;
};

export function SpreadsheetGrid({
  columns,
  rows,
  editable,
  page,
  limit,
  tableName,
  onSaveCell,
  onSaveCellsBatch,
  onDeleteRow,
  onAddRowFromTemplate,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  historyBusy,
  toolbar,
}: {
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  editable: boolean;
  page: number;
  limit: number;
  tableName: string;
  onSaveCell: (
    rowIndex: number,
    column: string,
    value: string | null,
    options?: { skipHistory?: boolean; before?: string | null },
  ) => Promise<boolean>;
  onSaveCellsBatch?: (
    patches: Array<{
      rowIndex: number;
      column: string;
      value: string | null;
    }>,
    label: string,
  ) => Promise<boolean>;
  onDeleteRow: (rowIndex: number) => Promise<void>;
  onAddRowFromTemplate?: (
    template: Record<string, string>,
    mode: "blank" | "copy" | "duplicate",
  ) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  historyBusy?: boolean;
  toolbar?: React.ReactNode;
}): React.ReactElement {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const formulaRef = React.useRef<HTMLInputElement>(null);

  const [anchor, setAnchor] = React.useState<CellPos>({ rowIndex: 0, colIndex: 0 });
  const [focus, setFocus] = React.useState<CellPos>({ rowIndex: 0, colIndex: 0 });
  const [editing, setEditing] = React.useState<EditState | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [statusHint, setStatusHint] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [ctx, setCtx] = React.useState<ContextState | null>(null);
  const [findOpen, setFindOpen] = React.useState(false);
  const [findQuery, setFindQuery] = React.useState("");
  const [colWidths, setColWidths] = React.useState<Record<string, number>>({});
  const resizeRef = React.useRef<{
    colName: string;
    startX: number;
    startW: number;
  } | null>(null);
  const commitInFlightRef = React.useRef(false);

  const rowCount = rows.length;
  const colCount = columns.length;
  const { r0, r1, c0, c1 } = getSelectionBounds(anchor, focus);

  const focusCol = columns[focus.colIndex];
  const focusRow = rows[focus.rowIndex];
  const focusValue =
    focusRow && focusCol ? formatCellValue(focusRow[focusCol.name]) : "";

  const isActive = (ri: number, ci: number) =>
    ri >= r0 && ri <= r1 && ci >= c0 && ci <= c1;

  const isFocusCell = (ri: number, ci: number) =>
    ri === focus.rowIndex && ci === focus.colIndex;

  const isRowHeadActive = (ri: number) =>
    ri >= r0 && ri <= r1 && c0 === 0 && c1 === colCount - 1;

  const isColHeadActive = (ci: number) =>
    ci >= c0 && ci <= c1 && r0 === 0 && r1 === rowCount - 1;

  const colWidth = (name: string) =>
    colWidths[name] ?? SPREADSHEET_GRID_DEFAULT_COL_WIDTH;

  const stats = computeSelectionStats(rows, columns, anchor, focus);

  const resetSelection = React.useCallback(() => {
    setAnchor({ rowIndex: 0, colIndex: 0 });
    setFocus({ rowIndex: 0, colIndex: 0 });
    setEditing(null);
    setFindQuery("");
    setFindOpen(false);
  }, []);

  React.useEffect(() => {
    resetSelection();
    requestAnimationFrame(() => viewportRef.current?.focus());
  }, [tableName, page, resetSelection]);

  React.useEffect(() => {
    setAnchor((a) => clampCellPos(a, rowCount, colCount));
    setFocus((f) => clampCellPos(f, rowCount, colCount));
    setEditing(null);
  }, [rowCount, colCount]);

  React.useEffect(() => {
    if (!statusHint) return;
    const t = window.setTimeout(() => setStatusHint(null), 3500);
    return () => window.clearTimeout(t);
  }, [statusHint]);

  React.useEffect(() => {
    const el = viewportRef.current?.querySelector(
      `[data-cell="${focus.rowIndex}:${focus.colIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focus.rowIndex, focus.colIndex, editing]);

  React.useEffect(() => {
    const endDrag = () => setDragging(false);
    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const delta = e.clientX - r.startX;
      const w = Math.min(
        SPREADSHEET_GRID_MAX_COL_WIDTH,
        Math.max(SPREADSHEET_GRID_MIN_COL_WIDTH, r.startW + delta),
      );
      setColWidths((prev) => ({ ...prev, [r.colName]: w }));
    };
    const onUp = () => {
      resizeRef.current = null;
      endDrag();
    };
    window.addEventListener("mouseup", onUp);
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  const hint = (msg: string) => setStatusHint(msg);

  const selectRange = (a: CellPos, f: CellPos) => {
    const ca = clampCellPos(a, rowCount, colCount);
    const cf = clampCellPos(f, rowCount, colCount);
    setAnchor(ca);
    setFocus(cf);
    setEditing(null);
  };

  const selectCell = (
    pos: CellPos,
    opts?: { extend?: boolean; startEdit?: boolean; initialChar?: string },
  ) => {
    const clamped = clampCellPos(pos, rowCount, colCount);
    if (opts?.extend) setFocus(clamped);
    else {
      setAnchor(clamped);
      setFocus(clamped);
    }
    if (opts?.startEdit) {
      const col = columns[clamped.colIndex];
      if (!col || !canEditCell(editable, col)) return;
      const row = rows[clamped.rowIndex];
      const display = row ? formatCellValue(row[col.name]) : "";
      setEditing({
        rowIndex: clamped.rowIndex,
        colIndex: clamped.colIndex,
        value: opts.initialChar ?? display,
        original: display,
      });
      requestAnimationFrame(() => {
        formulaRef.current?.focus();
        if (opts.initialChar) formulaRef.current?.select();
        else formulaRef.current?.setSelectionRange(
          formulaRef.current.value.length,
          formulaRef.current.value.length,
        );
      });
    } else {
      setEditing(null);
    }
  };

  const selectColumn = (colIndex: number, extend?: boolean) => {
    if (rowCount === 0) return;
    const end: CellPos = { rowIndex: rowCount - 1, colIndex };
    if (extend) setFocus(end);
    else selectRange({ rowIndex: 0, colIndex }, end);
    viewportRef.current?.focus();
  };

  const selectRow = (rowIndex: number, extend?: boolean) => {
    if (colCount === 0) return;
    const end: CellPos = { rowIndex, colIndex: colCount - 1 };
    if (extend) setFocus(end);
    else selectRange({ rowIndex, colIndex: 0 }, end);
    viewportRef.current?.focus();
  };

  const commitEdit = async (nextFocus?: CellPos): Promise<void> => {
    if (!editing || commitInFlightRef.current) {
      if (nextFocus) selectCell(nextFocus);
      return;
    }
    const col = columns[editing.colIndex];
    if (!col) {
      setEditing(null);
      return;
    }
    const normalized = parseSpreadsheetCellInput(editing.value, {
      preserveWhitespace: true,
    });
    const prevDisplay = editing.original;
    const nextDisplay = normalized == null ? "" : normalized;

    setEditing(null);
    if (nextFocus) {
      setAnchor(nextFocus);
      setFocus(nextFocus);
    }

    if (nextDisplay === prevDisplay) return;

    commitInFlightRef.current = true;
    setSaving(true);
    let ok = false;
    try {
      ok = await onSaveCell(editing.rowIndex, col.name, normalized, {
        before: editing.original === "" ? null : editing.original,
      });
    } finally {
      commitInFlightRef.current = false;
      setSaving(false);
    }
    if (!ok) {
      selectCell({ rowIndex: editing.rowIndex, colIndex: editing.colIndex });
    } else {
      hint("保存しました");
    }
  };

  const cancelEdit = () => {
    setEditing(null);
    viewportRef.current?.focus();
  };

  const applyPatches = async (
    cells: Array<{ rowIndex: number; column: string; value: string | null }>,
    label: string,
  ) => {
    if (cells.length === 0) return;
    setSaving(true);
    if (onSaveCellsBatch) {
      const ok = await onSaveCellsBatch(cells, label);
      setSaving(false);
      hint(ok ? `${label}しました` : `${label}に失敗`);
      return;
    }
    let ok = 0;
    let fail = 0;
    for (const cell of cells) {
      const success = await onSaveCell(
        cell.rowIndex,
        cell.column,
        cell.value,
      );
      if (success) ok += 1;
      else fail += 1;
    }
    setSaving(false);
    hint(fail > 0 ? `${label}: ${ok} 成功 / ${fail} 失敗` : `${label}: ${ok} 件`);
  };

  const applyClipboardPaste = React.useCallback(
    (plain: string, html: string, at: CellPos = focus) => {
      if (!editable) return;
      setEditing(null);
      const origin = clampCellPos(at, rowCount, colCount);

      if (!looksLikeTabularClipboard(plain, html)) {
        const trimmed = plain.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
        if (!trimmed) return;
        const col = columns[origin.colIndex];
        if (!col || !canEditCell(editable, col)) {
          hint("貼り付け先が読み取り専用です");
          return;
        }
        const single = parseSpreadsheetCellInput(trimmed);
        void applyPatches(
          [{ rowIndex: origin.rowIndex, column: col.name, value: single }],
          "貼り付け",
        );
        return;
      }

      const grid = parseClipboardContent(plain, html);
      const cells = buildGridPasteCellsFromGrid(
        grid,
        columns,
        origin,
        rowCount,
      ).filter((c) => {
        const col = columns.find((col) => col.name === c.column);
        return col && canEditCell(editable, col);
      });
      if (cells.length === 0) {
        hint("貼り付け可能なセルがありません（列名が一致するか確認してください）");
        return;
      }
      void applyPatches(cells, "貼り付け");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus read at call time
    [columns, editable, focus, rowCount, onSaveCell, onSaveCellsBatch],
  );

  const pasteFromClipboard = React.useCallback(async () => {
    if (!editable) return;
    setEditing(null);
    const data = await readGridFromClipboard();
    if (data == null) {
      hint(
        "貼り付けできませんでした。グリッドをクリックしてから Ctrl+V をお試しください",
      );
      viewportRef.current?.focus();
      return;
    }
    applyClipboardPaste(data.plain, data.html, focus);
    viewportRef.current?.focus();
  }, [applyClipboardPaste, editable, focus]);

  const handleClipboardPaste = React.useCallback(
    (e: React.ClipboardEvent) => {
      if (!editable) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea")) return;
      const { plain, html } = readGridFromDataTransfer(e.clipboardData);
      if (!plain && !html) return;
      e.preventDefault();
      e.stopPropagation();
      applyClipboardPaste(plain, html, focus);
    },
    [applyClipboardPaste, editable, focus],
  );

  const handleEditPaste = (
    e: React.ClipboardEvent,
    useGridForTabular: boolean,
  ) => {
    if (!editable || !useGridForTabular) return;
    const plain = e.clipboardData.getData("text/plain");
    const html = e.clipboardData.getData("text/html");
    if (!looksLikeTabularClipboard(plain, html)) return;
    e.preventDefault();
    e.stopPropagation();
    applyClipboardPaste(plain, html, focus);
    viewportRef.current?.focus();
  };

  const copySelection = async () => {
    const tsv = copySelectionAsTsv(rows, columns, anchor, focus);
    const ok = await writeTextToClipboard(tsv);
    hint(ok ? "コピーしました" : "コピーに失敗しました");
  };

  const cutSelection = async () => {
    await copySelection();
    await applyPatches(
      buildClearCells(columns, anchor, focus, editable),
      "切り取り",
    );
  };

  const clearSelection = async () => {
    await applyPatches(
      buildClearCells(columns, anchor, focus, editable),
      "クリア",
    );
  };

  const fillDownSelection = async () => {
    await applyPatches(
      buildFillDownCells(rows, columns, anchor, focus, editable),
      "フィル",
    );
  };

  const navigateKey = (e: React.KeyboardEvent): string | null => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "Home") return "CtrlHome";
    if (mod && e.key === "End") return "CtrlEnd";
    if (mod && e.key === "ArrowUp") return "CtrlArrowUp";
    if (mod && e.key === "ArrowDown") return "CtrlArrowDown";
    if (mod && e.key === "ArrowLeft") return "CtrlArrowLeft";
    if (mod && e.key === "ArrowRight") return "CtrlArrowRight";
    if (e.key === "Home") return "Home";
    if (e.key === "End") return "End";
    if (e.key === "PageUp") return "PageUp";
    if (e.key === "PageDown") return "PageDown";
    if (e.key === "ArrowUp") return "ArrowUp";
    if (e.key === "ArrowDown") return "ArrowDown";
    if (e.key === "ArrowLeft") return "ArrowLeft";
    if (e.key === "ArrowRight") return "ArrowRight";
    if (e.key === "Tab") return e.shiftKey ? "ShiftTab" : "Tab";
    if (e.key === "Enter") return "Enter";
    return null;
  };

  const handleGridKeyDown = (e: React.KeyboardEvent) => {
    if (editing || historyBusy) return;

    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      if (canUndo && onUndo) onUndo();
      return;
    }
    if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey) || (e.key === "Z" && e.shiftKey))) {
      e.preventDefault();
      if (canRedo && onRedo) onRedo();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      setFindOpen(true);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "a" && rowCount > 0 && colCount > 0) {
      e.preventDefault();
      selectRange(
        { rowIndex: 0, colIndex: 0 },
        { rowIndex: rowCount - 1, colIndex: colCount - 1 },
      );
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "c") {
      e.preventDefault();
      void copySelection();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "v") {
      e.preventDefault();
      void pasteFromClipboard();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "x") {
      e.preventDefault();
      void cutSelection();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "d") {
      e.preventDefault();
      void fillDownSelection();
      return;
    }

    if (e.key === " " && e.shiftKey) {
      e.preventDefault();
      selectRow(focus.rowIndex);
      return;
    }

    if (e.key === " " && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      selectColumn(focus.colIndex);
      return;
    }

    if (e.key === "F2") {
      e.preventDefault();
      selectCell(focus, { startEdit: true });
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      void clearSelection();
      return;
    }

    const nav = navigateKey(e);
    if (nav) {
      e.preventDefault();
      const next = moveCell(focus, nav, rowCount, colCount);
      if (e.shiftKey && nav.startsWith("Arrow")) setFocus(next);
      else selectCell(next);
      return;
    }

    if (isPrintableKey(e)) {
      const col = columns[focus.colIndex];
      if (!col || !canEditCell(editable, col)) return;
      e.preventDefault();
      selectCell(focus, { startEdit: true, initialChar: e.key });
    }
  };

  const handleFormulaKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      cancelEdit();
      if (canUndo && onUndo) onUndo();
      return;
    }
    if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
      e.preventDefault();
      cancelEdit();
      if (canRedo && onRedo) onRedo();
      return;
    }
    if (mod && e.key === "c") {
      e.preventDefault();
      void copySelection();
      return;
    }
    if (mod && e.key === "v") {
      e.preventDefault();
      void pasteFromClipboard();
      return;
    }
    if (mod && e.key === "x") {
      e.preventDefault();
      cancelEdit();
      void cutSelection();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const next = moveCell(focus, "Enter", rowCount, colCount);
      void commitEdit(next);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const next = moveCell(
        focus,
        e.shiftKey ? "ShiftTab" : "Tab",
        rowCount,
        colCount,
      );
      void commitEdit(next);
    }
  };

  const openContextMenu = (
    e: React.MouseEvent,
    rowIndex: number,
    colIndex: number,
  ) => {
    e.preventDefault();
    if (rowCount === 0 || colCount === 0) return;
    const pos = clampCellPos({ rowIndex, colIndex }, rowCount, colCount);
    if (!isActive(pos.rowIndex, pos.colIndex)) {
      selectCell(pos);
    }
    setCtx({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 220)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - 320)),
      rowIndex: pos.rowIndex,
      colIndex: pos.colIndex,
    });
  };

  const ctxRow = ctx?.rowIndex ?? focus.rowIndex;
  const ctxCanEdit =
    focusCol != null && canEditCell(editable, focusCol);
  const multiRow = r1 > r0;

  const ctxItems: Array<{
    id: ContextMenuAction;
    label: string;
    disabled?: boolean;
  }> = [
    { id: "edit", label: "編集 (F2)", disabled: !ctxCanEdit },
    { id: "copy", label: "コピー (Ctrl+C)" },
    { id: "cut", label: "切り取り (Ctrl+X)", disabled: !editable },
    { id: "paste", label: "貼り付け (Ctrl+V)", disabled: !editable },
    { id: "clear", label: "クリア (Delete)", disabled: !editable },
    {
      id: "fillDown",
      label: "下にフィル (Ctrl+D)",
      disabled: !editable || !multiRow,
    },
    {
      id: "insertRow",
      label: "下に行を挿入…",
      disabled: !editable || !onAddRowFromTemplate,
    },
    {
      id: "duplicateRow",
      label: "行を複製して挿入…",
      disabled: !editable || !onAddRowFromTemplate,
    },
    {
      id: "deleteRow",
      label: "行を削除",
      disabled: !editable,
    },
  ];

  const onCtxAction = (id: ContextMenuAction) => {
    const row = rows[ctxRow];
    switch (id) {
      case "edit":
        selectCell({ rowIndex: focus.rowIndex, colIndex: focus.colIndex }, {
          startEdit: true,
        });
        break;
      case "copy":
        copySelection();
        break;
      case "cut":
        void cutSelection();
        break;
      case "paste":
        void pasteFromClipboard();
        break;
      case "clear":
        void clearSelection();
        break;
      case "fillDown":
        void fillDownSelection();
        break;
      case "insertRow":
        if (row && onAddRowFromTemplate) {
          onAddRowFromTemplate(rowToDraft(row, columns, true), "blank");
        }
        break;
      case "duplicateRow":
        if (row && onAddRowFromTemplate) {
          onAddRowFromTemplate(rowToDraft(row, columns, true), "duplicate");
        }
        break;
      case "deleteRow":
        if (
          window.confirm(
            `行 ${(page - 1) * Math.max(1, limit) + ctxRow + 1} を削除しますか？`,
          )
        ) {
          void onDeleteRow(ctxRow);
        }
        break;
    }
  };

  const formulaReadOnly =
    !editing && (!focusCol || !canEditCell(editable, focusCol));

  const selSummary = selectionSummary(anchor, focus);

  const formulaStatusText = historyBusy
    ? "履歴を適用中…"
    : saving
      ? "保存中…"
      : statusHint || selSummary || "";

  const findNext = () => {
    const result = findNextSpreadsheetMatch({
      rows,
      columns,
      query: findQuery,
      from: focus,
    });
    if (!result.found) {
      hint("見つかりません");
      return;
    }
    selectCell(result.pos);
    if (result.wrapped) hint("先頭から検索");
  };

  const closeFindBar = () => {
    setFindOpen(false);
    viewportRef.current?.focus();
  };

  return (
    <div
      className={styles.sheetChrome}
      onPaste={handleClipboardPaste}
    >
      {toolbar ? <div className={styles.sheetRibbon}>{toolbar}</div> : null}

      {findOpen ? (
        <SpreadsheetGridFindBar
          query={findQuery}
          onQueryChange={setFindQuery}
          onNext={findNext}
          onClose={closeFindBar}
        />
      ) : null}

      <SpreadsheetGridFormulaBar
        formulaRef={formulaRef}
        page={page}
        limit={limit}
        editable={editable}
        focus={focus}
        focusCol={focusCol}
        focusValue={focusValue}
        editing={editing}
        formulaReadOnly={formulaReadOnly}
        statusText={formulaStatusText}
        onStartEdit={(value) => {
          setEditing({
            rowIndex: focus.rowIndex,
            colIndex: focus.colIndex,
            value,
            original: focusValue,
          });
        }}
        onEditChange={(value) => {
          if (editing) setEditing({ ...editing, value });
        }}
        onFormulaKeyDown={handleFormulaKeyDown}
        onEditPaste={(e) => handleEditPaste(e, true)}
        onCommitBlur={() => {
          if (editing) void commitEdit();
        }}
      />

      <div
        ref={viewportRef}
        className={styles.gridViewport}
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        onPaste={handleClipboardPaste}
      >
        <table className={styles.grid}>
          <colgroup>
            <col style={{ width: 46 }} />
            {columns.map((col) => (
              <col key={col.name} style={{ width: colWidth(col.name) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                scope="col"
                className={styles.cornerHead}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (rowCount > 0 && colCount > 0) {
                    selectRange(
                      { rowIndex: 0, colIndex: 0 },
                      { rowIndex: rowCount - 1, colIndex: colCount - 1 },
                    );
                  }
                }}
                title="クリックで全選択"
              />
              {columns.map((col, colIndex) => (
                <th
                  key={col.name}
                  scope="col"
                  className={[
                    styles.colHead,
                    col.pk > 0 ? styles.pk : "",
                    isColHeadActive(colIndex) ? styles.headActive : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ width: colWidth(col.name) }}
                  title={`${col.name} (${col.type})`}
                  onMouseDown={(e) => {
                    if ((e.target as HTMLElement).closest(`.${styles.colResizer}`))
                      return;
                    e.preventDefault();
                    selectColumn(colIndex, e.shiftKey);
                  }}
                  onDoubleClick={() => {
                    const cells = viewportRef.current?.querySelectorAll(
                      `td[data-col="${col.name}"] .${styles.cell}`,
                    );
                    let max = SPREADSHEET_GRID_MIN_COL_WIDTH;
                    cells?.forEach((el) => {
                      max = Math.max(max, (el as HTMLElement).scrollWidth + 16);
                    });
                    setColWidths((prev) => ({
                      ...prev,
                      [col.name]: Math.min(SPREADSHEET_GRID_MAX_COL_WIDTH, max),
                    }));
                  }}
                >
                  <span className={styles.colLetter}>
                    {columnIndexToLetter(colIndex)}
                  </span>
                  <span className={styles.colName}>{col.name}</span>
                  <span
                    className={styles.colResizer}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      resizeRef.current = {
                        colName: col.name,
                        startX: e.clientX,
                        startW: colWidth(col.name),
                      };
                      setDragging(true);
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className={styles.emptySheet}>
                  行がありません
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <th
                    scope="row"
                    className={[
                      styles.rowHead,
                      isRowHeadActive(rowIndex) ? styles.headActive : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (e.button !== 0) return;
                      selectRow(rowIndex, e.shiftKey);
                    }}
                    onContextMenu={(e) => openContextMenu(e, rowIndex, 0)}
                    title="クリックで行選択 · 右クリックでメニュー"
                  >
                    {(page - 1) * Math.max(1, limit) + rowIndex + 1}
                  </th>
                  {columns.map((col, colIndex) => {
                    const display = formatCellValue(row[col.name]);
                    const isEd =
                      editing?.rowIndex === rowIndex &&
                      editing.colIndex === colIndex;
                    const active = isActive(rowIndex, colIndex);
                    const focused = isFocusCell(rowIndex, colIndex);
                    const canEdit = canEditCell(editable, col);
                    const findHit =
                      findQuery &&
                      cellMatchesFind(row[col.name], findQuery, false);

                    return (
                      <td
                        key={col.name}
                        data-cell={`${rowIndex}:${colIndex}`}
                        data-col={col.name}
                        className={[
                          styles.dataCell,
                          active ? styles.dataCellActive : "",
                          focused ? styles.dataCellFocus : "",
                          !canEdit ? styles.dataCellReadonly : "",
                          findHit ? styles.dataCellFind : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        style={{ width: colWidth(col.name) }}
                        title={
                          display.length > 40
                            ? `${col.name}: ${display}`
                            : `${col.name} (${col.type})`
                        }
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          e.preventDefault();
                          viewportRef.current?.focus();
                          setDragging(true);
                          if (e.shiftKey) {
                            setFocus(
                              clampCellPos(
                                { rowIndex, colIndex },
                                rowCount,
                                colCount,
                              ),
                            );
                          } else {
                            selectCell({ rowIndex, colIndex });
                          }
                        }}
                        onMouseEnter={() => {
                          if (!dragging) return;
                          setFocus(
                            clampCellPos(
                              { rowIndex, colIndex },
                              rowCount,
                              colCount,
                            ),
                          );
                        }}
                        onDoubleClick={() => {
                          if (!canEdit) return;
                          selectCell(
                            { rowIndex, colIndex },
                            { startEdit: true },
                          );
                        }}
                        onContextMenu={(e) =>
                          openContextMenu(e, rowIndex, colIndex)
                        }
                      >
                        {isEd ? (
                          <input
                            className={styles.cellInputInline}
                            value={editing.value}
                            autoFocus
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                value: e.target.value,
                              })
                            }
                            onPaste={(e) => handleEditPaste(e, true)}
                            onKeyDown={(e) => {
                              const mod = e.ctrlKey || e.metaKey;
                              if (mod && e.key === "c") {
                                e.preventDefault();
                                void writeTextToClipboard(editing.value);
                                return;
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEdit();
                              }
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const next = moveCell(
                                  { rowIndex, colIndex },
                                  "Enter",
                                  rowCount,
                                  colCount,
                                );
                                void commitEdit(next);
                              }
                              if (e.key === "Tab") {
                                e.preventDefault();
                                const next = moveCell(
                                  { rowIndex, colIndex },
                                  e.shiftKey ? "ShiftTab" : "Tab",
                                  rowCount,
                                  colCount,
                                );
                                void commitEdit(next);
                              }
                            }}
                            onBlur={() => void commitEdit()}
                          />
                        ) : (
                          <span
                            className={
                              display === ""
                                ? styles.cellEmpty
                                : styles.cell
                            }
                          >
                            {display}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <SpreadsheetGridStatusBar stats={stats} focusCol={focusCol} />

      {ctx ? (
        <SpreadsheetContextMenu
          x={ctx.x}
          y={ctx.y}
          items={ctxItems}
          onAction={onCtxAction}
          onClose={() => setCtx(null)}
        />
      ) : null}
    </div>
  );
}
