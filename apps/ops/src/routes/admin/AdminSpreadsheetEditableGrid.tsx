import * as React from "react";
import type { AdminSpreadsheetPageResponse } from "@flamenode/contracts";
import type { OpsFetch } from "../../api/read.js";
import { copySpreadsheetSelection, moveSpreadsheetFocus, type GridCell } from "./spreadsheetGridKeyboard.js";
import {
  patchSpreadsheetCell,
  insertSpreadsheetRow,
  deleteSpreadsheetRow,
} from "../../api/adminSpreadsheetWrites.js";

/** MIG-0737 U01: isolated RH-004/005/006 edit surface. NOT ROUTED until backend merge gates. */
type Change = { table: string; page: number; pk: Record<string, string>; column: string; before: string | null; after: string | null };
type History = { key: string; undo: Change[]; redo: Change[] };
type CellSelection = {
  id: number; rowIndex: number; column: string; value: string; key: string;
  pk: Record<string, string>; before: string | null; invalidated?: boolean;
  selectInitialText?: boolean;
  fromFormula?: boolean;
};
const HISTORY_LIMIT = 100;
const DEFAULT_COL_WIDTH = 110;
const MIN_COL_WIDTH = 56;
const MAX_COL_WIDTH = 420;

function clampColumnWidth(width: number): number {
  return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, width));
}

function columnIndexToLetter(index: number): string {
  let n = index;
  let result = "";
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

function cellValue(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw);
}
function primaryKey(row: Record<string, unknown>, columns: string[]): Record<string, string> | null {
  if (!columns.length) return null;
  const pk: Record<string, string> = {};
  for (const column of columns) {
    const value = row[column];
    if (value == null || typeof value === "object" || String(value).trim() === "") return null;
    pk[column] = String(value);
  }
  return pk;
}
function statusMessage(code: string): string {
  if (code === "anonymous") return "ログインし直してください。";
  if (code === "forbidden") return "編集権限がありません。";
  if (code === "disabled") return "スプレッドシートは無効です。";
  if (code === "notFound") return "対象のテーブルまたは行が見つかりません。";
  return "保存できませんでした。再読み込みして内容を確認してください。";
}

