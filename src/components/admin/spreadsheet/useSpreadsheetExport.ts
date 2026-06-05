"use client";

import * as React from "react";
import {
  exportSpreadsheetBlob,
  exportSpreadsheetText,
  spreadsheetUserMessage,
} from "./spreadsheetApi";
import { writeTextToClipboard } from "./spreadsheetGridUtils";

export function useSpreadsheetExport(
  table: string,
  setBarStatus?: (message: string | null) => void,
) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const showStatus = React.useCallback(
    (message: string) => {
      setBarStatus?.(message);
    },
    [setBarStatus],
  );

  const downloadExport = React.useCallback(
    async (format: "csv" | "tsv") => {
      setBusy(true);
      setError(null);
      try {
        const { blob, truncated } = await exportSpreadsheetBlob(table, format);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${table}${truncated ? "-partial" : ""}.${format}`;
        a.click();
        URL.revokeObjectURL(url);
        showStatus(
          truncated
            ? `${format.toUpperCase()} をダウンロードしました（件数上限で一部のみ）`
            : `${format.toUpperCase()} をダウンロードしました`,
        );
      } catch (e) {
        setError(spreadsheetUserMessage(e, "export_failed"));
      } finally {
        setBusy(false);
      }
    },
    [showStatus, table],
  );

  const copyExport = React.useCallback(
    async (format: "csv" | "tsv") => {
      setBusy(true);
      setError(null);
      try {
        const { text: body, truncated } = await exportSpreadsheetText(table, format);
        const copied = await writeTextToClipboard(body);
        if (!copied) {
          throw new Error("クリップボードへのコピーに失敗しました");
        }
        showStatus(
          truncated
            ? "クリップボードにコピーしました（件数上限で一部のみ）"
            : "クリップボードにコピーしました",
        );
      } catch (e) {
        setError(spreadsheetUserMessage(e, "copy_failed"));
      } finally {
        setBusy(false);
      }
    },
    [showStatus, table],
  );

  return { busy, error, downloadExport, copyExport };
}
