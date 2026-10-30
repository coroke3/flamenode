import * as React from "react";
import type { OpsFetch } from "../../api/read.js";
import {
  MAX_IMPORT_APPLY_ROWS,
  MAX_IMPORT_TEXT_CHARS,
  applySpreadsheetImport,
  previewSpreadsheetImport,
  spreadsheetImportFingerprint,
  type SpreadsheetImportDraft,
  type SpreadsheetImportPreview,
} from "../../api/adminSpreadsheetImport.js";

type PreviewSnapshot = {
  draftFingerprint: string;
  data: SpreadsheetImportPreview;
};

/** Not routed until MIG-0638 RH-008 and admin shell gates pass. */
export function AdminSpreadsheetImportPreview({
  fetchFn = fetch,
  table,
  tableLabel,
  onImported,
  confirmApply = (message) => window.confirm(message),
}: {
  fetchFn?: OpsFetch;
  table: string;
  tableLabel: string;
  onImported?: () => void | Promise<void>;
  confirmApply?: (message: string) => boolean;
}): React.ReactElement {
  const [text, setText] = React.useState("");
  const [hasHeader, setHasHeader] = React.useState(true);
  const [delimiter, setDelimiter] = React.useState<SpreadsheetImportDraft["delimiter"]>("auto");
  const [mode, setMode] = React.useState<SpreadsheetImportDraft["mode"]>("upsert");
  const [preview, setPreview] = React.useState<PreviewSnapshot | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const requestId = React.useRef(0);
  const inFlight = React.useRef(false);

  const draft = React.useMemo<SpreadsheetImportDraft>(
    () => ({ table, text, hasHeader, delimiter, mode }),
    [table, text, hasHeader, delimiter, mode],
  );
  const fingerprint = spreadsheetImportFingerprint(draft);
  const canApply = Boolean(preview && preview.draftFingerprint === fingerprint &&
    preview.data.rowCount > 0 &&
    preview.data.rowCount <= MAX_IMPORT_APPLY_ROWS &&
    (preview.data.applyMaxRows == null || preview.data.rowCount <= preview.data.applyMaxRows));

  function resetPreview(): void {
    requestId.current += 1;
    setPreview(null);
    setMessage(null);
    setError(null);
  }
  React.useEffect(() => {
    resetPreview();
    // Table switch must invalidate any outstanding request token.
  }, [table, fetchFn]);

  async function dryRun(): Promise<void> {
    if (inFlight.current) return;
    if (!draft.text.trim() || draft.text.length > MAX_IMPORT_TEXT_CHARS) {
      setError("入力が空か、文字数の上限を超えています。");
      return;
    }
    inFlight.current = true;
    const id = ++requestId.current;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const result = await previewSpreadsheetImport(fetchFn, draft);
      if (id !== requestId.current) return;
      if (result.status !== "ok") {
        setError("サーバー確認に失敗しました。権限、機能設定、入力内容を確認してください。");
      } else {
        setPreview({ draftFingerprint: fingerprint, data: result.data });
        setMessage(result.data.rowCount > MAX_IMPORT_APPLY_ROWS
          ? `プレビューは有効です。反映は${MAX_IMPORT_APPLY_ROWS}行以下に分割してください。`
          : "サーバーで確認しました。反映する前に内容を確認してください。");
      }
    } finally {
      inFlight.current = false;
      if (id === requestId.current) setBusy(false);
    }
  }

  async function apply(): Promise<void> {
    if (!preview || !canApply || inFlight.current) return;
    const issued = preview;
    if (!confirmApply(`${mode === "upsert" ? "UPSERT" : "INSERT"} で ${issued.data.rowCount} 行を反映します。続行しますか？`)) {
      return;
    }
    if (issued.draftFingerprint !== spreadsheetImportFingerprint(draft)) return;
    inFlight.current = true;
    const id = ++requestId.current;
    setBusy(true);
    setError(null);
    // Single-use preview token. Never enable a second submit, even on error.
    setPreview(null);
    try {
      const result = await applySpreadsheetImport(fetchFn, draft, issued.data, issued.draftFingerprint);
      if (id !== requestId.current) return;
      if (result.status !== "ok") {
        setError("反映に失敗しました。再度サーバーで確認してください。");
        return;
      }
      setMessage(`反映完了: 追加 ${result.data.inserted} / 更新 ${result.data.updated} / スキップ ${result.data.skipped}`);
      setText("");
      await onImported?.();
    } finally {
      inFlight.current = false;
      if (id === requestId.current) setBusy(false);
    }
  }

  const previewRows = preview?.data.preview ?? [];
  const headers = Object.keys(previewRows[0] ?? {});

  return (
    <section aria-label="CSV / TSV インポート">
      <h2>CSV / TSV インポート — {tableLabel}</h2>
      <p>反映前に必ずサーバーで確認してください。確認後に入力を変更すると再確認が必要です。</p>
      <label>1行目はヘッダー
        <input type="checkbox" checked={hasHeader} disabled={busy}
          onChange={(e) => { resetPreview(); setHasHeader(e.target.checked); }} />
      </label>
      <label>区切り
        <select value={delimiter} disabled={busy}
          onChange={(e) => { resetPreview(); setDelimiter(e.target.value as SpreadsheetImportDraft["delimiter"]); }}>
          <option value="auto">自動</option>
          <option value="csv">CSV</option>
          <option value="tsv">TSV</option>
        </select>
      </label>
      <label>反映モード
        <select value={mode} disabled={busy}
          onChange={(e) => { resetPreview(); setMode(e.target.value as SpreadsheetImportDraft["mode"]); }}>
          <option value="upsert">UPSERT（PKで更新または追加）</option>
          <option value="insert">INSERTのみ</option>
        </select>
      </label>
      <label>インポート内容
        <textarea value={text} rows={8} disabled={busy} maxLength={MAX_IMPORT_TEXT_CHARS}
          onChange={(e) => { resetPreview(); setText(e.target.value); }} />
      </label>
      {preview ? (
        <div aria-label="サーバープレビュー">
          <p>{preview.data.rowCount} 行 / {preview.data.mappedColumns.join(", ")}</p>
          {preview.data.warnings.length > 0 ? (
            <ul>{preview.data.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>
          ) : null}
          <table>
            <thead><tr>{headers.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>{previewRows.map((row, i) => (
              <tr key={i}>{headers.map((h) => <td key={h}>{row[h] ?? "NULL"}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <button type="button" disabled={busy || !text.trim()} onClick={() => void dryRun()}>
        サーバーで確認
      </button>
      <button type="button" disabled={busy || !canApply} onClick={() => void apply()}>
        確認後に反映
      </button>
    </section>
  );
}
