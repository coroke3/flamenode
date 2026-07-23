"use client";

import * as React from "react";
import { MAX_LEGACY_IMPORT_SELECTED_ROWS } from "@/lib/import/legacy/cpuBudget";
import {
  findLegacyImportRangeIndex,
  legacyImportRangeChunkKey,
  nextLegacyImportRowRange,
  suggestLegacyImportRowRanges,
} from "@/lib/import/legacy/range";
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
  committed?: boolean;
  kind?: string;
  progress?: { stage: string; index: number; completed: number; total: number };
  video_custom_field_candidates?: VideoCustomFieldCandidate[];
  requires_repreview?: boolean;
  retryable?: boolean;
  summary?: Record<string, number>;
  file_ranges?: Array<{
    fileName: string;
    sourceRows: number;
    startRow: number;
    endRow: number;
    selectedRows: number;
  }>;
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

function isJsonFileName(name: string): boolean {
  return /\.json$/i.test(name);
}

function isDelimitedFileName(name: string): boolean {
  return /\.(csv|tsv)$/i.test(name);
}

function estimateJsonSourceRows(text: string): number {
  const parsed: unknown = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed.length;
  if (parsed && typeof parsed === "object") {
    let largest = 0;
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length > largest) largest = value.length;
    }
    return largest;
  }
  return 0;
}

function estimateDelimitedSourceRows(text: string): number {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  return Math.max(0, lines.length - 1);
}

async function estimateFileSourceRows(file: File): Promise<number | null> {
  try {
    const text = await file.text();
    if (isJsonFileName(file.name)) return estimateJsonSourceRows(text);
    if (isDelimitedFileName(file.name)) return estimateDelimitedSourceRows(text);
    try {
      return estimateJsonSourceRows(text);
    } catch {
      return estimateDelimitedSourceRows(text);
    }
  } catch {
    return null;
  }
}

type FileRangeInput = {
  start: string;
  end: string;
};

type ParsedFileRange = {
  startRow: number;
  endRow: number;
};

type ChunkCompleteBanner = {
  fileKey: string;
  fileName: string;
  nextRange: ParsedFileRange;
};

function parseControlledFileRange(
  input: FileRangeInput,
  sourceRows: number | null | undefined,
): ParsedFileRange | null {
  if (typeof sourceRows !== "number" || sourceRows < 1) return null;
  const startRaw = input.start.trim();
  const endRaw = input.end.trim();
  if (!startRaw && !endRaw) return null;
  const startRow = startRaw ? Number(startRaw) : 1;
  const endRow = endRaw ? Number(endRaw) : sourceRows;
  if (!Number.isSafeInteger(startRow) || !Number.isSafeInteger(endRow) || startRow < 1 || endRow < 1) {
    return null;
  }
  if (startRow > endRow || startRow > sourceRows || endRow > sourceRows) {
    return null;
  }
  return { startRow, endRow };
}

