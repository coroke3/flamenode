"use client";

import * as React from "react";
import styles from "./AdminSpreadsheetClient.module.css";
import type { ColumnMeta, SelectionStats } from "./spreadsheetGridUtils";

export function SpreadsheetGridStatusBar({
  stats,
  focusCol,
}: {
  stats: SelectionStats;
  focusCol: ColumnMeta | undefined;
}): React.ReactElement {
  return (
    <div className={styles.statusBar}>
      <span>
        {stats.cells > 1
          ? `${stats.cells} セル · 入力 ${stats.filled}`
          : focusCol
            ? `${focusCol.type}${focusCol.notNull ? " · 必須" : ""}${focusCol.pk > 0 ? " · PK" : ""}`
            : ""}
      </span>
      {stats.numericSum != null ? (
        <span>合計 {stats.numericSum.toLocaleString()}</span>
      ) : null}
      {stats.preview ? (
        <span className={styles.statusBarPreview} title={stats.preview}>
          {stats.preview}
        </span>
      ) : null}
    </div>
  );
}
