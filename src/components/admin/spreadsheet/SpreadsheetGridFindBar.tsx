"use client";

import * as React from "react";
import styles from "./AdminSpreadsheetClient.module.css";

export function SpreadsheetGridFindBar({
  query,
  onQueryChange,
  onNext,
  onClose,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  onNext: () => void;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div className={styles.findBar}>
      <label className={styles.findLabel}>
        検索
        <input
          type="search"
          className={styles.findInput}
          value={query}
          autoFocus
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onNext();
            if (e.key === "Escape") onClose();
          }}
        />
      </label>
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        onClick={onNext}
      >
        次へ
      </button>
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        onClick={onClose}
      >
        閉じる
      </button>
    </div>
  );
}
