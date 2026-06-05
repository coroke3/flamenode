"use client";

import * as React from "react";
import styles from "./AdminSpreadsheetClient.module.css";
import {
  canEditCell,
  cellLabel,
  type CellPos,
  type ColumnMeta,
} from "./spreadsheetGridUtils";

type EditState = {
  rowIndex: number;
  colIndex: number;
  value: string;
  original: string;
};

export function SpreadsheetGridFormulaBar({
  formulaRef,
  page,
  limit,
  editable,
  focus,
  focusCol,
  focusValue,
  editing,
  formulaReadOnly,
  statusText,
  onStartEdit,
  onEditChange,
  onFormulaKeyDown,
  onEditPaste,
  onCommitBlur,
}: {
  formulaRef: React.RefObject<HTMLInputElement | null>;
  page: number;
  limit: number;
  editable: boolean;
  focus: CellPos;
  focusCol: ColumnMeta | undefined;
  focusValue: string;
  editing: EditState | null;
  formulaReadOnly: boolean;
  statusText: string;
  onStartEdit: (value: string) => void;
  onEditChange: (value: string) => void;
  onFormulaKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onEditPaste: (e: React.ClipboardEvent) => void;
  onCommitBlur: () => void;
}): React.ReactElement {
  const formulaValue = editing ? editing.value : focusValue;

  return (
    <div className={styles.formulaBar}>
      <div className={styles.formulaRef} aria-live="polite" title="セル参照">
        {focusCol
          ? cellLabel(focus.rowIndex, focusCol, focus.colIndex, page, limit)
          : "—"}
      </div>
      <span className={styles.formulaFx}>fx</span>
      <input
        ref={formulaRef}
        type="text"
        className={styles.formulaInput}
        value={formulaValue}
        readOnly={formulaReadOnly && !editing}
        placeholder={formulaReadOnly ? "読み取り専用" : ""}
        aria-label="セルの値"
        onChange={(e) => {
          if (!editing && focusCol && canEditCell(editable, focusCol)) {
            onStartEdit(e.target.value);
          } else if (editing) {
            onEditChange(e.target.value);
          }
        }}
        onFocus={() => {
          if (!editing && focusCol && canEditCell(editable, focusCol)) {
            onStartEdit(focusValue);
          }
        }}
        onKeyDown={onFormulaKeyDown}
        onPaste={onEditPaste}
        onBlur={onCommitBlur}
      />
      <span className={styles.formulaStatus}>{statusText}</span>
    </div>
  );
}
