"use client";

import * as React from "react";
import styles from "./LegacyCanonicalImportClient.module.css";

type ApiResponse = {
  ok: boolean;
  message?: string;
  mode?: "preview" | "apply";
  preview_token?: string;
  plan_hash?: string;
  expires_at?: number;
  requires_field_mapping?: boolean;
  continuation_required?: boolean;
  progress?: { stage: string; index: number; completed: number; total: number };
  video_custom_field_candidates?: VideoCustomFieldCandidate[];
  requires_repreview?: boolean;
  retryable?: boolean;
  summary?: Record<string, number>;
  warnings?: string[];
  errors?: string[];
  preview?: {
    events: Array<{ id: string; title: string; visibility_status: string }>;
    videos: Array<{ id: string; title: string; creator_display_name: string; visibility_status: string }>;
  };
  result?: unknown;
};

type VideoCustomFieldCandidate = {
  source_key: string;
  non_empty_rows: number;
};

type VideoCustomFieldDecision =
  | { source_key: string; action: "custom_question"; question_label: string }
  | { source_key: string; action: "ignore" };

type VideoCustomFieldDecisionDraft =
  | { action: "custom_question"; questionLabel: string }
  | { action: "ignore" };

type PreviewCredential = {
  token: string;
  planHash: string;
  expiresAt: number;
};

function selectedFileKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const APPLY_TRANSIENT_MAX_RETRIES = 6;

function applyTransientBackoffMs(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 10_000);
}

function isApplyTransientFailure(response: Response, json: ApiResponse): boolean {
  return (
    json.retryable === true ||
    response.status === 423 ||
    response.status === 502 ||
    response.status === 503 ||
    response.status === 504
  );
}

function httpUnavailableMessage(status: number): string {
  if (status === 423) {
    return "別の適用リクエストが処理中です。少し待ってから同じpreviewで再試行してください。";
  }
  if (status === 502 || status === 503 || status === 504) {
    return `サーバーが一時的に応答できませんでした (HTTP ${status})。R2/Workerの過負荷・メンテナンス・デプロイ中の可能性があります。少し待ってから同じpreviewで再試行してください。`;
  }
  return `通信結果を確認できませんでした (HTTP ${status || "不明"})。少し待ってから同じpreviewで再試行してください。`;
}

async function readApiResponse(response: Response): Promise<ApiResponse> {
  const text = await response.text();
  if (!text.trim()) {
    return {
      ok: false,
      message: httpUnavailableMessage(response.status),
      retryable: isApplyTransientFailure(response, { ok: false }),
    };
  }
  try {
    const parsed = JSON.parse(text) as ApiResponse;
    if (!parsed || typeof parsed !== "object") {
      return {
        ok: false,
        message: httpUnavailableMessage(response.status),
        retryable: isApplyTransientFailure(response, { ok: false }),
      };
    }
    return parsed;
  } catch {
    return {
      ok: false,
      message: httpUnavailableMessage(response.status),
      retryable: isApplyTransientFailure(response, { ok: false }),
    };
  }
}

