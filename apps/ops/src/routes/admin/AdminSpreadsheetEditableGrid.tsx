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
type CellSelection = { rowIndex: number; column: string; value: string; key: string };
const HISTORY_LIMIT = 100;

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
  const { def, rows, columns, primaryKeys, page } = data;
  const [selection, setSelection] = React.useState<CellSelection | null>(null);
  const [anchorCell, setAnchorCell] = React.useState<GridCell>({ row: 0, col: 0 });
  const [focusedCell, setFocusedCell] = React.useState<GridCell>({ row: 0, col: 0 });
  const [insertOpen, setInsertOpen] = React.useState(false);
  const [insertDraft, setInsertDraft] = React.useState<Record<string, string>>({});
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [history, setHistory] = React.useState<History>({ key: "", undo: [], redo: [] });
  const inFlight = React.useRef<AbortController | null>(null);
  const contextRef = React.useRef({ fetchFn, table: def.table, page, allowMutations });
  contextRef.current = { fetchFn, table: def.table, page, allowMutations };
  const previousContext = React.useRef(contextRef.current);
  const [contextVersion, setContextVersion] = React.useState(0);
  const key = def.table + ":" + page + ":" + contextVersion;
  const previous = previousContext.current;
  const identityChanged = previous.fetchFn !== fetchFn || previous.table !== def.table ||
    previous.page !== page || previous.allowMutations !== allowMutations;
  const editable = allowMutations && def.mode === "editable";
  const canMutate = editable && !identityChanged && !busy && inFlight.current == null;
  const safeHistory = !identityChanged && history.key === key ? history : { key, undo: [], redo: [] };
  const currentSelection = !identityChanged && selection?.key === key ? selection : null;
  const insertColumns = columns.filter(c => !c.generated && (c.pk > 0 || c.editable));

  React.useEffect(() => {
    const old = previousContext.current;
    if (old.fetchFn !== fetchFn || old.table !== def.table ||
        old.page !== page || old.allowMutations !== allowMutations) {
      inFlight.current?.abort();
      inFlight.current = null;
      previousContext.current = { fetchFn, table: def.table, page, allowMutations };
      setContextVersion(v => v + 1);
      setHistory({ key: "", undo: [], redo: [] });
      setSelection(null);
      setAnchorCell({ row: 0, col: 0 });
      setFocusedCell({ row: 0, col: 0 });
      setInsertOpen(false);
      setInsertDraft({});
      setBusy(false);
      setNotice(null);
    }
    return () => inFlight.current?.abort();
  }, [fetchFn, def.table, page, allowMutations]);

  function isCurrent(): boolean {
    const v = contextRef.current;
    return v.fetchFn === fetchFn && v.table === def.table && v.page === page && v.allowMutations === allowMutations;
  }

  async function runMutation(
    operation: (signal: AbortSignal) => ReturnType<typeof patchSpreadsheetCell>,
  ): Promise<boolean> {
    if (!canMutate || !isCurrent()) return false;
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
        if (!controller.signal.aborted) setNotice("保存済みですが、再取得できませんでした。画面を再読み込みしてください。");
      }
      return true;
    } catch {
      if (!controller.signal.aborted) setNotice("保存状態を確認できません。再読み込みしてください。");
      return false;
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }

  async function saveCell(): Promise<void> {
    if (!currentSelection || !canMutate) return;
    const column = columns.find(c => c.name === currentSelection.column);
    const row = rows[currentSelection.rowIndex];
    if (!column || !row || !column.editable || column.pk > 0 || column.generated) return;
    const pk = primaryKey(row, primaryKeys);
    if (!pk) { setNotice("主キーが不足しているため編集できません。"); return; }
    const oldText = cellValue(row[column.name]);
    const before = row[column.name] == null ? null : oldText;
    const after = currentSelection.value === "" ? null : currentSelection.value;
    if (before === after) { setSelection(null); return; }
    const ok = await runMutation(signal => patchSpreadsheetCell(fetchFn, {
      table: def.table, primaryKey: pk, column: column.name, value: after,
    }, signal));
    if (!ok) return;
    const entry: Change = { table: def.table, page, pk, column: column.name, before, after };
    setHistory(state => {
      const prev = state.key === key ? state.undo : [];
      return { key, undo: [...prev, entry].slice(-HISTORY_LIMIT), redo: [] };
    });
    setSelection(null);
  }

  async function replay(direction: "undo" | "redo"): Promise<void> {
    const source = safeHistory[direction];
    const entry = source[source.length - 1];
    if (!entry || !canMutate || entry.table !== def.table || entry.page !== page) return;
    const value = direction === "undo" ? entry.before : entry.after;
    const ok = await runMutation(signal => patchSpreadsheetCell(fetchFn, {
      table: def.table, primaryKey: entry.pk, column: entry.column, value,
    }, signal));
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
    const text = copySpreadsheetSelection(rows, columns, anchorCell, focusedCell);
    if (!text) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      if (isCurrent()) setNotice("選択範囲をコピーしました。");
    } catch {
      if (isCurrent()) setNotice("クリップボードへのコピーが許可されていません。");
    }
  }

  function handleGridKey(
    event: React.KeyboardEvent<HTMLTableCellElement>,
    rowIndex: number,
    colIndex: number,
  ): void {
    // Inputs/buttons own their own shortcuts and text-selection semantics.
    if (event.target !== event.currentTarget) return;
    const shortcut = event.ctrlKey || event.metaKey;
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
    if (event.key === "Enter" && canMutate && !event.ctrlKey && !event.metaKey) {
      const column = columns[colIndex];
      const row = rows[rowIndex];
      if (column && row && column.editable && column.pk === 0 && !column.generated &&
          primaryKey(row, primaryKeys) !== null) {
        event.preventDefault();
        setSelection({ rowIndex, column: column.name, value: cellValue(row[column.name]), key });
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const moved = moveSpreadsheetFocus({ row: rowIndex, col: colIndex }, event.key, rows.length, columns.length);
    if (moved.row === rowIndex && moved.col === colIndex) return;
    event.preventDefault();
    if (!event.shiftKey) setAnchorCell(moved);
    setFocusedCell(moved);
    // The target cell already exists; focus before React's next render.
    const target = event.currentTarget.closest("table")
      ?.querySelector<HTMLTableCellElement>(`[data-grid-cell="${moved.row}:${moved.col}"]`);
    target?.focus();
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
      setSelection(null);
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
      setSelection(null);
      setHistory({ key, undo: [], redo: [] });
    }
  }

  return (
    <section aria-label="管理スプレッドシート編集">
      <p>{editable ? "編集可能な列のみ変更できます。主キー列は変更できません。" : "読み取り専用（編集は無効です）。"}</p>
      {notice ? <p role="status">{notice}</p> : null}
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
      <p>矢印キーで移動、Shift＋矢印で範囲選択、Ctrl/Cmd＋CでTSVコピー、Enterで編集できます。</p>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead><tr>{columns.map(c => <th key={c.name} scope="col">{c.name}</th>)}<th scope="col">操作</th></tr></thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>{columns.map(c => {
                const value = cellValue(row[c.name]);
                const canEdit = editable && c.editable && c.pk === 0 && !c.generated &&
                  primaryKey(row, primaryKeys) !== null;
                const editing = currentSelection?.rowIndex === ri && currentSelection?.column === c.name;
                return (
                  <td key={c.name} data-grid-cell={`${ri}:${columns.indexOf(c)}`}
                    tabIndex={focusedCell.row === ri && focusedCell.col === columns.indexOf(c) ? 0 : -1}
                    aria-selected={!identityChanged && ri >= Math.min(anchorCell.row, focusedCell.row) &&
                      ri <= Math.max(anchorCell.row, focusedCell.row) &&
                      columns.indexOf(c) >= Math.min(anchorCell.col, focusedCell.col) &&
                      columns.indexOf(c) <= Math.max(anchorCell.col, focusedCell.col)}
                    onClick={(event) => {
                      if (event.target !== event.currentTarget) return;
                      const pos = { row: ri, col: columns.indexOf(c) };
                      setAnchorCell(pos);
                      setFocusedCell(pos);
                    }}
                    onKeyDown={(event) => handleGridKey(event, ri, columns.indexOf(c))}>{editing ? (
                    <label>{c.name} を編集
                      <input type="text" disabled={!canMutate} value={currentSelection?.value ?? ""}
                        onChange={e => setSelection({ rowIndex: ri, column: c.name, value: e.target.value, key })} />
                      <button type="button" disabled={!canMutate} onClick={() => void saveCell()}>セルを保存</button>
                      <button type="button" disabled={busy} onClick={() => setSelection(null)}>キャンセル</button>
                    </label>
                  ) : (
                    <>{value}{canEdit ? (
                      <button type="button" disabled={!canMutate} aria-label={String(ri + 1) + "行 " + c.name + " を編集"}
                        onClick={() => setSelection({ rowIndex: ri, column: c.name, value, key })}>編集</button>
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
    </section>
  );
}
