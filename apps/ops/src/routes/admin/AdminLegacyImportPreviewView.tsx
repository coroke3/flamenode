import * as React from "react";
import type { OpsFetch } from "../../api/read.js";
import {
  applyLegacyImportStep,
  previewLegacyImport,
  type LegacyPreviewCredential,
  type LegacyImportPreview,
  type LegacyImportStep,
} from "../../api/adminLegacyImport.js";

/** MIG-0737 U02: isolated legacy-import shell.
 * Not routed, apply OFF by default until MIG-0645, MIG-0726 and independent review.
 * CURRENT's 50k-line progressive/chunked apply and custom Q mapping are not yet ported.
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
  const [credential, setCredential] = React.useState<LegacyPreviewCredential | null>(null);
  const [preview, setPreview] = React.useState<LegacyImportPreview | null>(null);
  const [applyStatus, setApplyStatus] = React.useState<LegacyImportStep | null>(null);
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
  const validCredential = trusted && credential &&
    credential.expiresAt > Math.floor(Date.now() / 1000);
  const canApply = Boolean(allowApply && validCredential && !busy && files.length > 0 &&
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
    // React treats function values as updaters; wrap the fetch transport in a thunk.
    setSource(() => fetchFn);
    return () => {
      generation.current += 1;
      controller.current?.abort();
    };
  }, [fetchFn]);

  function chooseFiles(list: FileList | null): void {
    if (busy || active.current) return;
    reset();
    setFiles(list ? Array.from(list) : []);
  }

  async function runPreview(): Promise<void> {
    if (active.current || files.length === 0 || !trusted) return;
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
      const result = await previewLegacyImport(fetchFn, new FormData(), files,
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
      if (result.status !== "ok") {
        setMessage("反映結果を確認できません。自動再送は行いません。操作前にサーバー状態を確認してください。");
        return;
      }
      setApplyStatus(result.data);
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
      <p>現行のカスタム質問マッピング・行範囲指定・複数ステップ自動再開は移行準備中です。</p>
      <label>インポートファイル
        <input type="file" multiple accept=".json,.csv,.tsv,application/json,text/csv,text/tab-separated-values"
          disabled={busy} onChange={(event) => chooseFiles(event.currentTarget.files)} />
      </label>
      {files.length > 0 ? <ul>{files.map((file, i) => (
        <li key={i}>{file.name}（{file.size} bytes）</li>
      ))}</ul> : null}
      <button type="button" disabled={busy || !trusted || files.length === 0}
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
      {applyStatus?.progress ? (
        <p role="status">反映進捗: {applyStatus.progress.completed}/{applyStatus.progress.total}</p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      <button type="button" disabled={!canApply}
        onClick={() => void runApply()}>
        {applyStatus?.continuation_required ? "続きの1ステップを承認して実行" : "確認して1ステップ反映"}
      </button>
      {!allowApply ? <p>書き込み操作は移行ゲート未完了のため無効です。</p> : null}
    </section>
  );
}