export function LegacyCanonicalImportClient(): React.ReactElement {
  const formRef = React.useRef<HTMLFormElement>(null);
  const addFilesInputRef = React.useRef<HTMLInputElement>(null);
  const formRevisionRef = React.useRef(0);
  const [selectedFiles, setSelectedFiles] = React.useState<File[]>([]);
  const [result, setResult] = React.useState<ApiResponse | null>(null);
  const [pending, setPending] = React.useState<"preview" | "apply" | null>(null);
  const [credential, setCredential] = React.useState<PreviewCredential | null>(null);
  const [fieldCandidates, setFieldCandidates] = React.useState<VideoCustomFieldCandidate[]>([]);
  const [fieldDecisionDrafts, setFieldDecisionDrafts] = React.useState<Map<string, VideoCustomFieldDecisionDraft>>(
    () => new Map(),
  );

  const fieldDecisions = React.useMemo<VideoCustomFieldDecision[]>(() => {
    const decisions: VideoCustomFieldDecision[] = [];
    for (const candidate of fieldCandidates) {
      const draft = fieldDecisionDrafts.get(candidate.source_key);
      if (!draft) continue;
      if (draft.action === "ignore") {
        decisions.push({ source_key: candidate.source_key, action: "ignore" });
        continue;
      }
      const questionLabel = draft.questionLabel.trim();
      if (!questionLabel || questionLabel.length > 120) continue;
      decisions.push({ source_key: candidate.source_key, action: "custom_question", question_label: questionLabel });
    }
    return decisions;
  }, [fieldCandidates, fieldDecisionDrafts]);

  function invalidatePreview(): void {
    formRevisionRef.current += 1;
    setCredential(null);
  }

  function handleFormChange(): void {
    // 戦略・公開設定の変更でもカスタム質問の下書きは残す。
    // decisions は次のプレビューで再送し、古い credential だけ無効化する。
    invalidatePreview();
  }

  function syncFieldCandidatesFromResponse(json: ApiResponse): void {
    if (!Array.isArray(json.video_custom_field_candidates)) return;
    const candidates = json.video_custom_field_candidates;
    setFieldCandidates(candidates);
    if (candidates.length === 0) {
      setFieldDecisionDrafts(new Map());
      return;
    }
    setFieldDecisionDrafts((current) => {
      const next = new Map<string, VideoCustomFieldDecisionDraft>();
      for (const candidate of candidates) {
        const existing = current.get(candidate.source_key);
        if (existing) next.set(candidate.source_key, existing);
      }
      return next;
    });
  }

  function addSelectedFiles(fileList: FileList | null): void {
    if (!fileList || fileList.length === 0) return;
    const incoming = [...fileList];
    setSelectedFiles((current) => {
      const seen = new Set(current.map(selectedFileKey));
      const next = [...current];
      for (const file of incoming) {
        const key = selectedFileKey(file);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(file);
      }
      return next;
    });
    invalidatePreview();
    setFieldCandidates([]);
    setFieldDecisionDrafts(new Map());
    if (addFilesInputRef.current) addFilesInputRef.current.value = "";
  }

  function removeSelectedFile(key: string): void {
    setSelectedFiles((current) => current.filter((file) => selectedFileKey(file) !== key));
    invalidatePreview();
    setFieldCandidates([]);
    setFieldDecisionDrafts(new Map());
  }

  function setFieldAction(sourceKey: string, action: "custom_question" | "ignore"): void {
    setFieldDecisionDrafts((current) => {
      const next = new Map(current);
      const currentDraft = current.get(sourceKey);
      next.set(
        sourceKey,
        action === "custom_question"
          ? { action, questionLabel: currentDraft?.action === "custom_question" ? currentDraft.questionLabel : "" }
          : { action },
      );
      return next;
    });
    invalidatePreview();
  }

  function setQuestionLabel(sourceKey: string, questionLabel: string): void {
    setFieldDecisionDrafts((current) => {
      const next = new Map(current);
      next.set(sourceKey, { action: "custom_question", questionLabel });
      return next;
    });
    invalidatePreview();
  }

  function ignoreAllFieldCandidates(): void {
    setFieldDecisionDrafts((current) => {
      const next = new Map(current);
      for (const candidate of fieldCandidates) {
        next.set(candidate.source_key, { action: "ignore" });
      }
      return next;
    });
    invalidatePreview();
  }

  async function submit(mode: "preview" | "apply"): Promise<void> {
    const form = formRef.current;
    if (!form || pending) return;
    if (mode === "preview" && selectedFiles.length === 0) {
      setResult({ ok: false, message: "ファイルを1件以上追加してください。" });
      return;
    }
    if (mode === "preview") {
      for (const candidate of fieldCandidates) {
        const draft = fieldDecisionDrafts.get(candidate.source_key);
        if (draft?.action !== "custom_question") continue;
        const questionLabel = draft.questionLabel.trim();
        if (!questionLabel || questionLabel.length > 120) {
          setResult({
            ok: false,
            message: `列「${candidate.source_key}」の質問文Qを1〜120文字で入力するか、無視を選んでください。`,
          });
          return;
        }
      }
    }
    if (mode === "apply" && !credential) {
      setResult({ ok: false, message: "先にプレビューを実行してください。" });
      return;
    }
    if (mode === "apply" && credential && credential.expiresAt <= Math.floor(Date.now() / 1000)) {
      setCredential(null);
      setResult({ ok: false, message: "プレビューの有効期限が切れました。再度プレビューしてください。" });
      return;
    }
    if (mode === "apply" && !window.confirm("R2に保存したプレビュー済みplanを新正本へ書き込みます。続行しますか？")) {
      return;
    }

    setPending(mode);
    const submittedFormRevision = formRevisionRef.current;
    try {
      if (mode === "preview") {
        let previewJson: ApiResponse | null = null;
        for (let attempt = 0; attempt <= APPLY_TRANSIENT_MAX_RETRIES; attempt += 1) {
          const body = new FormData(form);
          body.set("mode", mode);
          body.set("video_custom_field_decisions", JSON.stringify(fieldDecisions));
          body.delete("files");
          for (const file of selectedFiles) body.append("files", file);
          const response = await fetch("/api/admin/import/legacy", { method: "POST", body });
          const json = await readApiResponse(response);
          previewJson = json;
          if (response.ok && json.ok) break;
          if (json.requires_repreview) break;
          if (!isApplyTransientFailure(response, json) || attempt >= APPLY_TRANSIENT_MAX_RETRIES) break;
          setResult({
            ...json,
            ok: false,
            message: `${json.message ?? "一時的なエラー"}（自動再試行中 ${attempt + 1}/${APPLY_TRANSIENT_MAX_RETRIES}）`,
          });
          await sleep(applyTransientBackoffMs(attempt + 1));
        }
        const json = previewJson ?? { ok: false, message: "プレビュー結果を取得できませんでした。" };
        setResult(json);
        const formUnchanged = formRevisionRef.current === submittedFormRevision;
        if (formUnchanged) {
          // 422（質問文重複など）でも candidates を同期し、マッピング UI をサーバ状態と揃える。
          syncFieldCandidatesFromResponse(json);
        }
        setCredential(
          formUnchanged &&
            json.ok &&
            json.preview_token &&
            json.plan_hash &&
            json.expires_at
            ? { token: json.preview_token, planHash: json.plan_hash, expiresAt: json.expires_at }
            : null,
        );
      } else if (credential) {
        let stopped = false;
        let transientFailures = 0;
        for (let step = 0; step < 10000; step += 1) {
          if (formRevisionRef.current !== submittedFormRevision) {
            setResult({ ok: false, message: "入力が変更されたため、プレビューをやり直してください。" });
            stopped = true;
            break;
          }
          try {
            const body = new FormData();
            body.set("mode", "apply");
            body.set("preview_token", credential.token);
            body.set("plan_hash", credential.planHash);
            const response = await fetch("/api/admin/import/legacy", { method: "POST", body });
            const json = await readApiResponse(response);
            if (json.expires_at) {
              setCredential((current) => current && current.token === credential.token
                ? { ...current, expiresAt: json.expires_at! }
                : current);
            }

            if (!response.ok || !json.ok) {
              if (json.requires_repreview) {
                setCredential(null);
                setResult(json);
                stopped = true;
                break;
              }
              if (isApplyTransientFailure(response, json) && transientFailures < APPLY_TRANSIENT_MAX_RETRIES) {
                transientFailures += 1;
                setResult({
                  ...json,
                  ok: false,
                  message: `${json.message ?? "一時的なエラー"}（自動再試行中 ${transientFailures}/${APPLY_TRANSIENT_MAX_RETRIES}）`,
                });
                await sleep(applyTransientBackoffMs(transientFailures));
                continue;
              }
              setResult(json);
              stopped = true;
              break;
            }

            transientFailures = 0;
            setResult(json);
            const resultComplete =
              typeof json.result === "object" &&
              json.result !== null &&
              "complete" in json.result &&
              (json.result as { complete?: unknown }).complete === true;
            if (json.continuation_required !== true || resultComplete) {
              setCredential(null);
              stopped = true;
              break;
            }
          } catch {
            if (transientFailures < APPLY_TRANSIENT_MAX_RETRIES) {
              transientFailures += 1;
              setResult({
                ok: false,
                message: `通信結果を確認できませんでした。（自動再試行中 ${transientFailures}/${APPLY_TRANSIENT_MAX_RETRIES}）`,
                retryable: true,
              });
              await sleep(applyTransientBackoffMs(transientFailures));
              continue;
            }
            setResult({
              ok: false,
              message: "通信結果を確認できませんでした。二重送信を避けるため、少し待ってから同じpreviewで再試行してください。",
              retryable: true,
            });
            stopped = true;
            break;
          }
        }
        if (!stopped) {
          setResult({ ok: false, message: "インポートの継続回数が上限に達しました。現在の状態から再試行してください。" });
        }
      }
    } catch {
      setResult({
        ok: false,
        message: "通信結果を確認できませんでした。二重送信を避けるため、少し待ってから同じpreviewで再試行してください。",
        retryable: true,
      });
    } finally {
      setPending(null);
    }
  }

  const expiresLabel = credential
    ? new Date(credential.expiresAt * 1000).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className={styles.root}>
      <form ref={formRef} onChange={handleFormChange} className={styles.form}>
        <div className={styles.section}>
          <strong>旧形式ファイル</strong>
          <div className={styles.fileRow}>
            <input
              ref={addFilesInputRef}
              type="file"
              accept=".json,.csv,.tsv,application/json,text/csv,text/tab-separated-values"
              multiple
              className={`fn-input ${styles.fileInput}`}
              onChange={(event) => addSelectedFiles(event.currentTarget.files)}
            />
          </div>
          <span className="fn-muted fn-text-sm">
            イベント用と動画用など、複数ファイルを順番に追加できます。JSON・CSV・TSV、最大20ファイル、合計12MB、5,000行まで。
          </span>
          {selectedFiles.length ? (
            <ul className={styles.fileList}>
              {selectedFiles.map((file) => {
                const key = selectedFileKey(file);
                return (
                  <li key={key} className={styles.fileListItem}>
                    <code>{file.name}</code>
                    <span className="fn-muted fn-text-sm">({Math.ceil(file.size / 1024).toLocaleString()} KB)</span>
                    <button type="button" className="fn-btn fn-btn-sm" onClick={() => removeSelectedFile(key)}>
                      削除
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={`fn-muted fn-text-sm ${styles.emptyFiles}`}>追加済みファイルはありません。</p>
          )}
        </div>

        <div className={styles.optionGrid}>
          <label className={styles.optionField}>
            <strong>イベント公開状態</strong>
            <select name="event_visibility" defaultValue="public" className="fn-input">
              <option value="public">公開</option>
              <option value="private">非公開</option>
            </select>
          </label>
          <label className={styles.optionField}>
            <strong>作品公開状態</strong>
            <select name="video_visibility" defaultValue="public" className="fn-input">
              <option value="public">公開</option>
              <option value="private">非公開</option>
            </select>
          </label>
          <label className={styles.optionField}>
            <strong>既存IDの扱い</strong>
            <select name="strategy" defaultValue="skip_existing" className="fn-input">
              <option value="skip_existing">既存IDをスキップ</option>
              <option value="create_only">既存IDがあれば停止</option>
              <option value="replace_imported">過去の旧形式インポート行だけ置換</option>
            </select>
          </label>
        </div>

        {fieldCandidates.length ? (
          <section
            aria-labelledby="legacy-video-custom-fields-title"
            data-legacy-field-mapping
            className={styles.mappingSection}
          >
            <div className={styles.mappingIntro}>
              <strong id="legacy-video-custom-fields-title">作品の追加列（任意）</strong>
              <span className="fn-muted fn-text-sm">
                未対応列は既定で無視してプレビューできます。カスタム質問へ保存したい列だけ指定して再プレビューしてください。
              </span>
              <button type="button" className="fn-btn fn-btn-sm" onClick={ignoreAllFieldCandidates}>
                表示中の列をすべて無視として再プレビュー
              </button>
            </div>
            {fieldCandidates.map((candidate, index) => {
              const draft = fieldDecisionDrafts.get(candidate.source_key);
              const fieldId = `legacy-video-custom-field-${index}`;
              const questionLabel = draft?.action === "custom_question" ? draft.questionLabel : "";
              return (
                <fieldset key={candidate.source_key} className={styles.mappingFieldset}>
                  <legend className={styles.mappingLegend}><code>{candidate.source_key}</code></legend>
                  <span id={`${fieldId}-description`} className="fn-muted fn-text-sm">
                    値が入っている作品: {candidate.non_empty_rows.toLocaleString()}件
                  </span>
                  <div className={styles.mappingRadios} aria-describedby={`${fieldId}-description`}>
                    <label className={styles.radioLabel}>
                      <input
                        type="radio"
                        name={`${fieldId}-action`}
                        value="custom_question"
                        checked={draft?.action === "custom_question"}
                        onChange={() => setFieldAction(candidate.source_key, "custom_question")}
                      />
                      カスタム質問にする
                    </label>
                    <label className={styles.radioLabel}>
                      <input
                        type="radio"
                        name={`${fieldId}-action`}
                        value="ignore"
                        checked={draft?.action === "ignore"}
                        onChange={() => setFieldAction(candidate.source_key, "ignore")}
                      />
                      無視する
                    </label>
                  </div>
                  {draft?.action === "custom_question" ? (
                    <label htmlFor={`${fieldId}-question-label`} className={styles.questionField}>
                      <strong>質問文Q</strong>
                      <input
                        id={`${fieldId}-question-label`}
                        type="text"
                        value={questionLabel}
                        maxLength={120}
                        aria-invalid={!questionLabel.trim()}
                        className="fn-input"
                        onChange={(event) => setQuestionLabel(candidate.source_key, event.currentTarget.value)}
                      />
                      <span className="fn-muted fn-text-sm">{questionLabel.length}/120文字</span>
                    </label>
                  ) : null}
                </fieldset>
              );
            })}
          </section>
        ) : null}

        <div className={styles.actions}>
          <button type="button" className="fn-btn fn-btn-primary" disabled={!!pending || selectedFiles.length === 0} onClick={() => void submit("preview")}>
            {pending === "preview" ? "解析・保存中…" : "プレビュー"}
          </button>
          <button type="button" className="fn-btn fn-btn-danger" disabled={!!pending || !credential} onClick={() => void submit("apply")}>
            {pending === "apply" ? "書き込み中…" : "新正本へ書き込む"}
          </button>
          <span className="fn-muted fn-text-sm">
            {credential
              ? `planはR2へ固定済みです。有効期限: ${expiresLabel}`
              : "ファイルまたは設定を変更すると再プレビューが必要です。"}
          </span>
        </div>
      </form>

      {result ? <ImportResult result={result} /> : null}
    </div>
  );
}

function ImportResult({ result }: { result: ApiResponse }): React.ReactElement {
  const heading = result.ok
    ? result.mode === "apply"
      ? result.continuation_required
        ? "インポート処理中"
        : "インポート完了"
      : "プレビュー結果"
    : "確認が必要です";
  return (
    <section
      aria-live="polite"
      className={`${styles.result} ${result.ok ? "" : styles.resultError}`}
    >
      <h2 className={styles.resultTitle}>{heading}</h2>
      {result.message ? <p>{result.message}</p> : null}
      {result.plan_hash ? <p className="fn-muted fn-text-sm">plan hash: <code>{result.plan_hash}</code></p> : null}
      {result.progress ? (
        <p className="fn-muted fn-text-sm">
          進捗: {result.progress.completed.toLocaleString()} / {result.progress.total.toLocaleString()}
          （{result.progress.stage}:{result.progress.index}）
        </p>
      ) : null}
      {result.ok && result.mode === "preview" && result.summary ? (
        <p className="fn-muted fn-text-sm">
          カスタム質問 {(result.summary.customQuestions ?? 0).toLocaleString()} 件、
          カスタム回答 {(result.summary.customAnswers ?? 0).toLocaleString()} 件をプレビュー plan に含めました。
          {(result.summary.customQuestions ?? 0) > 0 || (result.summary.customAnswers ?? 0) > 0
            ? " 列の割り当ては確定済みです。"
            : " 追加列をカスタム質問にする場合は列を指定して再プレビューしてください。"}
        </p>
      ) : null}
      {result.summary ? (
        <dl className={styles.summaryGrid}>
          {Object.entries(result.summary).map(([key, value]) => (
            <div key={key}><dt className="fn-muted fn-text-sm">{key}</dt><dd className={styles.summaryValue}>{value.toLocaleString()}</dd></div>
          ))}
        </dl>
      ) : null}
      {result.errors?.length ? <MessageList title="エラー" items={result.errors} /> : null}
      {result.warnings?.length ? <MessageList title="警告" items={result.warnings} /> : null}
      {result.preview?.events.length ? (
        <details><summary>イベント例</summary><ul>{result.preview.events.map((row) => <li key={row.id}><code>{row.id}</code> {row.title} ({row.visibility_status})</li>)}</ul></details>
      ) : null}
      {result.preview?.videos.length ? (
        <details><summary>作品例</summary><ul>{result.preview.videos.map((row) => <li key={row.id}><code>{row.id}</code> {row.title} / {row.creator_display_name} ({row.visibility_status})</li>)}</ul></details>
      ) : null}
      {result.result ? <pre className={styles.resultPre}>{JSON.stringify(result.result, null, 2)}</pre> : null}
    </section>
  );
}

function MessageList({ title, items }: { title: string; items: string[] }): React.ReactElement {
  return <details open><summary>{title} ({items.length})</summary><ul>{items.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></details>;
}