export function AdminSpreadsheetEditableGrid({
  data,
  fetchFn = fetch,
  onRefresh,
  confirmDelete = (message) => window.confirm(message),
  allowMutations = false,
}: {
  data: AdminSpreadsheetPageResponse;
  fetchFn?: OpsFetch;
  onRefresh: () => Promise<void> | void;
  confirmDelete?: (message: string) => boolean;
  /** Separate opt-in prevents accidental production writes while MIG-0638 is READY. */
  allowMutations?: boolean;
}): React.ReactElement {
  const { def, rows, columns, primaryKeys, page, limit } = data;
  const [selection, setSelection] = React.useState<CellSelection | null>(null);
  const liveSelection = React.useRef<CellSelection | null>(null);
  const nextEditId = React.useRef(0);
  const [anchorCell, setAnchorCell] = React.useState<GridCell>({ row: 0, col: 0 });
  const [focusedCell, setFocusedCell] = React.useState<GridCell>({ row: 0, col: 0 });
  // CURRENT's committed state preserves the observed ordering of batched press/enter/release events.
  const [dragging, setDragging] = React.useState(false);
  const [findOpen, setFindOpen] = React.useState(false);
  const [findQuery, setFindQuery] = React.useState("");
  const [findHint, setFindHint] = React.useState<string | null>(null);
  const [insertOpen, setInsertOpen] = React.useState(false);
  const [insertDraft, setInsertDraft] = React.useState<Record<string, string>>({});
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [history, setHistory] = React.useState<History>({ key: "", undo: [], redo: [] });
  const [colWidths, setColWidths] = React.useState<Record<string, number>>({});
  const resizeRef = React.useRef<{ column: string; startX: number; startWidth: number } | null>(null);
  const tableRef = React.useRef<HTMLTableElement>(null);
  const editorRef = React.useRef<HTMLInputElement>(null);
  // A formula-only navigation can change the target before React commits its new endpoint.
  const formulaNavigationPending = React.useRef(false);
  const focusedGridElement = React.useRef<HTMLElement | null>(null);
  const displayedPage = React.useRef(data);
  displayedPage.current = data;
  const inFlight = React.useRef<AbortController | null>(null);
  // CURRENT gives undo/redo its own busy flag; range shortcuts must not use the general mutation lock.
  const historyInFlight = React.useRef<AbortController | null>(null);
  const contextRef = React.useRef({ fetchFn, table: def.table, page, allowMutations });
  contextRef.current = { fetchFn, table: def.table, page, allowMutations };
  const previousContext = React.useRef(contextRef.current);
  const [contextVersion, setContextVersion] = React.useState(0);
  const key = def.table + ":" + page + ":" + contextVersion;
  const previous = previousContext.current;
  const identityChanged = previous.fetchFn !== fetchFn || previous.table !== def.table ||
    previous.page !== page || previous.allowMutations !== allowMutations;
  const editable = allowMutations && def.mode === "editable";
  const colWidth = (name: string) => colWidths[name] ?? DEFAULT_COL_WIDTH;
  const canMutate = editable && !identityChanged && !busy && inFlight.current == null;
  const safeHistory = !identityChanged && history.key === key ? history : { key, undo: [], redo: [] };
  const currentSelection = !identityChanged && selection?.key === key ? selection : null;
  const selectedRow = currentSelection ? rows[currentSelection.rowIndex] : undefined;
  const selectedColumn = currentSelection ? columns.find(c => c.name === currentSelection.column) : undefined;
  const selectedPk = selectedRow ? primaryKey(selectedRow, primaryKeys) : null;
  // A page refresh must never move a draft to another row, or silently
  // overwrite a newer value. RH-004 has no expected-value wire field.
  const selectionConflict = currentSelection !== null && (
    currentSelection.invalidated === true || !editable ||
    !selectedColumn || !selectedColumn.editable || selectedColumn.pk !== 0 || selectedColumn.generated === true ||
    !selectedRow || !selectedPk ||
    Object.keys(currentSelection.pk).length !== primaryKeys.length ||
    primaryKeys.some(name => !Object.hasOwn(currentSelection.pk, name) || selectedPk[name] !== currentSelection.pk[name]) ||
    (selectedRow[selectedColumn.name] == null ? null : cellValue(selectedRow[selectedColumn.name])) !== currentSelection.before
  );
  const focusEditId = currentSelection && !selectionConflict ? currentSelection.id : null;
  // Keep drafts intact until CURRENT blur-save is ported; header selection does not commit or discard edits.
  const canSelectHeaders = !identityChanged && currentSelection === null && rows.length > 0 && columns.length > 0;
  const canFind = canUseFind();
  const visibleAnchor = boundCellToPage(anchorCell);
  const visibleFocus = boundCellToPage(focusedCell);
  const focusedColumn = identityChanged ? undefined : columns[visibleFocus.col];
  const stats = computeSelectionStats();
  // CURRENT formula bar shares the guarded cell draft; blur and bulk clipboard writes remain unported.
  const focusedRow = identityChanged ? undefined : rows[visibleFocus.row];
  // A valid draft is identified by row/column name, not by the old visual column index.
  const formulaDraft = currentSelection && !selectionConflict ? currentSelection : null;
  const formulaFocus = formulaDraft
    ? { row: formulaDraft.rowIndex, col: columns.findIndex(c => c.name === formulaDraft.column) }
    : visibleFocus;
  const formulaColumn = identityChanged ? undefined : columns[formulaFocus.col];
  const formulaReference = formulaColumn
    ? `${columnIndexToLetter(formulaFocus.col)}${(page - 1) * Math.max(1, limit) + formulaFocus.row + 1} (${formulaColumn.name})`
    : "—";
  const formulaValue = formulaDraft ? formulaDraft.value
    : focusedRow && focusedColumn ? cellValue(focusedRow[focusedColumn.name]) : "";
  const formulaCanStart = canMutate && currentSelection === null && !selectionConflict &&
    !!focusedRow && !!focusedColumn && focusedColumn.editable && focusedColumn.pk === 0 &&
    !focusedColumn.generated && primaryKey(focusedRow, primaryKeys) !== null;
  const formulaCanEdit = canMutate && (formulaDraft !== null || formulaCanStart);
  const formulaStatusText = identityChanged ? ""
    : inFlight.current !== null && historyInFlight.current === inFlight.current ? "履歴を適用中…"
    : busy ? "保存中…" : findHint || notice || (stats.cells > 1 ? `${stats.cells} セル` : "");

  // CURRENT keeps widths and an active drag by column name across mounted page/table changes.
  React.useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = resizeRef.current;
      if (!drag) return;
      const width = clampColumnWidth(drag.startWidth + event.clientX - drag.startX);
      setColWidths(previous => ({ ...previous, [drag.column]: width }));
    };
    const onUp = () => { resizeRef.current = null; setDragging(false); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);
  const insertColumns = columns.filter(c => !c.generated && (c.pk > 0 || c.editable));

  React.useEffect(() => {
    const old = previousContext.current;
    if (old.fetchFn !== fetchFn || old.table !== def.table ||
        old.page !== page || old.allowMutations !== allowMutations) {
      inFlight.current?.abort();
      inFlight.current = null;
      historyInFlight.current = null;
      previousContext.current = { fetchFn, table: def.table, page, allowMutations };
      setContextVersion(v => v + 1);
      setHistory({ key: "", undo: [], redo: [] });
      setCellEdit(null);
      setAnchorCell({ row: 0, col: 0 });
      setFocusedCell({ row: 0, col: 0 });
      setFindOpen(false);
      setFindQuery("");
      setFindHint(null);
      // CURRENT returns keyboard focus to the reset grid after a context replacement.
      (tableRef.current?.querySelector<HTMLTableCellElement>('[data-grid-cell="0:0"]') ?? tableRef.current)?.focus();
      setInsertOpen(false);
      setInsertDraft({});
      setBusy(false);
      setNotice(null);
    }
    return () => inFlight.current?.abort();
  }, [fetchFn, def.table, page, allowMutations]);

  // Keep the live draft and rendered conflict latch in sync, including after A→B→A refreshes.
  React.useEffect(() => {
    const draft = liveSelection.current;
    if (!currentSelection || !selectionConflict || currentSelection.invalidated || draft?.id !== currentSelection.id) return;
    setCellEdit({ ...draft, invalidated: true });
  }, [currentSelection, selectionConflict]);

  // Reconcile after every commit: a column key replacement can remove the focused TD without changing dimensions.
  React.useLayoutEffect(() => {
    formulaNavigationPending.current = false;
    if (identityChanged) {
      focusedGridElement.current = null;
      return;
    }
    if (anchorCell.row !== visibleAnchor.row || anchorCell.col !== visibleAnchor.col) setAnchorCell(visibleAnchor);
    if (focusedCell.row !== visibleFocus.row || focusedCell.col !== visibleFocus.col) setFocusedCell(visibleFocus);
    const previousFocus = focusedGridElement.current;
    if (!previousFocus || previousFocus.isConnected) return;
    // Consume even when an external control owns focus, so a later blur cannot revive this removed cell.
    focusedGridElement.current = null;
    const table = tableRef.current;
    if (!table || table.ownerDocument.activeElement !== table.ownerDocument.body) return;
    const cell = table.querySelector<HTMLTableCellElement>(
      '[data-grid-cell="' + visibleFocus.row + ":" + visibleFocus.col + '"]',
    );
    (cell ?? table).focus();
  });

  // CURRENT selects the typed character or places the caret at the end of the original value.
  // Initialize once per draft ID, including same-cell cancel/reopen that reuses the input.
  // Never reset a user's selection on value changes or act on an invalidated/replaced draft.
  React.useLayoutEffect(() => {
    const draft = liveSelection.current;
    const input = editorRef.current;
    if (focusEditId === null || draft?.id !== focusEditId || draft.invalidated || draft.fromFormula || !input || input.disabled) return;
    input.focus();
    if (draft.selectInitialText) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
  }, [focusEditId]);

  React.useEffect(() => {
    if (!findHint) return;
    const timer = window.setTimeout(() => setFindHint(null), 3500);
    return () => window.clearTimeout(timer);
  }, [findHint]);

  function setCellEdit(next: CellSelection | null): void {
    liveSelection.current = next;
    setSelection(next);
  }

  function startCellEdit(rowIndex: number, colIndex: number, initialChar?: string, fromFormula = false): boolean {
    const column = columns[colIndex];
    const row = rows[rowIndex];
    const pk = row ? primaryKey(row, primaryKeys) : null;
    if (!canMutate || inFlight.current !== null || !isCurrent() || displayedPage.current !== data ||
        (fromFormula && formulaNavigationPending.current) ||
        liveSelection.current !== null || selectionConflict || !column || !row || !pk ||
        !column.editable || column.pk !== 0 || column.generated) return false;
    const value = cellValue(row[column.name]);
    setCellEdit({ id: ++nextEditId.current, rowIndex, column: column.name, value: initialChar ?? value, key, pk,
      before: row[column.name] == null ? null : value, selectInitialText: initialChar !== undefined && !fromFormula, fromFormula });
    // CURRENT formula focus starts editing the existing endpoint without collapsing its range.
    if (!fromFormula) {
      const position = { row: rowIndex, col: colIndex };
      setAnchorCell(position);
      setFocusedCell(position);
    }
    return true;
  }

  // Also accept the formula-origin draft opened by focus in the same React batch.
  // A retired draft, another editor's draft, or a replaced page cannot receive input from an old callback.
  function liveFormulaDraft(): CellSelection | null {
    const draft = liveSelection.current;
    if (!formulaCanEdit || !draft || draft.invalidated || draft.key !== key ||
        inFlight.current !== null || !isCurrent() || displayedPage.current !== data) return null;
    if (formulaDraft?.id === draft.id ||
        (formulaCanStart && draft.fromFormula && draft.rowIndex === visibleFocus.row &&
          draft.column === focusedColumn?.name)) return draft;
    return null;
  }

  function ownsFormulaFocus(input: HTMLInputElement): boolean {
    return input.isConnected && input.ownerDocument.activeElement === input;
  }

  function changeFormulaValue(input: HTMLInputElement): void {
    // A delayed event on the old formula surface cannot edit the new endpoint
    // or overwrite the inline editor's live draft after focus has moved.
    if (!ownsFormulaFocus(input)) return;
    const value = input.value;
    const draft = liveFormulaDraft();
    if (draft) setCellEdit({ ...draft, value });
    else if (formulaCanStart && liveSelection.current === null) {
      startCellEdit(visibleFocus.row, visibleFocus.col, value, true);
    }
  }

  function handleFormulaKey(event: React.KeyboardEvent<HTMLInputElement>): void {
    // Native IME confirmation is not a request to persist a database edit.
    if (!ownsFormulaFocus(event.currentTarget) || event.nativeEvent.isComposing ||
        event.nativeEvent.keyCode === 229 || event.key === "Process") return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key === "c") {
      event.preventDefault();
      // The previous rectangle is no longer authoritative until navigation commits.
      if (!formulaNavigationPending.current && isCurrent() && displayedPage.current === data) void copyRange();
      return;
    }
    // CURRENT cancels the draft before requesting Undo/Redo, even with empty history.
    // Reuse the existing replay authority/serialization gate; never save the discarded draft.
    if (mod && (event.key === "z" || event.key === "y")) {
      event.preventDefault();
      if (identityChanged || !isCurrent() || displayedPage.current !== data ||
          formulaNavigationPending.current) return;
      const historyDraft = liveFormulaDraft();
      if (liveSelection.current !== null || currentSelection !== null) {
        if (!historyDraft) return; // Retired/invalidated drafts require explicit discard.
        const col = columns.findIndex(column => column.name === historyDraft.column);
        if (col < 0) return;
        cancelCellEdit(historyDraft.id, { row: historyDraft.rowIndex, col });
      } else if (rows.length && columns.length) {
        focusGridCell(visibleFocus);
      } else {
        tableRef.current?.focus();
      }
      if (isCurrent() && displayedPage.current === data) {
        void replay(event.key === "y" || event.shiftKey ? "redo" : "undo");
      }
      return;
    }
    // Bulk paste/cut still need the separate CURRENT lifecycle and API gates.
    // Keep non-CURRENT uppercase history spellings suppressed rather than invoking native input history.
    if (mod && ["v", "x", "z", "y"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      return;
    }
    const draft = liveFormulaDraft();
    if (!draft) {
      // CURRENT Enter/Tab still moves the endpoint when the formula has no edit.
      // An invalidated/retired draft or old DOM event must not become navigation.
      if (identityChanged || !isCurrent() || displayedPage.current !== data ||
          currentSelection !== null || liveSelection.current !== null) return;
      if (event.key === "Escape") {
        event.preventDefault();
        // Until the new endpoint commits, do not return focus to the old TD.
        if (formulaNavigationPending.current) return;
        if (rows.length && columns.length) focusGridCell(visibleFocus);
        else tableRef.current?.focus();
        return;
      }
      if (event.key !== "Enter" && event.key !== "Tab") return;
      // CURRENT formula navigation is independent of historyBusy. Editing/writes remain locked.
      event.preventDefault();
      if (formulaNavigationPending.current) return;
      const navigation = event.key === "Enter" ? "Enter" : event.shiftKey ? "ShiftTab" : "Tab";
      const next = moveSpreadsheetFocus(visibleFocus, navigation, rows.length, columns.length);
      const moved = next.row !== visibleFocus.row || next.col !== visibleFocus.col;
      // A boundary-clamped movement can still collapse a multi-cell rectangle.
      if (moved || next.row !== visibleAnchor.row || next.col !== visibleAnchor.col) {
        formulaNavigationPending.current = true;
      }
      setAnchorCell(next);
      setFocusedCell(next);
      // Keep focus on the formula input, as CURRENT does without a draft.
      if (moved) {
        tableRef.current?.querySelector<HTMLTableCellElement>(`[data-grid-cell="${next.row}:${next.col}"]`)
          ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      }
      return;
    }
    const col = columns.findIndex(column => column.name === draft.column);
    if (col < 0) return;
    const position = { row: draft.rowIndex, col };
    if (event.key === "Escape") {
      event.preventDefault();
      cancelCellEdit(draft.id, position);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const moveKey = event.key === "Enter" ? "ArrowDown" : event.shiftKey ? "ArrowLeft" : "ArrowRight";
      void saveCell(draft.id, moveSpreadsheetFocus(position, moveKey, rows.length, columns.length));
    }
  }

  function handleCellDoubleClick(event: React.MouseEvent<HTMLTableCellElement>, rowIndex: number, colIndex: number): void {
    // Only the data surface owns double-click entry; child controls/editor keep their own gestures.
    if (event.button !== 0 || (event.target !== event.currentTarget &&
        !(event.target instanceof HTMLElement && event.target.parentElement === event.currentTarget &&
          event.target.hasAttribute("data-grid-cell-content")))) return;
    // CURRENT opens the original display value. Retain the isolated live-draft and write-authority fence.
    startCellEdit(rowIndex, colIndex);
  }

  function cancelCellEdit(editId: number, position: GridCell): void {
    if (liveSelection.current?.id !== editId) return;
    setCellEdit(null);
    focusGridCell(position);
  }

  function isCurrent(): boolean {
    const v = contextRef.current;
    return v.fetchFn === fetchFn && v.table === def.table && v.page === page && v.allowMutations === allowMutations;
  }

  async function runMutation(
    operation: (signal: AbortSignal) => ReturnType<typeof patchSpreadsheetCell>,
  ): Promise<boolean> {
    if (!canMutate || inFlight.current !== null || !isCurrent()) return false;
    const controller = new AbortController();
    inFlight.current = controller;
    setBusy(true);
    setNotice(null);
    try {
      const result = await operation(controller.signal);
      if (controller.signal.aborted || !isCurrent()) return false;
      if (result.status !== "ok") {
        setNotice(statusMessage(result.status));
        return false;
      }
      setNotice(result.data.pendingPublicReflection
        ? "保存しました。公開ページへの反映は再生成後です。" : "保存しました。");
      try {
        await onRefresh();
      } catch {
        if (!controller.signal.aborted && isCurrent()) {
          setNotice("保存済みですが、再取得できませんでした。画面を再読み込みしてください。");
        }
      }
      return !controller.signal.aborted && isCurrent() && inFlight.current === controller;
    } catch {
      if (!controller.signal.aborted && isCurrent()) setNotice("保存状態を確認できません。再読み込みしてください。");
      return false;
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }

  // Keep snapshot, consumption and completion ordering together so queued input/focus events cannot resubmit a draft.
  async function saveCell(editId: number, nextFocus?: GridCell): Promise<void> {
    const draft = liveSelection.current;
    if (!draft || draft.id !== editId || draft.key !== key || draft.invalidated || selectionConflict ||
        !canMutate || inFlight.current !== null || !isCurrent()) return;
    const { pk, column } = draft;
    const colIndex = columns.findIndex(c => c.name === column);
    const before = draft.before === "" ? null : draft.before;
    const trimmed = draft.value.trim();
    const after = trimmed === "" || trimmed.toUpperCase() === "NULL" ? null : draft.value;
    setCellEdit(null);
    if (nextFocus) {
      setAnchorCell(nextFocus);
      focusGridCell(nextFocus);
    }
    if ((after ?? "") === (draft.before ?? "")) return;
    const operationContext = previousContext.current;
    const ok = await runMutation(signal => patchSpreadsheetCell(fetchFn, {
      table: def.table, primaryKey: pk, column, value: after,
    }, signal));
    if (previousContext.current !== operationContext || !isCurrent() || !tableRef.current) return;
    if (!ok) {
      const latest = displayedPage.current;
      if (latest.rows.length === 0 || latest.columns.length === 0) return;
      // The failed target can move or disappear while PATCH is pending; never restore stale coordinates.
      const matchingRow = Object.keys(pk).length === latest.primaryKeys.length
        ? latest.rows.findIndex(row => {
          const candidate = primaryKey(row, latest.primaryKeys);
          return candidate !== null && latest.primaryKeys.every(name => Object.hasOwn(pk, name) && candidate[name] === pk[name]);
        }) : -1;
      const matchingColumn = latest.columns.findIndex(c => c.name === column);
      const position = {
        row: matchingRow >= 0 ? matchingRow : Math.min(draft.rowIndex, latest.rows.length - 1),
        col: matchingColumn >= 0 ? matchingColumn : Math.min(colIndex, latest.columns.length - 1),
      };
      setAnchorCell(position);
      const table = tableRef.current;
      const active = table.ownerDocument.activeElement;
      if (table.contains(active) || active === table.ownerDocument.body) focusGridCell(position);
      else setFocusedCell(position);
      return;
    }
    const entry: Change = { table: def.table, page, pk, column, before, after };
    setHistory(state => {
      const prev = state.key === key ? state.undo : [];
      return { key, undo: [...prev, entry].slice(-HISTORY_LIMIT), redo: [] };
    });
  }

  async function replay(direction: "undo" | "redo"): Promise<void> {
    const source = safeHistory[direction];
    const entry = source[source.length - 1];
    if (!entry || !canMutate || inFlight.current !== null || entry.table !== def.table || entry.page !== page) return;
    const value = direction === "undo" ? entry.before : entry.after;
    const pending = runMutation(signal => patchSpreadsheetCell(fetchFn, {
      table: def.table, primaryKey: entry.pk, column: entry.column, value,
    }, signal));
    const controller = inFlight.current;
    historyInFlight.current = controller;
    const ok = await pending.finally(() => {
      if (historyInFlight.current === controller) historyInFlight.current = null;
    });
    if (!ok) return;
    setHistory(state => {
      if (state.key !== key) return state;
      const src = state[direction];
      if (src[src.length - 1] !== entry) return state;
      return direction === "undo"
        ? { key, undo: state.undo.slice(0, -1), redo: [...state.redo, entry] }
        : { key, undo: [...state.undo, entry], redo: state.redo.slice(0, -1) };
    });
  }

  async function copyRange(): Promise<void> {
    if (identityChanged || rows.length === 0 || columns.length === 0) return;
    const text = copySpreadsheetSelection(rows, columns, visibleAnchor, visibleFocus);
    if (!text) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      if (isCurrent()) setNotice("選択範囲をコピーしました。");
    } catch {
      if (isCurrent()) setNotice("クリップボードへのコピーが許可されていません。");
    }
  }

  async function copyEditorValue(editId: number, input: HTMLInputElement): Promise<void> {
    const draft = liveSelection.current;
    if (!draft || draft.id !== editId) return;
    const doc = input.ownerDocument;
    const isLive = () => liveSelection.current === draft && !draft.invalidated && !selectionConflict &&
      isCurrent() && displayedPage.current === data && editorRef.current === input &&
      input.isConnected && !input.disabled;
    if (!isLive()) return;
    try {
      await navigator.clipboard.writeText(draft.value);
      return;
    } catch {
      // CURRENT falls back to a temporary textarea. Never retry a retired or changed draft.
    }
    if (!isLive() || doc.activeElement !== input || typeof doc.execCommand !== "function") return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const direction = input.selectionDirection;
    const textarea = doc.createElement("textarea");
    textarea.value = draft.value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    try {
      doc.body.appendChild(textarea);
      textarea.focus();
      // Focus/select can synchronously hand control to another element. Never copy its selection.
      if (!isLive() || doc.activeElement !== textarea) return;
      textarea.select();
      if (isLive() && doc.activeElement === textarea) doc.execCommand("copy");
    } catch {
      // Like CURRENT, the editor shortcut has no success/failure notice.
    } finally {
      const restore = doc.activeElement === textarea || doc.activeElement === input;
      textarea.remove();
      if (restore && isLive()) {
        input.focus();
        if (start !== null && end !== null) input.setSelectionRange(start, end, direction ?? "none");
      }
    }
  }

  function focusGridCell(focus: GridCell): void {
    setFocusedCell(focus);
    // The next key originates from the selected endpoint, including after whole-row/column selection.
    tableRef.current?.querySelector<HTMLTableCellElement>(`[data-grid-cell="${focus.row}:${focus.col}"]`)?.focus();
  }

  function canSelectWithPointer(): boolean {
    // CURRENT permits pointer selection during history; keep the live draft fence until blur-save is ported.
    return !identityChanged && isCurrent() && liveSelection.current === null &&
      rows.length > 0 && columns.length > 0;
  }

  function canUseFind(): boolean {
    // Keep the existing draft fence until CURRENT blur-save is ported. Ordinary saves are not historyBusy.
    return !identityChanged && isCurrent() && liveSelection.current === null &&
      !(inFlight.current !== null && historyInFlight.current === inFlight.current);
  }

  function openFind(event: React.KeyboardEvent<HTMLElement>): boolean {
    if (!(event.ctrlKey || event.metaKey) || event.key !== "f" || !canUseFind()) return false;
    event.preventDefault();
    setFindOpen(true);
    return true;
  }

  function boundCellToPage(position: GridCell): GridCell {
    return {
      row: Math.max(0, Math.min(rows.length - 1, position.row)),
      col: Math.max(0, Math.min(columns.length - 1, position.col)),
    };
  }

  function computeSelectionStats() {
    if (identityChanged) return { cells: 0, filled: 0, numericSum: null, preview: "" };
    const r0 = Math.min(visibleAnchor.row, visibleFocus.row);
    const r1 = Math.max(visibleAnchor.row, visibleFocus.row);
    const c0 = Math.min(visibleAnchor.col, visibleFocus.col);
    const c1 = Math.max(visibleAnchor.col, visibleFocus.col);
    let cells = 0;
    let filled = 0;
    let numericSum = 0;
    let numericCount = 0;
    const previews: string[] = [];
    for (let r = r0; r <= r1; r++) {
      const row = rows[r];
      if (!row) continue;
      for (let c = c0; c <= c1; c++) {
        const column = columns[c];
        if (!column) continue;
        cells += 1;
        const value = cellValue(row[column.name]);
        if (value !== "") filled += 1;
        if (value !== "" && previews.length < 3) previews.push(value);
        const number = Number(value);
        if (value !== "" && !Number.isNaN(number) && Number.isFinite(number)) {
          numericSum += number;
          numericCount += 1;
        }
      }
    }
    return { cells, filled, numericSum: numericCount > 0 ? numericSum : null, preview: previews.join(" · ") };
  }

  function findNext(): void {
    if (!canUseFind()) return;
    const from = boundCellToPage(focusedCell);
    setAnchorCell(boundCellToPage(anchorCell));
    setFocusedCell(from);
    if (!findQuery.trim() || rows.length === 0 || columns.length === 0) {
      setFindHint("見つかりません");
      return;
    }
    const origin = from.row * columns.length + from.col;
    const count = rows.length * columns.length;
    const query = findQuery.toLowerCase();
    // CURRENT scans after the focused endpoint, wraps once, and excludes that endpoint even after wrapping.
    for (let step = 1; step < count; step++) {
      const index = (origin + step) % count;
      const position = { row: Math.floor(index / columns.length), col: index % columns.length };
      if (!cellValue(rows[position.row][columns[position.col].name]).toLowerCase().includes(query)) continue;
      setAnchorCell(position);
      setFocusedCell(position);
      // Next preserves the search input/button's DOM focus while revealing the selected cell.
      tableRef.current?.querySelector<HTMLTableCellElement>(
        '[data-grid-cell="' + position.row + ":" + position.col + '"]',
      )?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      if (index < origin) setFindHint("先頭から検索");
      return;
    }
    setFindHint("見つかりません");
  }

  function closeFind(): void {
    if (!canUseFind()) return;
    setFindOpen(false);
    setAnchorCell(boundCellToPage(anchorCell));
    if (rows.length > 0 && columns.length > 0) focusGridCell(boundCellToPage(focusedCell));
    else {
      setFocusedCell({ row: 0, col: 0 });
      tableRef.current?.focus();
    }
  }

  // Keep CURRENT shortcut precedence and editor ownership in one dispatcher; Shift+Space wins over Ctrl/Cmd+Space.
  function handleGridKey(
    event: React.KeyboardEvent<HTMLTableCellElement>,
    rowIndex: number,
    colIndex: number,
  ): void {
    // Inputs/buttons own their own shortcuts and text-selection semantics.
    if (event.target !== event.currentTarget) return;
    if (openFind(event)) return;
    const shortcut = event.ctrlKey || event.metaKey;
    const selectAll = shortcut && event.key === "a";
    const selectRow = event.key === " " && event.shiftKey;
    const selectColumn = event.key === " " && shortcut;
    if (selectAll || selectRow || selectColumn) {
      const historyBusy = inFlight.current !== null && historyInFlight.current === inFlight.current;
      if (identityChanged || currentSelection || historyBusy || rows.length === 0 || columns.length === 0) return;
      event.preventDefault();
      setAnchorCell({ row: selectRow ? rowIndex : 0, col: selectAll || selectRow ? 0 : colIndex });
      focusGridCell(
        { row: selectRow ? rowIndex : rows.length - 1, col: selectAll || selectRow ? columns.length - 1 : colIndex },
      );
      return;
    }
    if (shortcut && !event.altKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copyRange();
      return;
    }
    if (shortcut && !event.altKey && event.key.toLowerCase() === "z" && canMutate) {
      event.preventDefault();
      void replay(event.shiftKey ? "redo" : "undo");
      return;
    }
    if (event.key === "F2") {
      const historyBusy = inFlight.current !== null && historyInFlight.current === inFlight.current;
      if (identityChanged || !isCurrent() || displayedPage.current !== data || liveSelection.current !== null ||
          historyBusy || !rows[rowIndex] || !columns[colIndex]) return;
      // CURRENT consumes F2 and collapses selection even when the focused column cannot be edited.
      // The isolated editor retains its stricter live PK/authority/write fence.
      event.preventDefault();
      if (!startCellEdit(rowIndex, colIndex)) {
        const position = { row: rowIndex, col: colIndex };
        setAnchorCell(position);
        focusGridCell(position);
      }
      return;
    }
    if (event.key.length === 1 && !shortcut && !event.altKey) {
      // CURRENT starts an edit with the delivered character (not the previous display value).
      // Only consume after a valid isolated draft is created; keep its original PK/value for save/undo.
      if (startCellEdit(rowIndex, colIndex, event.key)) event.preventDefault();
      return;
    }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Tab", "Enter"].includes(event.key)) return;
    const historyBusy = inFlight.current !== null && historyInFlight.current === inFlight.current;
    if (identityChanged || !isCurrent() || liveSelection.current !== null || historyBusy ||
        rows.length === 0 || columns.length === 0) return;
    const navigation = event.key === "Enter" ? "Enter" : event.key === "Tab" ? (event.shiftKey ? "ShiftTab" : "Tab")
      : shortcut && !event.key.startsWith("Page") ? `Ctrl${event.key}` : event.key;
    const moved = moveSpreadsheetFocus({ row: rowIndex, col: colIndex }, navigation, rows.length, columns.length);
    event.preventDefault();
    if (!(event.shiftKey && navigation.startsWith("Arrow"))) setAnchorCell(moved);
    focusGridCell(moved);
    if (moved.row !== rowIndex || moved.col !== colIndex) {
      tableRef.current?.querySelector<HTMLTableCellElement>(`[data-grid-cell="${moved.row}:${moved.col}"]`)
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }

  async function addRow(): Promise<void> {
    if (!canMutate || !insertOpen) return;
    const row: Record<string, string> = {};
    for (const c of insertColumns) {
      const value = insertDraft[c.name];
      if (value != null && value !== "") row[c.name] = value;
    }
    if (Object.keys(row).length === 0 ||
        primaryKeys.some(c => !(c in row))) {
      setNotice("追加する行の主キーを入力してください。");
      return;
    }
    const ok = await runMutation(signal => insertSpreadsheetRow(fetchFn, { table: def.table, row }, signal));
    if (ok) {
      setInsertOpen(false);
      setInsertDraft({});
      setHistory({ key, undo: [], redo: [] });
      setCellEdit(null);
    }
  }

  async function removeRow(index: number): Promise<void> {
    const row = rows[index];
    if (!canMutate || !row) return;
    const pk = primaryKey(row, primaryKeys);
    if (!pk) { setNotice("主キーが不足しているため削除できません。"); return; }
    if (!confirmDelete("選択した行を削除します。元に戻せません。続行しますか？")) return;
    const ok = await runMutation(signal => deleteSpreadsheetRow(fetchFn, { table: def.table, primaryKey: pk }, signal));
    if (ok) {
      setCellEdit(null);
      setHistory({ key, undo: [], redo: [] });
    }
  }

  return (
    <section aria-label="管理スプレッドシート編集">
      <style>{`
        [data-spreadsheet-grid-viewport] {
          --sheet-bg: #ffffff;
          --sheet-header-bg: #f8f9fa;
          --sheet-focus: #1a73e8;
          --sheet-focus-soft: color-mix(in srgb, #1a73e8 10%, #ffffff);
        }
        [data-spreadsheet-grid-status] {
          --sheet-header-bg: #f8f9fa;
          --sheet-border: #dadce0;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 12px;
          padding: 4px 10px;
          font-size: 11px;
          color: var(--text-muted);
          border-top: 1px solid var(--sheet-border);
          background: var(--sheet-header-bg);
        }
        [data-spreadsheet-grid-status-preview] {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-align: right;
        }
        :root[data-theme="dark"] [data-spreadsheet-grid-viewport] {
          --sheet-bg: var(--bg-base, #1a1a1a);
          --sheet-header-bg: var(--bg-elevated, #252525);
          --sheet-focus: var(--accent-primary, #8ab4f8);
          --sheet-focus-soft: color-mix(in srgb, var(--accent-primary, #8ab4f8) 14%, var(--bg-base, #1a1a1a));
        }
        :root[data-theme="dark"] [data-spreadsheet-grid-status] {
          --sheet-header-bg: var(--bg-elevated, #252525);
          --sheet-border: var(--border-subtle, #3c4043);
        }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]):not([data-theme="dark"]) [data-spreadsheet-grid-viewport] {
            --sheet-bg: var(--bg-base, #1a1a1a);
            --sheet-header-bg: var(--bg-elevated, #252525);
            --sheet-focus: var(--accent-primary, #8ab4f8);
            --sheet-focus-soft: color-mix(in srgb, var(--accent-primary, #8ab4f8) 14%, var(--bg-base, #1a1a1a));
          }
          :root:not([data-theme="light"]):not([data-theme="dark"]) [data-spreadsheet-grid-status] {
            --sheet-header-bg: var(--bg-elevated, #252525);
            --sheet-border: var(--border-subtle, #3c4043);
          }
        }
        [data-spreadsheet-formula-bar] {
          --sheet-bg: #ffffff;
          --sheet-border: #dadce0;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          border-bottom: 1px solid var(--sheet-border);
          background: var(--sheet-bg);
        }
        [data-spreadsheet-formula-reference] {
          flex-shrink: 0;
          min-width: 100px;
          max-width: min(200px, 100%);
          padding: 6px 10px;
          font: 600 12px var(--font-mono, ui-monospace, monospace);
          color: var(--text-secondary);
          border-right: 1px solid var(--sheet-border);
          text-align: center;
          overflow-wrap: anywhere;
        }
        [data-spreadsheet-formula-fx] {
          flex-shrink: 0;
          padding: 6px 8px;
          font-size: 11px;
          font-style: italic;
          color: var(--text-muted);
          border-right: 1px solid var(--sheet-border);
          user-select: none;
        }
        [data-spreadsheet-formula-value] {
          flex: 1 1 100px;
          min-width: 0;
          min-height: 1em;
          padding: 6px 10px;
          font: 13px var(--font-mono, ui-monospace, monospace);
          color: var(--text-primary);
          border: 0;
          border-radius: 0;
          box-sizing: border-box;
          background: transparent;
          white-space: pre;
          overflow: hidden;
          text-overflow: ellipsis;
          user-select: text;
        }
        [data-spreadsheet-formula-status] {
          flex-shrink: 1;
          min-width: 80px;
          max-width: 100%;
          overflow-wrap: anywhere;
          padding: 0 10px;
          font-size: 11px;
          color: var(--text-muted);
          text-align: right;
        }
        :root[data-theme="dark"] [data-spreadsheet-formula-bar] {
          --sheet-bg: var(--bg-base, #1a1a1a);
          --sheet-border: var(--border-subtle, #3c4043);
        }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]):not([data-theme="dark"]) [data-spreadsheet-formula-bar] {
            --sheet-bg: var(--bg-base, #1a1a1a);
            --sheet-border: var(--border-subtle, #3c4043);
          }
        }
        @media (max-width: 640px) {
          [data-spreadsheet-formula-bar] { flex-wrap: wrap; }
          [data-spreadsheet-formula-reference] { min-width: 72px; max-width: 100%; flex: 0 1 auto; }
          [data-spreadsheet-formula-value] { flex: 1 1 100%; font-size: 16px; }
        }
      `}</style>
      <p>{editable ? "編集可能な列のみ変更できます。主キー列は変更できません。" : "読み取り専用（編集は無効です）。"}</p>
      {notice ? <p role="status">{notice}</p> : null}
      {!identityChanged && findHint ? <p role="status">{findHint}</p> : null}
      {findOpen && !identityChanged ? (
        <div role="search" aria-label="ページ内検索">
          <label>検索
            <input type="search" autoFocus value={findQuery} disabled={!canFind}
              onChange={event => { if (canUseFind()) setFindQuery(event.target.value); }}
              onKeyDown={event => {
                if (event.key === "Enter") findNext();
                if (event.key === "Escape") closeFind();
              }} />
          </label>
          <button type="button" disabled={!canFind} onClick={findNext}>次へ</button>
          <button type="button" disabled={!canFind} onClick={closeFind}>閉じる</button>
        </div>
      ) : null}
      <div role="toolbar" aria-label="編集操作">
        <button type="button" disabled={!canMutate || safeHistory.undo.length === 0}
          onClick={() => void replay("undo")}>元に戻す</button>
        <button type="button" disabled={!canMutate || safeHistory.redo.length === 0}
          onClick={() => void replay("redo")}>やり直す</button>
        <button type="button" disabled={!canMutate || primaryKeys.length === 0}
          onClick={() => { setInsertOpen(v => !v); setNotice(null); }}>行を追加</button>
      </div>
      {insertOpen && editable && !identityChanged ? (
        <div aria-label="新規行フォーム">
          {insertColumns.map(c => (
            <label key={c.name}>{c.name}
              <input type="text" value={insertDraft[c.name] ?? ""} disabled={busy}
                onChange={e => setInsertDraft(d => ({ ...d, [c.name]: e.target.value }))} />
            </label>
          ))}
          <button type="button" disabled={!canMutate} onClick={() => void addRow()}>追加を保存</button>
        </div>
      ) : null}
      <p>矢印キーで移動、Shift＋矢印で範囲選択、Ctrl/Cmd＋Aで全体選択、Shift＋Spaceで行選択、Ctrl/Cmd＋Spaceで列選択、Ctrl/Cmd＋CでTSVコピー、Enterで下へ移動、F2または編集ボタンで編集、文字キーで入力を開始できます。</p>
      <p>セルのドラッグで範囲選択できます。見出しのクリックで全体・行・列を選択し、Shift＋行・列見出しで現在の始点から範囲を広げられます。</p>
      <p>編集中はEnterで確定して下へ、Tabで確定して右へ、Shift＋Tabで確定して左へ移動できます。Escapeでキャンセルできます。</p>
      <p>Ctrl/Cmd＋Fで現在のページ内を検索できます。</p>
      {currentSelection && selectionConflict && !busy ? (
        <div role="alert">
          <p>編集中の行または列の状態が変更されました。編集を破棄して最新の内容を確認してください。</p>
          <button type="button" onClick={() => setCellEdit(null)}>編集を破棄</button>
        </div>
      ) : currentSelection && !selectionConflict ? (
        <p>見出しで選択する前に、セルを保存するかキャンセルしてください。</p>
      ) : null}
      <div data-spreadsheet-formula-bar="" role="group" aria-label="数式バー">
        <div data-spreadsheet-formula-reference="" aria-live="polite" title="セル参照">{formulaReference}</div>
        <span data-spreadsheet-formula-fx="" aria-hidden="true">fx</span>
        <input data-spreadsheet-formula-value="" type="text" aria-label="セルの値"
          title={formulaValue} value={formulaValue} readOnly={!formulaCanEdit}
          placeholder={formulaCanEdit ? "" : "読み取り専用"}
          onFocus={event => {
            if (formulaCanStart && ownsFormulaFocus(event.currentTarget)) {
              startCellEdit(visibleFocus.row, visibleFocus.col, undefined, true);
            }
          }}
          onChange={event => changeFormulaValue(event.currentTarget)}
          onKeyDown={handleFormulaKey}
          onPaste={event => event.preventDefault()}
          onCut={event => event.preventDefault()} />
        <span data-spreadsheet-formula-status="">{formulaStatusText}</span>
      </div>
      <div data-spreadsheet-grid-viewport="" style={{ overflowX: "auto" }}>
        <table ref={tableRef} tabIndex={rows.length === 0 || columns.length === 0 ? 0 : -1}
          style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 12, minWidth: "max-content", width: "100%" }}
          onFocusCapture={event => {
            const target = event.target;
            focusedGridElement.current = target instanceof HTMLElement && target.tagName === "TD" &&
              target.hasAttribute("data-grid-cell") ? target : null;
          }}
          onBlurCapture={() => {
            // Explicit blur of a connected cell gives up ownership; removal-triggered blur is handled after commit.
            if (focusedGridElement.current?.isConnected) focusedGridElement.current = null;
          }}
          onKeyDown={event => { if (event.target === event.currentTarget) openFind(event); }}>
          <colgroup>
            <col style={{ width: 46 }} />
            {columns.map(column => <col key={column.name} style={{ width: colWidth(column.name) }} />)}
            <col />
          </colgroup>
          <thead><tr>
            <th scope="col" data-grid-all-header="" aria-label="全セルを選択" title="クリックで全選択"
              aria-disabled={!canSelectHeaders} style={{ userSelect: "none" }}
              onMouseDown={(event) => {
                event.preventDefault();
                if (!canSelectHeaders) return;
                const end = { row: rows.length - 1, col: columns.length - 1 };
                setAnchorCell({ row: 0, col: 0 });
                const table = event.currentTarget.closest("table");
                if (table?.contains(event.currentTarget.ownerDocument.activeElement)) focusGridCell(end);
                else setFocusedCell(end);
              }} />
            {columns.map((c, ci) => {
              const letter = columnIndexToLetter(ci);
              // Label, selection and resize stay on the same header to preserve event propagation.
              return (
              <th key={c.name} scope="col" data-grid-column-header={ci} title={`${c.name} (${c.type})`}
                aria-disabled={!canSelectHeaders}
                style={{ userSelect: "none", position: "relative", width: colWidth(c.name), padding: 0, maxWidth: 280 }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  if (!canSelectHeaders) return;
                  if (!event.shiftKey) setAnchorCell({ row: 0, col: ci });
                  focusGridCell({ row: rows.length - 1, col: ci });
                }}
                onDoubleClick={() => {
                  let width = MIN_COL_WIDTH;
                  const cells = tableRef.current?.querySelectorAll<HTMLElement>(
                    `[data-grid-cell$=":${ci}"] [data-grid-cell-content]`,
                  );
                  cells?.forEach(cell => {
                    // CURRENT measures .cell only; empty .cellEmpty spans and active inputs are excluded.
                    if (cell.textContent !== "") width = Math.max(width, cell.scrollWidth + 16);
                  });
                  setColWidths(previous => ({ ...previous, [c.name]: clampColumnWidth(width) }));
                }}>
                <span data-grid-column-letter="" style={{ display: "block", fontSize: 10, fontWeight: 700, lineHeight: 1.2 }}>{letter}</span>
                <span style={{ display: "block", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, fontWeight: 500 }}>{c.name}</span>
                <span data-grid-column-resizer=""
                  style={{ position: "absolute", top: 0, right: 0, width: 5, height: "100%", cursor: "col-resize", zIndex: 3 }}
                  onMouseDown={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    resizeRef.current = { column: c.name, startX: event.clientX, startWidth: colWidth(c.name) };
                    setDragging(true);
                  }} />
              </th>
              );
            })}<th scope="col">操作</th>
          </tr></thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                <th scope="row" data-grid-row-header={ri} title="クリックで行選択"
                  aria-disabled={!canSelectHeaders} style={{ userSelect: "none" }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    if (event.button !== 0 || !canSelectHeaders) return;
                    if (!event.shiftKey) setAnchorCell({ row: ri, col: 0 });
                    focusGridCell({ row: ri, col: columns.length - 1 });
                  }}>{(page - 1) * Math.max(1, limit) + ri + 1}</th>
                {columns.map(c => {
                const value = cellValue(row[c.name]);
                const findHit = !identityChanged && findQuery !== "" && value.toLowerCase().includes(findQuery.toLowerCase());
                const canEdit = editable && c.editable && c.pk === 0 && !c.generated &&
                  primaryKey(row, primaryKeys) !== null;
                const editing = !selectionConflict && currentSelection?.rowIndex === ri && currentSelection?.column === c.name;
                const selected = !identityChanged && ri >= Math.min(visibleAnchor.row, visibleFocus.row) &&
                  ri <= Math.max(visibleAnchor.row, visibleFocus.row) &&
                  columns.indexOf(c) >= Math.min(visibleAnchor.col, visibleFocus.col) &&
                  columns.indexOf(c) <= Math.max(visibleAnchor.col, visibleFocus.col);
                const focused = !identityChanged && visibleFocus.row === ri && visibleFocus.col === columns.indexOf(c);
                return (
                  <td key={c.name} data-grid-cell={`${ri}:${columns.indexOf(c)}`}
                    data-find-match={findHit || undefined}
                    style={{ width: colWidth(c.name), padding: 0, maxWidth: 280, verticalAlign: "middle",
                      background: findHit ? "color-mix(in srgb, #fbbc04 35%, var(--sheet-bg, var(--bg-base, #fff)))" :
                        !canEdit ? "var(--sheet-header-bg)" : selected ? "var(--sheet-focus-soft)" : "var(--sheet-bg)",
                      boxShadow: focused ? "inset 0 0 0 2px var(--sheet-focus)" : undefined,
                      position: focused ? "relative" : undefined, zIndex: focused ? 1 : undefined }}
                    tabIndex={visibleFocus.row === ri && visibleFocus.col === columns.indexOf(c) ? 0 : -1}
                    aria-selected={selected}
                    onMouseDown={(event) => {
                      if (event.button !== 0) return;
                      if (event.target !== event.currentTarget &&
                          !(event.target instanceof HTMLElement && event.target.hasAttribute("data-grid-cell-content"))) return;
                      event.preventDefault();
                      if (!canSelectWithPointer()) return;
                      const position = boundCellToPage({ row: ri, col: columns.indexOf(c) });
                      setDragging(true);
                      if (!event.shiftKey) setAnchorCell(position);
                      focusGridCell(position);
                      event.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest" });
                    }}
                    onMouseEnter={(event) => {
                      if (!dragging || !canSelectWithPointer()) return;
                      const position = boundCellToPage({ row: ri, col: columns.indexOf(c) });
                      const table = tableRef.current;
                      const active = event.currentTarget.ownerDocument.activeElement;
                      // Roving TD keys use their coordinates; transfer only focus already owned by this grid.
                      if (table && (active === table || (active instanceof HTMLElement && active.tagName === "TD" &&
                          active.hasAttribute("data-grid-cell") && table.contains(active)))) focusGridCell(position);
                      else setFocusedCell(position);
                      event.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest" });
                    }}
                    onDoubleClick={(event) => handleCellDoubleClick(event, ri, columns.indexOf(c))}
                    onKeyDown={(event) => handleGridKey(event, ri, columns.indexOf(c))}>{editing && currentSelection ? (
                    <label>{c.name} を編集
                      <input ref={editorRef} type="text" autoFocus={!currentSelection.fromFormula} disabled={!canMutate} value={currentSelection.value}
                        onChange={e => {
                          const draft = liveSelection.current;
                          if (draft?.id === currentSelection.id && !draft.invalidated) setCellEdit({ ...draft, value: e.target.value });
                        }}
                        onKeyDown={event => {
                          if ((event.ctrlKey || event.metaKey) && event.key === "c") {
                            event.preventDefault();
                            void copyEditorValue(currentSelection.id, event.currentTarget);
                            return;
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelCellEdit(currentSelection.id, { row: ri, col: columns.indexOf(c) });
                            return;
                          }
                          if (event.key !== "Enter" && event.key !== "Tab") return;
                          event.preventDefault();
                          const moveKey = event.key === "Enter" ? "ArrowDown" : event.shiftKey ? "ArrowLeft" : "ArrowRight";
                          void saveCell(currentSelection.id, moveSpreadsheetFocus(
                            { row: ri, col: columns.indexOf(c) }, moveKey, rows.length, columns.length,
                          ));
                        }} />
                      <button type="button" disabled={!canMutate}
                        onClick={() => void saveCell(currentSelection.id, { row: ri, col: columns.indexOf(c) })}>セルを保存</button>
                      <button type="button" disabled={busy}
                        onClick={() => cancelCellEdit(currentSelection.id, { row: ri, col: columns.indexOf(c) })}>キャンセル</button>
                    </label>
                  ) : (
                    <><span data-grid-cell-content="" style={value === "" ? { display: "block", minHeight: 20 } : {
                      display: "block", padding: "2px 6px", lineHeight: "20px", overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280,
                      fontFamily: "var(--font-mono, ui-monospace, monospace)", wordBreak: "break-word",
                    }}>{value}</span>{canEdit ? (
                      <button type="button" disabled={!canMutate || currentSelection !== null || selectionConflict} aria-label={String(ri + 1) + "行 " + c.name + " を編集"}
                        onClick={() => startCellEdit(ri, columns.indexOf(c))}>編集</button>
                    ) : null}</>
                  )}</td>
                );
              })}<td>
                <button type="button" disabled={!canMutate || !primaryKey(row, primaryKeys)}
                  aria-label={String(ri + 1) + "行を削除"} onClick={() => void removeRow(ri)}>削除</button>
              </td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div data-spreadsheet-grid-status="">
        <span>{stats.cells > 1 ? `${stats.cells} セル · 入力 ${stats.filled}` : focusedColumn
          ? `${focusedColumn.type}${focusedColumn.notNull ? " · 必須" : ""}${focusedColumn.pk > 0 ? " · PK" : ""}` : ""}</span>
        {stats.numericSum != null ? <span>合計 {stats.numericSum.toLocaleString()}</span> : null}
        {stats.preview ? <span data-spreadsheet-grid-status-preview="" title={stats.preview}>{stats.preview}</span> : null}
      </div>
    </section>
  );
}
