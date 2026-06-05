"use client";

import * as React from "react";
import styles from "./AdminSpreadsheetClient.module.css";
import { Icon } from "@/components/ui/Icon";

export function SpreadsheetUndoRedoButtons({
  canUndo,
  canRedo,
  undoCount,
  redoCount,
  busy,
  onUndo,
  onRedo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
  busy: boolean;
  onUndo: () => void;
  onRedo: () => void;
}): React.ReactElement {
  return (
    <div className={styles.historyBtns} role="group" aria-label="元に戻す / やり直す">
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        disabled={!canUndo || busy}
        title="元に戻す (Ctrl+Z)"
        onClick={onUndo}
      >
        <Icon name="prev" size={12} aria-hidden />
        戻る
        {undoCount > 0 ? (
          <span className={styles.historyCount}>{undoCount}</span>
        ) : null}
      </button>
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        disabled={!canRedo || busy}
        title="やり直す (Ctrl+Shift+Z / Ctrl+Y)"
        onClick={onRedo}
      >
        <Icon name="next" size={12} aria-hidden />
        進む
        {redoCount > 0 ? (
          <span className={styles.historyCount}>{redoCount}</span>
        ) : null}
      </button>
    </div>
  );
}