function findNextIncompleteLegacyImportRange(
  suggestedRanges: ReadonlyArray<ParsedFileRange>,
  completedChunkKeys: ReadonlySet<string>,
  currentRange: ParsedFileRange | null,
): ParsedFileRange | null {
  if (suggestedRanges.length === 0) return null;
  if (currentRange) {
    let candidate: ParsedFileRange | null = currentRange;
    for (let guard = 0; guard < suggestedRanges.length + 1; guard += 1) {
      const next = nextLegacyImportRowRange(suggestedRanges, candidate.startRow, candidate.endRow);
      if (!next) return null;
      if (!completedChunkKeys.has(legacyImportRangeChunkKey(next.startRow, next.endRow))) return next;
      candidate = next;
    }
    return null;
  }
  return (
    suggestedRanges.find(
      (range) => !completedChunkKeys.has(legacyImportRangeChunkKey(range.startRow, range.endRow)),
    ) ?? null
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const APPLY_TRANSIENT_MAX_RETRIES = 4;
/** 1ラン上限の既定。UIで 100/250/500 を選べる。 */
const APPLY_MAX_REQUESTS_PER_RUN_DEFAULT = 500;
const APPLY_MAX_REQUESTS_PER_RUN_OPTIONS = [100, 250, 500] as const;
/** 成功連続時のベース間隔。適応 pause が短縮する。 */
const APPLY_STEP_PAUSE_HEALTHY_MS = 40;
const LEGACY_IMPORT_CHUNK_SIZE_OPTIONS = [50, 100, 150, MAX_LEGACY_IMPORT_SELECTED_ROWS] as const;
const LEGACY_IMPORT_CREDENTIAL_STORAGE_KEY = "flamenode:legacy-import:credential:v4";

function applyTransientBackoffMs(attempt: number): number {
  return Math.min(750 * 2 ** (attempt - 1), 5_000);
}

/** 連続成功時は間隔を詰め、無料枠の日次 request を無駄に伸ばさない。 */
function applyStepPauseMs(successStreak: number): number {
  if (successStreak >= 8) return 0;
  if (successStreak >= 3) return 15;
  return APPLY_STEP_PAUSE_HEALTHY_MS;
}

function retryStoppedMessage(message: string): string {
  return `${message} 自動再試行は${APPLY_TRANSIENT_MAX_RETRIES}回で停止しました。previewは保持されているため、1分ほど待ってから「書き込む／再開」を押してください。`;
}

type StoredPreviewCredential = {
  token: string;
  planHash: string;
  expiresAt: number;
};

function loadStoredCredential(): PreviewCredential | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(LEGACY_IMPORT_CREDENTIAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPreviewCredential>;
    if (
      typeof parsed.token !== "string" ||
      typeof parsed.planHash !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return null;
    }
    if (parsed.expiresAt <= Math.floor(Date.now() / 1000)) {
      window.sessionStorage.removeItem(LEGACY_IMPORT_CREDENTIAL_STORAGE_KEY);
      return null;
    }
    return { token: parsed.token, planHash: parsed.planHash, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function persistCredential(credential: PreviewCredential | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!credential) {
      window.sessionStorage.removeItem(LEGACY_IMPORT_CREDENTIAL_STORAGE_KEY);
      return;
    }
    const stored: StoredPreviewCredential = {
      token: credential.token,
      planHash: credential.planHash,
      expiresAt: credential.expiresAt,
    };
    window.sessionStorage.setItem(LEGACY_IMPORT_CREDENTIAL_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // storageが無効でも、開いている画面内ではReact stateで継続できる。
  }
}

function isCommittedProgressPending(json: ApiResponse): boolean {
  return json.committed === true || json.kind === "committed_progress_pending";
}

function isApplyTransientFailure(response: Response, json: ApiResponse): boolean {
  return (
    isCommittedProgressPending(json) ||
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
  const submitInFlightRef = React.useRef(false);
  const [selectedFiles, setSelectedFiles] = React.useState<File[]>([]);
  const [fileSourceRows, setFileSourceRows] = React.useState<Map<string, number | null>>(() => new Map());
  const [fileRangeInputs, setFileRangeInputs] = React.useState<Map<string, FileRangeInput>>(() => new Map());
  const [completedChunkKeysByFile, setCompletedChunkKeysByFile] = React.useState<Map<string, Set<string>>>(
    () => new Map(),
  );
  const [chunkCompleteBanner, setChunkCompleteBanner] = React.useState<ChunkCompleteBanner | null>(null);
  const [chunkSize, setChunkSize] = React.useState<number>(MAX_LEGACY_IMPORT_SELECTED_ROWS);
  const [maxRequestsPerRun, setMaxRequestsPerRun] = React.useState<number>(
    APPLY_MAX_REQUESTS_PER_RUN_DEFAULT,
  );
  const [applyRunProgress, setApplyRunProgress] = React.useState<{
    requestCount: number;
    maxRequests: number;
  } | null>(null);
  const [lastPreviewFileRanges, setLastPreviewFileRanges] = React.useState<
    Array<{ fileName: string; startRow: number; endRow: number }>
  >([]);
  const [result, setResult] = React.useState<ApiResponse | null>(null);
  const [pending, setPending] = React.useState<"preview" | "apply" | null>(null);
  const [credential, setCredentialState] = React.useState<PreviewCredential | null>(null);
  const [credentialRestored, setCredentialRestored] = React.useState(false);
  const [fieldCandidates, setFieldCandidates] = React.useState<VideoCustomFieldCandidate[]>([]);
  const [fieldDecisionDrafts, setFieldDecisionDrafts] = React.useState<Map<string, VideoCustomFieldDecisionDraft>>(
    () => new Map(),
  );
  const setCredential = React.useCallback((value: PreviewCredential | null | ((current: PreviewCredential | null) => PreviewCredential | null)) => {
    setCredentialState((current) => {
      const next = typeof value === "function" ? value(current) : value;
      persistCredential(next);
      if (!next) setCredentialRestored(false);
      return next;
    });
  }, []);

  React.useEffect(() => {
    const restored = loadStoredCredential();
    if (restored) {
      setCredentialState(restored);
      setCredentialRestored(true);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const keys = selectedFiles.map(selectedFileKey);
    setFileSourceRows((current) => {
      const next = new Map<string, number | null>();
      for (const key of keys) {
        if (current.has(key)) next.set(key, current.get(key) as number | null);
      }
      return next;
    });
    setFileRangeInputs((current) => {
      const next = new Map<string, FileRangeInput>();
      for (const key of keys) next.set(key, current.get(key) ?? { start: "", end: "" });
      return next;
    });
    setCompletedChunkKeysByFile((current) => {
      const next = new Map<string, Set<string>>();
      for (const key of keys) {
        const existing = current.get(key);
        if (existing) next.set(key, existing);
      }
      return next;
    });
    setChunkCompleteBanner((current) => (current && keys.includes(current.fileKey) ? current : null));

    void (async () => {
      for (const file of selectedFiles) {
        const key = selectedFileKey(file);
        const rows = await estimateFileSourceRows(file);
        if (cancelled) return;
        setFileSourceRows((current) => {
          const next = new Map(current);
          next.set(key, rows);
          return next;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedFiles]);

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
    setChunkCompleteBanner(null);
    setLastPreviewFileRanges([]);
  }

  const markChunkApplyComplete = React.useCallback((json: ApiResponse): void => {
    const resultComplete =
      typeof json.result === "object" &&
      json.result !== null &&
      "complete" in json.result &&
      (json.result as { complete?: unknown }).complete === true;
    if (!json.ok || !resultComplete || json.continuation_required === true) return;

    const appliedRanges: Array<{ fileName: string; startRow: number; endRow: number }> = [];
    if (Array.isArray(json.file_ranges) && json.file_ranges.length > 0) {
      for (const range of json.file_ranges) {
        appliedRanges.push({
          fileName: range.fileName,
          startRow: range.startRow,
          endRow: range.endRow,
        });
      }
    } else if (lastPreviewFileRanges.length > 0) {
      for (const range of lastPreviewFileRanges) {
        appliedRanges.push({
          fileName: range.fileName,
          startRow: range.startRow,
          endRow: range.endRow,
        });
      }
    } else {
      for (const file of selectedFiles) {
        const key = selectedFileKey(file);
        const sourceRows = fileSourceRows.get(key);
        const rangeInput = fileRangeInputs.get(key);
        if (!rangeInput) continue;
        const parsed = parseControlledFileRange(rangeInput, sourceRows);
        if (!parsed) continue;
        appliedRanges.push({ fileName: file.name, startRow: parsed.startRow, endRow: parsed.endRow });
      }
    }

    // setState updater内の副作用に頼ると、非同期完了後のflushでバナーが常にnullになる。
    const nextCompleted = new Map(completedChunkKeysByFile);
    let nextBanner: ChunkCompleteBanner | null = null;
    for (const applied of appliedRanges) {
      const file = selectedFiles.find((candidate) => candidate.name === applied.fileName);
      if (!file) continue;
      const fileKey = selectedFileKey(file);
      const sourceRows = fileSourceRows.get(fileKey);
      if (typeof sourceRows !== "number" || sourceRows <= chunkSize) continue;
      const suggestedRanges = suggestLegacyImportRowRanges(sourceRows, chunkSize);
      if (suggestedRanges.length <= 1) continue;
      const chunkKey = legacyImportRangeChunkKey(applied.startRow, applied.endRow);
      const completed = new Set(nextCompleted.get(fileKey) ?? []);
      completed.add(chunkKey);
      nextCompleted.set(fileKey, completed);
      const nextRange = findNextIncompleteLegacyImportRange(suggestedRanges, completed, applied);
      if (nextRange) {
        nextBanner = { fileKey, fileName: file.name, nextRange };
      }
    }
    setCompletedChunkKeysByFile(nextCompleted);
    setChunkCompleteBanner(nextBanner);
  }, [
    chunkSize,
    completedChunkKeysByFile,
    fileRangeInputs,
    fileSourceRows,
    lastPreviewFileRanges,
    selectedFiles,
  ]);

  function setChunkSizeOption(nextSize: number): void {
    if (!LEGACY_IMPORT_CHUNK_SIZE_OPTIONS.includes(nextSize as (typeof LEGACY_IMPORT_CHUNK_SIZE_OPTIONS)[number])) {
      return;
    }
    setChunkSize(nextSize);
    setCompletedChunkKeysByFile(new Map());
    setChunkCompleteBanner(null);
    invalidatePreview();
  }

  function setFileRangeInput(key: string, field: "start" | "end", value: string): void {
    setFileRangeInputs((current) => {
      const next = new Map(current);
      const existing = current.get(key) ?? { start: "", end: "" };
      next.set(
        key,
        field === "start" ? { ...existing, start: value } : { ...existing, end: value },
      );
      return next;
    });
    invalidatePreview();
  }

  function applySuggestedRange(key: string, startRow: number, endRow: number): void {
    setFileRangeInputs((current) => {
      const next = new Map(current);
      next.set(key, { start: String(startRow), end: String(endRow) });
      return next;
    });
    setChunkCompleteBanner((current) => (current?.fileKey === key ? null : current));
    invalidatePreview();
  }

  function applyNextIncompleteChunk(
    key: string,
    suggestedRanges: ReadonlyArray<ParsedFileRange>,
    currentRange: ParsedFileRange | null,
  ): void {
    const completed = completedChunkKeysByFile.get(key) ?? new Set<string>();
    const nextRange = findNextIncompleteLegacyImportRange(suggestedRanges, completed, currentRange);
    if (!nextRange) return;
    applySuggestedRange(key, nextRange.startRow, nextRange.endRow);
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
    setCompletedChunkKeysByFile((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    setChunkCompleteBanner((current) => (current?.fileKey === key ? null : current));
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
    // Reactの再描画前にダブルクリックされても、同じpreviewのstepを並行送信しない。
    if (!form || pending || submitInFlightRef.current) return;
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

    submitInFlightRef.current = true;
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
          if (!isApplyTransientFailure(response, json)) break;
          if (attempt >= APPLY_TRANSIENT_MAX_RETRIES) {
            previewJson = {
              ...json,
              message: retryStoppedMessage(json.message ?? "一時的なエラーが続いています。"),
              retryable: true,
            };
            break;
          }
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
        if (formUnchanged && json.ok) {
          setLastPreviewFileRanges(
            Array.isArray(json.file_ranges)
              ? json.file_ranges.map((range) => ({
                  fileName: range.fileName,
                  startRow: range.startRow,
                  endRow: range.endRow,
                }))
              : [],
          );
        } else {
          setLastPreviewFileRanges([]);
        }
      } else if (credential) {
        let stopped = false;
        let transientFailures = 0;
        let successStreak = 0;
        let latestJson: ApiResponse | null = null;
        const runLimit = maxRequestsPerRun;
        setApplyRunProgress({ requestCount: 0, maxRequests: runLimit });
        // 一時エラーの再試行はラン上限に含めない（成功した原子ステップだけ数える）。
        let completedSteps = 0;
        while (completedSteps < runLimit) {
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
              successStreak = 0;
              if (isCommittedProgressPending(json)) {
                setResult({
                  ...json,
                  ok: false,
                  message: json.message ?? "このステップは保存済み。進捗復旧中",
                  retryable: true,
                });
                if (transientFailures < APPLY_TRANSIENT_MAX_RETRIES) {
                  transientFailures += 1;
                  await sleep(applyTransientBackoffMs(transientFailures));
                  continue;
                }
                setResult({
                  ...json,
                  ok: false,
                  message: retryStoppedMessage(json.message ?? "このステップは保存済み。進捗復旧中"),
                  retryable: true,
                });
                stopped = true;
                break;
              }
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
              if (isApplyTransientFailure(response, json)) {
                setResult({
                  ...json,
                  message: retryStoppedMessage(json.message ?? "一時的なエラーが続いています。"),
                  retryable: true,
                });
                stopped = true;
                break;
              }
              setResult(json);
              stopped = true;
              break;
            }

            transientFailures = 0;
            successStreak += 1;
            completedSteps += 1;
            latestJson = json;
            setApplyRunProgress({ requestCount: completedSteps, maxRequests: runLimit });
            setResult(json);
            const resultComplete =
              typeof json.result === "object" &&
              json.result !== null &&
              "complete" in json.result &&
              (json.result as { complete?: unknown }).complete === true;
            if (json.continuation_required !== true || resultComplete) {
              if (json.ok && resultComplete && json.continuation_required !== true) {
                markChunkApplyComplete(json);
              }
              setCredential(null);
              stopped = true;
              break;
            }
            await sleep(applyStepPauseMs(successStreak));
          } catch {
            successStreak = 0;
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
              message: retryStoppedMessage("通信結果を確認できませんでした。"),
              retryable: true,
            });
            stopped = true;
            break;
          }
        }
        if (!stopped) {
          setResult({
            ...(latestJson ?? {}),
            ok: true,
            mode: "apply",
            continuation_required: true,
            message: `${runLimit.toLocaleString()}ステップ処理したため、無料枠と連続負荷を守るため一時停止しました。「書き込む／再開」で続きから再開できます。`,
          });
        }
      }
    } catch {
      setResult({
        ok: false,
        message: "通信結果を確認できませんでした。二重送信を避けるため、少し待ってから同じpreviewで再試行してください。",
        retryable: true,
      });
    } finally {
      submitInFlightRef.current = false;
      setPending(null);
      setApplyRunProgress(null);
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
            イベント用と動画用など、分割した複数ファイルを順番に追加できます。JSON・CSV・TSV、最大20ファイル、1ファイル2MB・合計4MB、今回選択する範囲の合計{MAX_LEGACY_IMPORT_SELECTED_ROWS}行まで。
            同じ大きなファイルを複数回に分ける場合は、毎回重ならない開始・終了位置を指定してください。
            チャンクを小さくすると preview plan が軽くなり、Cloudflare 無料枠の CPU に有利です。
          </span>
          {selectedFiles.length ? (
            <>
              <label className={styles.optionField}>
                <strong>提案チャンクサイズ（行）</strong>
                <select
                  className="fn-input"
                  value={chunkSize}
                  aria-label="提案チャンクサイズ"
                  onChange={(event) => setChunkSizeOption(Number(event.currentTarget.value))}
                >
                  {LEGACY_IMPORT_CHUNK_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}行ごと
                      {size === MAX_LEGACY_IMPORT_SELECTED_ROWS ? "（上限）" : ""}
                    </option>
                  ))}
                </select>
                <span className="fn-muted fn-text-sm">
                  提案チップの刻みだけを変えます。開始・終了の手入力はそのまま使えます。サイズ変更時は完了バッジをリセットします。
                </span>
              </label>
            <ul className={styles.fileList}>
              {selectedFiles.map((file, index) => {
                const key = selectedFileKey(file);
                const sourceRows = fileSourceRows.get(key);
                const rangeInput = fileRangeInputs.get(key) ?? { start: "", end: "" };
                const suggestedRanges =
                  typeof sourceRows === "number" && sourceRows > chunkSize
                    ? suggestLegacyImportRowRanges(sourceRows, chunkSize)
                    : [];
                const multiChunkFile = suggestedRanges.length > 1;
                const completedChunkKeys = completedChunkKeysByFile.get(key) ?? new Set<string>();
                const currentRange = parseControlledFileRange(rangeInput, sourceRows);
                const currentRangeIndex =
                  currentRange !== null
                    ? findLegacyImportRangeIndex(
                        suggestedRanges,
                        currentRange.startRow,
                        currentRange.endRow,
                      )
                    : -1;
                const nextIncompleteChunk = multiChunkFile
                  ? findNextIncompleteLegacyImportRange(suggestedRanges, completedChunkKeys, currentRange)
                  : null;
                return (
                  <li key={key} className={styles.fileListItem}>
                    <code>{file.name}</code>
                    <span className="fn-muted fn-text-sm">({Math.ceil(file.size / 1024).toLocaleString()} KB)</span>
                    {typeof sourceRows === "number" ? (
                      <span className="fn-muted fn-text-sm">推定 {sourceRows.toLocaleString()} 行</span>
                    ) : fileSourceRows.has(key) && sourceRows === null ? (
                      <span className="fn-muted fn-text-sm">行数を推定できませんでした</span>
                    ) : (
                      <span className="fn-muted fn-text-sm">行数を推定中…</span>
                    )}
                    <div className={styles.fileRow}>
                      <label className={styles.optionField}>
                        <span className="fn-muted fn-text-sm">開始位置（1始まり）</span>
                        <input
                          type="number"
                          name={`range_start_${index}`}
                          min={1}
                          step={1}
                          inputMode="numeric"
                          placeholder="先頭"
                          className="fn-input"
                          aria-label={`${file.name}の開始位置`}
                          value={rangeInput.start}
                          onChange={(event) => setFileRangeInput(key, "start", event.currentTarget.value)}
                        />
                      </label>
                      <label className={styles.optionField}>
                        <span className="fn-muted fn-text-sm">終了位置（この行を含む）</span>
                        <input
                          type="number"
                          name={`range_end_${index}`}
                          min={1}
                          step={1}
                          inputMode="numeric"
                          placeholder="末尾"
                          className="fn-input"
                          aria-label={`${file.name}の終了位置`}
                          value={rangeInput.end}
                          onChange={(event) => setFileRangeInput(key, "end", event.currentTarget.value)}
                        />
                      </label>
                    </div>
                    {typeof sourceRows === "number" && sourceRows >= 1 ? (
                      <span className="fn-muted fn-text-sm">
                        {currentRange
                          ? (() => {
                              const selected =
                                currentRange.endRow - currentRange.startRow + 1;
                              const remainingAfter = Math.max(
                                0,
                                sourceRows - currentRange.endRow,
                              );
                              const overCap = selected > MAX_LEGACY_IMPORT_SELECTED_ROWS;
                              return (
                                <>
                                  選択 {selected.toLocaleString()} 行
                                  （全 {sourceRows.toLocaleString()} 行中・
                                  {currentRange.startRow.toLocaleString()}〜
                                  {currentRange.endRow.toLocaleString()}）。
                                  {remainingAfter > 0
                                    ? ` このあと残り ${remainingAfter.toLocaleString()} 行（次は ${
                                        currentRange.endRow + 1
                                      } 行目〜）。`
                                    : " 末尾まで選択済みです。"}
                                  {overCap
                                    ? ` 1回の上限 ${MAX_LEGACY_IMPORT_SELECTED_ROWS} 行を超えています。範囲を狭めてください。`
                                    : selected > chunkSize
                                      ? ` 提案チャンク ${chunkSize} 行より広いです（手入力は可。plan が重い場合は分割推奨）。`
                                      : null}
                                </>
                              );
                            })()
                          : rangeInput.start.trim() || rangeInput.end.trim()
                            ? `範囲が不正です（1〜${sourceRows.toLocaleString()}、開始≤終了）。空欄は先頭または末尾を意味します。`
                            : `範囲未指定時は全 ${sourceRows.toLocaleString()} 行が対象です。上限は ${MAX_LEGACY_IMPORT_SELECTED_ROWS} 行/回です。`}
                      </span>
                    ) : null}
                    {suggestedRanges.length > 0 ? (
                      <div className={styles.rangeSuggestions}>
                        <span className="fn-muted fn-text-sm">
                          {chunkSize} 行以下の範囲に分けてください。
                          {multiChunkFile
                            ? " skip_existing では各チャンクの apply 完了を確認してから次の範囲を preview してください（自動連鎖はしません）。"
                            : null}
                        </span>
                        <button
                          type="button"
                          className="fn-btn fn-btn-sm"
                          onClick={() =>
                            applySuggestedRange(
                              key,
                              1,
                              Math.min(chunkSize, sourceRows ?? chunkSize),
                            )
                          }
                        >
                          先頭{chunkSize}行を入力
                        </button>
                        {multiChunkFile ? (
                          <button
                            type="button"
                            className="fn-btn fn-btn-sm"
                            disabled={!nextIncompleteChunk}
                            onClick={() => applyNextIncompleteChunk(key, suggestedRanges, currentRange)}
                          >
                            次のチャンクを入力
                          </button>
                        ) : null}
                        <ul className={styles.suggestedRanges}>
                          {suggestedRanges.map((range, rangeIndex) => {
                            const chunkKey = legacyImportRangeChunkKey(range.startRow, range.endRow);
                            const isCompleted = completedChunkKeys.has(chunkKey);
                            const isCurrent = rangeIndex === currentRangeIndex;
                            return (
                              <li
                                key={chunkKey}
                                className={[
                                  styles.suggestedRangeItem,
                                  isCurrent ? styles.suggestedRangeItemCurrent : "",
                                  isCompleted ? styles.suggestedRangeItemCompleted : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                              >
                                <span>
                                  {range.startRow.toLocaleString()}〜{range.endRow.toLocaleString()}行
                                  {isCompleted ? (
                                    <span className={styles.chunkCompleteBadge}>完了</span>
                                  ) : null}
                                </span>
                                <button
                                  type="button"
                                  className="fn-btn fn-btn-sm"
                                  onClick={() => applySuggestedRange(key, range.startRow, range.endRow)}
                                >
                                  この範囲を入力
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}
                    <button type="button" className="fn-btn fn-btn-sm" onClick={() => removeSelectedFile(key)}>
                      削除
                    </button>
                  </li>
                );
              })}
            </ul>
            </>
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
          <label className={styles.optionField}>
            <strong>1ランの最大ステップ数</strong>
            <select
              className="fn-input"
              value={maxRequestsPerRun}
              aria-label="1ランの最大ステップ数"
              disabled={pending === "apply"}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (
                  APPLY_MAX_REQUESTS_PER_RUN_OPTIONS.includes(
                    next as (typeof APPLY_MAX_REQUESTS_PER_RUN_OPTIONS)[number],
                  )
                ) {
                  setMaxRequestsPerRun(next);
                }
              }}
            >
              {APPLY_MAX_REQUESTS_PER_RUN_OPTIONS.map((limit) => (
                <option key={limit} value={limit}>
                  {limit}ステップで一時停止
                  {limit === APPLY_MAX_REQUESTS_PER_RUN_DEFAULT ? "（既定）" : ""}
                </option>
              ))}
            </select>
            <span className="fn-muted fn-text-sm">
              1 HTTP = 原子ステップ1件のまま、ブラウザが連続POSTする上限です。日次 request と負荷を抑えるため小さくできます。
            </span>
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
            {pending === "apply" ? "書き込み中…" : "新正本へ書き込む／再開"}
          </button>
          <span className="fn-muted fn-text-sm">
            {credential
              ? `planはR2へ固定済みです。有効期限: ${expiresLabel}`
              : "ファイルまたは設定を変更すると再プレビューが必要です。"}
          </span>
          {credentialRestored && credential ? (
            <span className="fn-muted fn-text-sm">
              未完了のプレビューがあります。書き込むで再開できます。
            </span>
          ) : null}
          {applyRunProgress ? (
            <span className={styles.applyRunProgress} role="status">
              このラン: {applyRunProgress.requestCount.toLocaleString()} /{" "}
              {applyRunProgress.maxRequests.toLocaleString()} ステップ
              {result?.progress
                ? `（全体 ${result.progress.completed.toLocaleString()} / ${result.progress.total.toLocaleString()}・${result.progress.stage}）`
                : null}
            </span>
          ) : null}
        </div>
      </form>

      {chunkCompleteBanner ? (
        <div className={styles.chunkCompleteBanner} role="status">
          <p>
            チャンク完了。次は{" "}
            <strong>
              {chunkCompleteBanner.nextRange.startRow.toLocaleString()}〜
              {chunkCompleteBanner.nextRange.endRow.toLocaleString()} 行
            </strong>
            です（<code>{chunkCompleteBanner.fileName}</code>）。
          </p>
          <button
            type="button"
            className="fn-btn fn-btn-sm"
            onClick={() =>
              applySuggestedRange(
                chunkCompleteBanner.fileKey,
                chunkCompleteBanner.nextRange.startRow,
                chunkCompleteBanner.nextRange.endRow,
              )
            }
          >
            次の範囲を入力して再プレビュー
          </button>
        </div>
      ) : null}

      {result ? <ImportResult result={result} /> : null}
    </div>
  );
}

function ImportResult({ result }: { result: ApiResponse }): React.ReactElement {
  const committedPending = isCommittedProgressPending(result);
  const heading = result.ok
    ? result.mode === "apply"
      ? result.continuation_required
        ? "インポート処理中"
        : "インポート完了"
      : "プレビュー結果"
    : committedPending
      ? "ステップ保存済み（進捗復旧中）"
      : "確認が必要です";
  return (
    <section
      aria-live="polite"
      className={`${styles.result} ${result.ok || committedPending ? "" : styles.resultError}`}
    >
      <h2 className={styles.resultTitle}>{heading}</h2>
      {result.message ? <p>{result.message}</p> : null}
      {result.plan_hash ? <p className="fn-muted fn-text-sm">plan hash: <code>{result.plan_hash}</code></p> : null}
      {result.progress ? (
        <p className="fn-muted fn-text-sm">
          進捗: {result.progress.completed.toLocaleString()} / {result.progress.total.toLocaleString()}
          （stage={result.progress.stage}, index={result.progress.index}）
          {result.continuation_required ? " — 続きから再開できます" : null}
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
      {result.file_ranges?.length ? (
        <details open>
          <summary>今回の読み込み範囲 ({result.file_ranges.length}ファイル)</summary>
          <ul>
            {result.file_ranges.map((range, index) => (
              <li key={`${index}:${range.fileName}`}>
                <code>{range.fileName}</code>: {range.startRow.toLocaleString()}〜{range.endRow.toLocaleString()}行
                （全{range.sourceRows.toLocaleString()}行中 {range.selectedRows.toLocaleString()}行）
              </li>
            ))}
          </ul>
        </details>
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
