"use client";

import * as React from "react";
import type { SpreadsheetDelimiterMode } from "@/lib/admin/spreadsheet/paste";
import { SPREADSHEET_IMPORT_MAX_TEXT_CHARS } from "@/lib/admin/spreadsheet/constants";
import { buildSpreadsheetImportLocalPreview } from "@/lib/admin/spreadsheet/importPrepCore";
import {
  SPREADSHEET_IMPORT_MAX_FILE_BYTES,
  validateImportPayload,
} from "@/lib/admin/spreadsheet/validation";
import {
  previewSpreadsheetImport,
  runSpreadsheetImport,
  spreadsheetUserMessage,
} from "./spreadsheetApi";
import type { SpreadsheetImportPreview } from "./spreadsheetTypes";

export function useSpreadsheetImport({
  table,
  columnNames,
  onImported,
  setBarStatus,
}: {
  table: string;
  columnNames: string[];
  onImported: () => void | Promise<void>;
  setBarStatus?: (message: string | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [hasHeader, setHasHeader] = React.useState(true);
  const [delimiter, setDelimiter] =
    React.useState<SpreadsheetDelimiterMode>("auto");
  const [mode, setMode] = React.useState<"insert" | "upsert">("upsert");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<SpreadsheetImportPreview | null>(
    null,
  );
  const columnSignature = React.useMemo(
    () => columnNames.join("\u001f"),
    [columnNames],
  );

  React.useEffect(() => {
    setPreview(null);
    setError(null);
  }, [table, columnSignature]);

  const localPreview = React.useMemo(
    () =>
      buildSpreadsheetImportLocalPreview({
        text,
        columnNames,
        hasHeader,
        delimiter,
      }),
    [text, columnNames, hasHeader, delimiter],
  );

  const displayPreview = preview ?? localPreview;
  const canImport = Boolean(preview?.previewToken);

  const updateText = React.useCallback((next: string) => {
    setText(next);
    setPreview(null);
  }, []);

  const updateHasHeader = React.useCallback((next: boolean) => {
    setHasHeader(next);
    setPreview(null);
  }, []);

  const updateDelimiter = React.useCallback((next: SpreadsheetDelimiterMode) => {
    setDelimiter(next);
    setPreview(null);
  }, []);

  const updateMode = React.useCallback((next: "insert" | "upsert") => {
    setMode(next);
    setPreview(null);
  }, []);

  const reset = React.useCallback(() => {
    setText("");
    setPreview(null);
    setError(null);
    setHasHeader(true);
    setDelimiter("auto");
    setMode("upsert");
  }, []);

  const openModal = React.useCallback(() => {
    reset();
    setOpen(true);
  }, [reset]);

  const closeModal = React.useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  const onFile = React.useCallback((file: File | null) => {
    if (!file) return;
    if (file.size > SPREADSHEET_IMPORT_MAX_FILE_BYTES) {
      setError(
        `ファイルが大きすぎます（上限 ${(SPREADSHEET_IMPORT_MAX_FILE_BYTES / 1_000_000).toFixed(0)}MB）`,
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? "");
      if (content.length > SPREADSHEET_IMPORT_MAX_TEXT_CHARS) {
        setError(
          `ファイルの内容が長すぎます（上限 ${SPREADSHEET_IMPORT_MAX_TEXT_CHARS.toLocaleString()} 文字）`,
        );
        return;
      }
      setText(content);
      setPreview(null);
      setError(null);
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".tsv")) setDelimiter("tsv");
      else if (lower.endsWith(".csv")) setDelimiter("csv");
    };
    reader.onerror = () => {
      setError("ファイルの読み込みに失敗しました");
    };
    reader.readAsText(file, "UTF-8");
  }, []);

  const runDryRun = React.useCallback(async () => {
    if (!text.trim()) {
      setError("テキストを貼り付けるかファイルを選んでください");
      return;
    }
    const rowCount = localPreview?.rowCount ?? 0;
    const validationErr = validateImportPayload(text, rowCount);
    if (validationErr) {
      setError(validationErr);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const j = await previewSpreadsheetImport({
        table,
        text,
        hasHeader,
        delimiter,
        mode,
      });
      setPreview(j);
    } catch (e) {
      setError(spreadsheetUserMessage(e, "preview_failed"));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }, [delimiter, hasHeader, localPreview?.rowCount, mode, table, text]);

  const runImport = React.useCallback(async () => {
    if (!text.trim()) {
      setError("テキストを貼り付けるかファイルを選んでください");
      return;
    }
    const rowCount = localPreview?.rowCount ?? 0;
    const validationErr = validateImportPayload(text, rowCount);
    if (validationErr) {
      setError(validationErr);
      return;
    }
    if (!preview?.previewToken) {
      setError("反映前にサーバーで確認してください。");
      return;
    }
    if (
      !window.confirm(
        `${mode === "upsert" ? "UPSERT（PK一致で更新）" : "INSERT（新規のみ）"} で ${preview.rowCount} 行を反映します。続行しますか？`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const j = await runSpreadsheetImport({
        table,
        text,
        hasHeader,
        delimiter,
        mode,
        previewToken: preview.previewToken,
      });
      const errCount = j.errors?.length ?? 0;
      setOpen(false);
      reset();
      await onImported();
      const msg = `反映完了: 追加 ${j.inserted} / 更新 ${j.updated} / スキップ ${j.skipped}${errCount > 0 ? ` / エラー ${errCount}` : ""}`;
      setBarStatus?.(msg);
      return msg;
    } catch (e) {
      setError(spreadsheetUserMessage(e, "import_failed"));
      return null;
    } finally {
      setBusy(false);
    }
  }, [
    delimiter,
    hasHeader,
    localPreview?.rowCount,
    mode,
    onImported,
    preview,
    reset,
    setBarStatus,
    table,
    text,
  ]);

  return {
    open,
    openModal,
    closeModal,
    text,
    setText: updateText,
    hasHeader,
    setHasHeader: updateHasHeader,
    delimiter,
    setDelimiter: updateDelimiter,
    mode,
    setMode: updateMode,
    busy,
    error,
    displayPreview,
    canImport,
    onFile,
    runDryRun,
    runImport,
    clearPreview: () => setPreview(null),
  };
}
