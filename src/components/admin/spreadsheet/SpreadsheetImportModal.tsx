"use client";

import * as React from "react";
import styles from "./AdminSpreadsheetClient.module.css";
import type { SpreadsheetDelimiterMode } from "@/lib/admin/spreadsheet/paste";
import type { SpreadsheetImportPreview } from "./spreadsheetTypes";

export function SpreadsheetImportModal({
  tableLabel,
  open,
  busy,
  error,
  text,
  hasHeader,
  delimiter,
  mode,
  displayPreview,
  onClose,
  onTextChange,
  onHasHeaderChange,
  onDelimiterChange,
  onModeChange,
  onFile,
  onDryRun,
  onImport,
}: {
  tableLabel: string;
  open: boolean;
  busy: boolean;
  error: string | null;
  text: string;
  hasHeader: boolean;
  delimiter: SpreadsheetDelimiterMode;
  mode: "insert" | "upsert";
  displayPreview: SpreadsheetImportPreview | null;
  onClose: () => void;
  onTextChange: (text: string) => void;
  onHasHeaderChange: (v: boolean) => void;
  onDelimiterChange: (v: SpreadsheetDelimiterMode) => void;
  onModeChange: (v: "insert" | "upsert") => void;
  onFile: (file: File | null) => void;
  onDryRun: () => void;
  onImport: () => void;
}): React.ReactElement | null {
  const fileRef = React.useRef<HTMLInputElement>(null);

  if (!open) return null;

  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="spreadsheet-import-title"
    >
      <div className={`${styles.modal} ${styles.importModal}`}>
        <h2 id="spreadsheet-import-title" className={styles.modalTitle}>
          CSV / TSV インポート — {tableLabel}
        </h2>
        <p className={styles.importHint}>
          Excel やスプレッドシートからコピーした表をそのまま貼り付けできます。1
          行目をヘッダーにする場合は列名がテーブルと一致している必要があります。
        </p>

        <div className={styles.importOptions}>
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => onHasHeaderChange(e.target.checked)}
            />
            1 行目はヘッダー
          </label>
          <label className={styles.fieldInline}>
            <span>区切り</span>
            <select
              value={delimiter}
              onChange={(e) =>
                onDelimiterChange(e.target.value as SpreadsheetDelimiterMode)
              }
            >
              <option value="auto">自動</option>
              <option value="csv">カンマ (CSV)</option>
              <option value="tsv">タブ (TSV)</option>
            </select>
          </label>
          <label className={styles.fieldInline}>
            <span>反映</span>
            <select
              value={mode}
              onChange={(e) =>
                onModeChange(e.target.value as "insert" | "upsert")
              }
            >
              <option value="upsert">UPSERT（PK で更新 or 追加）</option>
              <option value="insert">INSERT のみ</option>
            </select>
          </label>
        </div>

        <textarea
          className={styles.importTextarea}
          placeholder={"ここに貼り付け…\nまたは下のファイル選択"}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          rows={8}
          spellCheck={false}
        />

        <div className={styles.importFileRow}>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            className={styles.hiddenFile}
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={() => fileRef.current?.click()}
          >
            ファイルを選ぶ…
          </button>
          <span className={styles.importMeta}>
            {displayPreview
              ? `${displayPreview.rowCount} 行 · 列: ${displayPreview.mappedColumns.length > 0 ? displayPreview.mappedColumns.join(", ") : "（位置マッチ）"}`
              : "プレビュー待ち"}
          </span>
        </div>

        {displayPreview && displayPreview.warnings.length > 0 ? (
          <ul className={styles.importWarnings}>
            {displayPreview.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}

        {displayPreview && displayPreview.preview.length > 0 ? (
          <div className={styles.previewWrap}>
            <table className={styles.previewTable}>
              <thead>
                <tr>
                  {Object.keys(displayPreview.preview[0] ?? {}).map((k) => (
                    <th key={k} scope="col">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayPreview.preview.map((row, i) => (
                  <tr key={i}>
                    {Object.keys(displayPreview.preview[0] ?? {}).map((k) => (
                      <td key={k}>
                        {row[k] == null || row[k] === ""
                          ? "NULL"
                          : String(row[k])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {error ? <p className={styles.statusErr}>{error}</p> : null}

        <div className={styles.modalActions}>
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            disabled={busy || !text.trim()}
            onClick={onDryRun}
          >
            サーバーで確認
          </button>
          <button
            type="button"
            className="fn-btn fn-btn-primary fn-btn-sm"
            disabled={busy || !text.trim()}
            onClick={onImport}
          >
            {busy ? "処理中…" : "反映する"}
          </button>
        </div>
      </div>
    </div>
  );
}
