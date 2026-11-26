import * as React from "react";
import type { OpsFetch } from "../../api/read.js";
import {
  applyLegacyImportStep,
  previewLegacyImport,
  type LegacyPreviewCredential,
  type LegacyImportPreview,
  type LegacyImportApplyResponse,
} from "../../api/adminLegacyImport.js";

type FileRange = { start: string; end: string };

function validRange({ start, end }: FileRange): boolean {
  const valid = (raw: string) => !raw.trim() ||
    (/^[1-9]\d*$/.test(raw.trim()) && Number.isSafeInteger(Number(raw.trim())));
  return valid(start) && valid(end) && (!start.trim() || !end.trim() || Number(start) <= Number(end));
}

/** MIG-0737 U02: isolated legacy-import shell.
 * Not routed, apply OFF by default until MIG-0645, MIG-0726 and independent review.
 * CURRENT's chunk suggestions/progressive apply and custom Q mapping are not yet ported.
 */
export function AdminLegacyImportPreviewView({
  fetchFn = fetch,
  allowApply = false,
  confirmApply = (text) => window.confirm(text),
}: {
  fetchFn?: OpsFetch;
  allowApply?: boolean;
  confirmApply?: (text: string) => boolean;
}): React.ReactElement {
  const [files, setFiles] = React.useState<File[]>([]);
  const [ranges, setRanges] = React.useState<FileRange[]>([]);
  const [credential, setCredential] = React.useState<LegacyPreviewCredential | null>(null);
  const [preview, setPreview] = React.useState<LegacyImportPreview | null>(null);
  const [applyStatus, setApplyStatus] = React.useState<
    Extract<LegacyImportApplyResponse, { status: "ok" | "committedProgressPending" }> | null
  >(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const controller = React.useRef<AbortController | null>(null);
  const generation = React.useRef(0);
  const active = React.useRef(false);
  const activeFetch = React.useRef(fetchFn);
  activeFetch.current = fetchFn;
  const [source, setSource] = React.useState<OpsFetch>(() => fetchFn);

  // Do not render a preview or apply control from a prior transport / session,
  // including during the render before the effect clears the old state.
  const trusted = source === fetchFn;
  const currentPreview = trusted ? preview : null;
  const currentApplyStatus = trusted ? applyStatus : null;
  const recoveryPending = currentApplyStatus?.status === "committedProgressPending";
  const progress = currentApplyStatus?.status === "ok"
    ? currentApplyStatus.data.progress : currentApplyStatus?.progress;
  const continuationRequired = currentApplyStatus?.status === "ok" &&
    currentApplyStatus.data.continuation_required;
  const validCredential = trusted && credential &&
    credential.expiresAt > Math.floor(Date.now() / 1000);
  const invalidRange = ranges.some(range => !validRange(range));
  const canApply = Boolean(!invalidRange && allowApply && validCredential && !busy && !recoveryPending && files.length > 0 &&
    !currentPreview?.requires_field_mapping);

  function reset(): void {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    active.current = false;
    setBusy(false);
    setCredential(null);
    setPreview(null);
    setApplyStatus(null);
    setMessage(null);
  }

  React.useEffect(() => {
    reset();
    setFiles([]);
    setRanges([]);
    // React treats function values as updaters; wrap the fetch transport in a thunk.
    setSource(() => fetchFn);
    return () => {
      generation.current += 1;
      controller.current?.abort();
    };
  }, [fetchFn]);

  function chooseFiles(list: FileList | null): void {
    // A same-session file replacement must not discard confirmed committed progress.
    if (busy || active.current || !trusted || recoveryPending) return;
    reset();
    const selected = list ? Array.from(list) : [];
    setFiles(selected);
    setRanges(selected.map(() => ({ start: "", end: "" })));
  }

  function changeRange(index: number, field: keyof FileRange, value: string): void {
    if (busy || active.current || !trusted || recoveryPending) return;
    const hadPreview = currentPreview !== null;
    reset();
    setRanges(current => current.map((range, i) => i === index ? { ...range, [field]: value } : range));
    if (hadPreview) setMessage("入力が変更されたため、プレビューをやり直してください。");
  }

  async function runPreview(): Promise<void> {
    if (active.current || files.length === 0 || !trusted || recoveryPending || invalidRange) return;
    active.current = true;
    const id = ++generation.current;
    const signalController = new AbortController();
    controller.current = signalController;
    setBusy(true);
    setMessage(null);
    setCredential(null);
    setPreview(null);
    setApplyStatus(null);
    try {
      const fields = new FormData();
      // RH-002 associates inclusive, one-based bounds with the repeated files' order.
      ranges.forEach((range, index) => {
        fields.set(`range_start_${index}`, range.start);
        fields.set(`range_end_${index}`, range.end);
      });
      const result = await previewLegacyImport(fetchFn, fields, files,
        [], signalController.signal);
      if (id !== generation.current || signalController.signal.aborted ||
          activeFetch.current !== fetchFn) return;
      if (result.status !== "ok") {
        setMessage("プレビューに失敗しました。権限・サーバー状態を確認してください。");
        return;
      }
      setPreview(result.data);
      setCredential({
        token: result.data.preview_token,
        planHash: result.data.plan_hash,
        expiresAt: result.data.expires_at,
      });
      setMessage(result.data.requires_field_mapping
        ? "未対応の動画列があります。旧形式のマッピング画面が移植されるまで反映できません。"
        : "プレビューを確認してください。反映には明示的な承認が必要です。");
    } finally {
      if (controller.current === signalController) {
        controller.current = null;
        active.current = false;
        setBusy(false);
      }
    }
  }

  async function runApply(): Promise<void> {
    if (!canApply || active.current || !credential) return;
    if (!confirmApply("プレビュー済みの旧形式データをDB正本へ反映します。続行しますか？")) return;
    const issued = credential;
    if (issued.expiresAt <= Math.floor(Date.now() / 1000)) {
      setCredential(null);
      setMessage("プレビューの有効期限が切れました。");
      return;
    }
    active.current = true;
    const id = ++generation.current;
    const signalController = new AbortController();
    controller.current = signalController;
    setBusy(true);
    setMessage(null);
    // One apply HTTP step per explicit approval; never automatically repeat a
    // potentially committed step after an ambiguous network failure.
    setCredential(null);
    try {
      const result = await applyLegacyImportStep(fetchFn, issued,
        Math.floor(Date.now() / 1000), signalController.signal);
      if (id !== generation.current || signalController.signal.aborted ||
          activeFetch.current !== fetchFn) return;
      if (result.status === "committedProgressPending") {
        setApplyStatus(result);
        setMessage("このステップは保存済み。進捗復旧中。保存済みの処理は再送しません。サーバーの進捗復旧を確認してから続行してください。");
        return;
      }
      if (result.status !== "ok") {
        setMessage("反映結果を確認できません。自動再送は行いません。操作前にサーバー状態を確認してください。");
        return;
      }
      setApplyStatus(result);
      if (result.data.continuation_required) {
        setCredential({
          ...issued,
          expiresAt: result.data.expires_at ?? issued.expiresAt,
        });
        setMessage("1ステップが完了しました。続きは内容を確認して再度承認してください。");
      } else {
        setMessage("反映処理が終了しました。結果と公開反映を確認してください。");
      }
    } finally {
      if (controller.current === signalController) {
        controller.current = null;
        active.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <section aria-label="旧形式インポート">
      <h2>旧形式インポート</h2>
      <p>旧JSON・CSV・TSVを現行DB正本に変換します。プレビューが完了するまで反映できません。</p>
      <p>現行のカスタム質問マッピング・チャンク提案・複数ステップ自動再開は移行準備中です。</p>
      <label>インポートファイル
        <input type="file" multiple accept=".json,.csv,.tsv,application/json,text/csv,text/tab-separated-values"
          disabled={busy || !trusted || recoveryPending} onChange={(event) => chooseFiles(event.currentTarget.files)} />
      </label>
      {files.length > 0 ? <ul>{files.map((file, i) => (
        <li key={i}>
          {file.name}（{file.size} bytes）
          <label>開始位置（1始まり）
            <input type="number" name={`range_start_${i}`} min={1} step={1}
              inputMode="numeric" placeholder="先頭" aria-label={`${file.name}の開始位置`}
              value={ranges[i]?.start ?? ""} disabled={busy || !trusted || recoveryPending}
              onChange={event => changeRange(i, "start", event.currentTarget.value)} />
          </label>
          <label>終了位置（この行を含む）
            <input type="number" name={`range_end_${i}`} min={1} step={1}
              inputMode="numeric" placeholder="末尾" aria-label={`${file.name}の終了位置`}
              value={ranges[i]?.end ?? ""} disabled={busy || !trusted || recoveryPending}
              onChange={event => changeRange(i, "end", event.currentTarget.value)} />
          </label>
        </li>
      ))}</ul> : null}
      {invalidRange ? <p role="alert">範囲は1以上の整数で、終了位置は開始位置以上にしてください。空欄は先頭または末尾を意味します。</p> : null}
      <button type="button" disabled={busy || !trusted || recoveryPending || invalidRange || files.length === 0}
        onClick={() => void runPreview()}>サーバーでプレビュー</button>
      {currentPreview ? (
        <section aria-label="旧形式プレビュー結果">
          <p>プレビュー済み（期限: {new Date(currentPreview.expires_at * 1000).toLocaleString("ja-JP")}）</p>
          {currentPreview.warnings?.length ? <ul>{currentPreview.warnings.map((warning, i) =>
            <li key={i}>{warning}</li>)}</ul> : null}
          {currentPreview.file_ranges?.length ? <ul>{currentPreview.file_ranges.map((range, i) =>
            <li key={i}>{range.fileName}：{range.startRow}–{range.endRow}行</li>)}</ul> : null}
          {currentPreview.requires_field_mapping ? <p role="alert">列マッピングが必要です。反映できません。</p> : null}
        </section>
      ) : null}
      {recoveryPending ? <h3>ステップ保存済み（進捗復旧中）</h3> : null}
      {progress ? (
        <p role="status">反映進捗: {progress.completed}/{progress.total}</p>
      ) : null}
      {trusted && message ? <p role="status">{message}</p> : null}
      <button type="button" disabled={!canApply}
        onClick={() => void runApply()}>
        {continuationRequired ? "続きの1ステップを承認して実行" : "確認して1ステップ反映"}
      </button>
      {!allowApply ? <p>書き込み操作は移行ゲート未完了のため無効です。</p> : null}
    </section>
  );
}
