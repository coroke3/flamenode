"use client";

import * as React from "react";
import styles from "./AdminSpreadsheetClient.module.css";
import { Icon } from "@/components/ui/Icon";
import { SpreadsheetImportModal } from "./SpreadsheetImportModal";
import { useSpreadsheetExport } from "./useSpreadsheetExport";
import { useSpreadsheetImport } from "./useSpreadsheetImport";

export function SpreadsheetDelimitedTools({
  table,
  tableLabel,
  columns,
  editable,
  onImported,
}: {
  table: string;
  tableLabel: string;
  columns: Array<{ name: string }>;
  editable: boolean;
  onImported: () => void | Promise<void>;
}): React.ReactElement {
  const [barStatus, setBarStatus] = React.useState<string | null>(null);

  const columnNames = React.useMemo(
    () => columns.map((c) => c.name),
    [columns],
  );

  const exp = useSpreadsheetExport(table, setBarStatus);
  const imp = useSpreadsheetImport({
    table,
    columnNames,
    onImported,
    setBarStatus,
  });

  const busy = exp.busy || imp.busy;
  const barError = exp.error ?? (imp.open ? null : imp.error);

  return (
    <>
      <div className={styles.delimitedBar} role="toolbar" aria-label="CSV / TSV">
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          disabled={busy || !table}
          onClick={() => void exp.downloadExport("csv")}
          title="全行を CSV でダウンロード（上限あり）"
        >
          <Icon name="download" size={12} aria-hidden /> CSV
        </button>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          disabled={busy || !table}
          onClick={() => void exp.downloadExport("tsv")}
          title="全行を TSV でダウンロード（上限あり）"
        >
          <Icon name="download" size={12} aria-hidden /> TSV
        </button>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          disabled={busy || !table}
          onClick={() => void exp.copyExport("csv")}
        >
          コピー (CSV)
        </button>
        {editable ? (
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            disabled={busy || !table}
            onClick={() => imp.openModal()}
          >
            <Icon name="upload" size={12} aria-hidden /> インポート…
          </button>
        ) : null}
        {barStatus ? (
          <span className={styles.delimitedStatus}>{barStatus}</span>
        ) : null}
        {barError ? <span className={styles.statusErr}>{barError}</span> : null}
      </div>

      <SpreadsheetImportModal
        tableLabel={tableLabel}
        open={imp.open}
        busy={imp.busy}
        error={imp.error}
        text={imp.text}
        hasHeader={imp.hasHeader}
        delimiter={imp.delimiter}
        mode={imp.mode}
        displayPreview={imp.displayPreview}
        onClose={imp.closeModal}
        onTextChange={(t) => {
          imp.setText(t);
          imp.clearPreview();
        }}
        onHasHeaderChange={imp.setHasHeader}
        onDelimiterChange={imp.setDelimiter}
        onModeChange={imp.setMode}
        onFile={imp.onFile}
        onDryRun={() => void imp.runDryRun()}
        onImport={() => void imp.runImport()}
      />
    </>
  );
}
