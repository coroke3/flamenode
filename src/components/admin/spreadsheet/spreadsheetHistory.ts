/** スプレッドシートの Undo / Redo 履歴（最大件数） */
export const SPREADSHEET_HISTORY_MAX = 100;

export type SpreadsheetCellChange = {
  rowIndex: number;
  primaryKey: Record<string, string>;
  column: string;
  before: string | null;
  after: string | null;
};

export type SpreadsheetHistoryEntry = {
  id: string;
  label: string;
  table: string;
  page: number;
  changes: SpreadsheetCellChange[];
};

export type SpreadsheetHistoryStacks = {
  undo: SpreadsheetHistoryEntry[];
  redo: SpreadsheetHistoryEntry[];
};

export function createEmptyHistoryStacks(): SpreadsheetHistoryStacks {
  return { undo: [], redo: [] };
}

let historyIdSeq = 0;

export function createHistoryEntry(
  partial: Omit<SpreadsheetHistoryEntry, "id">,
): SpreadsheetHistoryEntry {
  historyIdSeq += 1;
  return { ...partial, id: `h${historyIdSeq}` };
}

export function pushUndoEntry(
  stacks: SpreadsheetHistoryStacks,
  entry: SpreadsheetHistoryEntry,
  max = SPREADSHEET_HISTORY_MAX,
): SpreadsheetHistoryStacks {
  const undo = [...stacks.undo, entry];
  if (undo.length > max) undo.shift();
  return { undo, redo: [] };
}

export function popUndo(
  stacks: SpreadsheetHistoryStacks,
): {
  stacks: SpreadsheetHistoryStacks;
  entry: SpreadsheetHistoryEntry | null;
} {
  if (stacks.undo.length === 0) {
    return { stacks, entry: null };
  }
  const entry = stacks.undo[stacks.undo.length - 1]!;
  return {
    stacks: {
      undo: stacks.undo.slice(0, -1),
      redo: [...stacks.redo, entry],
    },
    entry,
  };
}

export function popRedo(
  stacks: SpreadsheetHistoryStacks,
): {
  stacks: SpreadsheetHistoryStacks;
  entry: SpreadsheetHistoryEntry | null;
} {
  if (stacks.redo.length === 0) {
    return { stacks, entry: null };
  }
  const entry = stacks.redo[stacks.redo.length - 1]!;
  return {
    stacks: {
      undo: [...stacks.undo, entry],
      redo: stacks.redo.slice(0, -1),
    },
    entry,
  };
}

export function valuesEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = a == null || a === "" ? null : a;
  const nb = b == null || b === "" ? null : b;
  return na === nb;
}
