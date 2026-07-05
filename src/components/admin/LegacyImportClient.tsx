"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import styles from "./LegacyImportClient.module.css";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { mojibakeHitCount } from "@/lib/utils/mojibake";

interface PreviewRow {
  kind: "event" | "video";
  id: string;
  title: string;
  action: "create" | "replace" | "skip";
  conflict: boolean;
  visibility_status?: "draft" | "private" | "public" | "archived";
  softwareCount: number;
  memberCount: number;
  warnings: string[];
}

type ImportMode = "archive" | "preserve" | "active_event" | "draft";
type ImportStrategy = "create_only" | "replace_imported" | "skip_existing";

interface ImportCounts {
  events: { create: number; replace: number; skip: number; failed: number };
  videos: { create: number; replace: number; skip: number; failed: number };
  xUsers: { create: number };
  members: number;
  staff: number;
}

interface ImportResult {
  ok: boolean;
  message: string;
  counts: ImportCounts;
  preview: PreviewRow[];
  previewTotal: number;
  errors: string[];
  previewToken?: string;
}

interface PendingFile {
  name: string;
  size: number;
  content: string;
  encoding: string;
}

const PREVIEW_LIMIT = 100;
const DECODER_CANDIDATES = ["utf-8", "shift_jis", "windows-31j"];

async function readTextSmart(file: File): Promise<{ content: string; encoding: string }> {
  const buffer = await file.arrayBuffer();
  const decoded = DECODER_CANDIDATES.map((encoding) => {
    const content = new TextDecoder(encoding, { fatal: false }).decode(buffer);
    const score =
      (content.match(/\uFFFD/g)?.length ?? 0) * 20 + mojibakeHitCount(content);
    const parses = (() => {
      try {
        JSON.parse(content);
        return true;
      } catch {
        return false;
      }
    })();
    return { content, encoding, score: score - (parses ? 1000 : 0) };
  });
  decoded.sort((a, b) => a.score - b.score);
  const best = decoded[0] ?? { content: "", encoding: "utf-8" };
  return { content: best.content, encoding: best.encoding };
}

async function parseImportResponse(res: Response): Promise<ImportResult> {
  const raw = await res.text();
  if (!raw.trim()) {
    return {
      ok: false,
      message: `サーバーから空の応答が返りました (HTTP ${res.status})`,
      counts: emptyCounts(),
      preview: [],
      previewTotal: 0,
      errors: [`HTTP ${res.status}`],
    };
  }
  try {
    const data = JSON.parse(raw) as Partial<ImportResult> & { error?: string };
    if (typeof data.message !== "string" && typeof data.error !== "string") {
      return {
        ok: false,
        message: `想定外の応答です (HTTP ${res.status})`,
        counts: emptyCounts(),
        preview: [],
        previewTotal: 0,
        errors: [raw.slice(0, 500)],
      };
    }
    return {
      ok: data.ok === true,
      message: data.message ?? data.error ?? `HTTP ${res.status}`,
      counts: (data.counts as ImportCounts) ?? emptyCounts(),
      preview: Array.isArray(data.preview) ? (data.preview as PreviewRow[]) : [],
      previewTotal:
        typeof data.previewTotal === "number"
          ? data.previewTotal
          : Array.isArray(data.preview)
            ? data.preview.length
            : 0,
      errors: Array.isArray(data.errors) ? (data.errors as string[]) : [],
      previewToken:
        typeof data.previewToken === "string" ? data.previewToken : undefined,
    };
  } catch {
    return {
      ok: false,
      message: `JSON として解析できない応答です (HTTP ${res.status})`,
      counts: emptyCounts(),
      preview: [],
      previewTotal: 0,
      errors: [raw.slice(0, 500)],
    };
  }
}

export function LegacyImportClient(): React.ReactElement {
  const router = useRouter();
  const [files, setFiles] = React.useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const [strategy, setStrategy] = React.useState<ImportStrategy>("skip_existing");
  const [importMode, setImportMode] = React.useState<ImportMode>("archive");
  const [enqueueStaticRebuild, setEnqueueStaticRebuild] = React.useState(true);
  const [analysis, setAnalysis] = React.useState<ImportResult | null>(null);
  const [analysisKey, setAnalysisKey] = React.useState<string | null>(null);
  const [applyResult, setApplyResult] = React.useState<ImportResult | null>(null);
  const [pending, setPending] = React.useState<"analyze" | "apply" | null>(null);
  const [confirmApply, setConfirmApply] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const currentKey = React.useMemo(
    () =>
      JSON.stringify({
        files: files.map((f) => ({ name: f.name, size: f.size })),
        strategy,
        importMode,
        enqueueStaticRebuild,
      }),
    [files, strategy, importMode, enqueueStaticRebuild],
  );

  const addFiles = React.useCallback(async (list: FileList | File[]) => {
    const arr = Array.from(list).filter(
      (f) =>
        /\.(json|csv|tsv)$/i.test(f.name) ||
        f.type.includes("json") ||
        f.type.includes("csv") ||
        f.type.includes("tab-separated-values"),
    );
    const next: PendingFile[] = await Promise.all(
      arr.map(async (f) => {
        const decoded = await readTextSmart(f);
        return { name: f.name, size: f.size, content: decoded.content, encoding: decoded.encoding };
      }),
    );
    setFiles((prev) => {
      const merged = new Map(prev.map((f) => [f.name, f]));
      for (const f of next) merged.set(f.name, f);
      return Array.from(merged.values());
    });
    setAnalysis(null);
    setAnalysisKey(null);
    setApplyResult(null);
  }, []);

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setAnalysis(null);
    setAnalysisKey(null);
    setApplyResult(null);
  };

  const buildRequestBody = (action: "analyze" | "apply") => ({
    action,
    files: files.map((f) => ({ name: f.name, content: f.content })),
    strategy: { importMode, strategy, enqueueStaticRebuild },
    ...(action === "apply" && analysis?.previewToken
      ? { previewToken: analysis.previewToken }
      : {}),
  });

  const runAnalyze = async () => {
    if (files.length === 0) return;
    setPending("analyze");
    setApplyResult(null);
    try {
      const res = await fetch("/api/admin/import/legacy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildRequestBody("analyze")),
      });
      const json = await parseImportResponse(res);
      setAnalysis(json);
      setAnalysisKey(currentKey);
    } catch (e) {
      setAnalysis({
        ok: false,
        message: `通信エラー: ${e instanceof Error ? e.message : String(e)}`,
        counts: emptyCounts(),
        preview: [],
        previewTotal: 0,
        errors: [],
      });
      setAnalysisKey(null);
    } finally {
      setPending(null);
    }
  };

  const doApply = async () => {
    if (!hasFreshSuccessfulPreview) return;
    setPending("apply");
    try {
      const res = await fetch("/api/admin/import/legacy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildRequestBody("apply")),
      });
      const json = await parseImportResponse(res);
      setApplyResult(json);
      if (json.ok) router.refresh();
    } catch (e) {
      setApplyResult({
        ok: false,
        message: `通信エラー: ${e instanceof Error ? e.message : String(e)}`,
        counts: emptyCounts(),
        preview: [],
        previewTotal: 0,
        errors: [],
      });
    } finally {
      setPending(null);
    }
  };

  const hasFreshSuccessfulPreview =
    analysis?.ok === true &&
    analysis.errors.length === 0 &&
    typeof analysis.previewToken === "string" &&
    analysisKey === currentKey;

  const totalSize = files.reduce((acc, f) => acc + f.size, 0);
  const displayResult = applyResult ?? analysis;
  const previewRows = (displayResult?.preview ?? []).slice(0, PREVIEW_LIMIT);
  const truncated = (displayResult?.previewTotal ?? 0) - previewRows.length;

  return (
    <div className={styles.root}>
      {/* ドロップゾーン */}
      <div
        className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
      >
        <div className={styles.dropzoneTitle}>
          <Icon name="upload" size={14} aria-hidden /> JSON / CSV をドラッグ & ドロップ
        </div>
        <div className={styles.dropzoneHint}>
          eventinfo.json / video.json / ヘッダー付き CSV を複数同時に投入できます。UTF-8 と Shift_JIS 系を自動判定します。
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,text/csv,text/tab-separated-values,.json,.csv,.tsv"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) {
              void addFiles(e.target.files);
              e.target.value = "";
            }
          }}
        />
      </div>

      {files.length > 0 ? (
        <div className={styles.fileList}>
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className={styles.fileItem}>
              <Icon name="info" size={12} aria-hidden />
              <span className={styles.fileName}>{f.name}</span>
              <span className={styles.fileMeta}>
                {(f.size / 1024).toFixed(1)} KB / {f.encoding}
              </span>
              <button
                className={styles.remove}
                onClick={() => removeFile(i)}
                aria-label={`${f.name} を削除`}
                type="button"
              >
                <Icon name="x" size={12} aria-hidden />
              </button>
            </div>
          ))}
          <div className={styles.fileMeta} style={{ textAlign: "right" }}>
            合計 {files.length} ファイル / {(totalSize / 1024).toFixed(1)} KB
          </div>
        </div>
      ) : null}

      {/* 設定コントロール */}
      <div className={styles.controls}>
        <div className={styles.strategyGroup}>
          <label htmlFor="import-strategy">衝突戦略</label>
          <select
            id="import-strategy"
            value={strategy}
            onChange={(e) => {
              setStrategy(e.target.value as ImportStrategy);
              setAnalysisKey(null);
            }}
            disabled={pending !== null}
          >
            <option value="skip_existing">skip_existing: 既存を保護</option>
            <option value="create_only">create_only: 新規のみ</option>
            <option value="replace_imported">replace_imported: 取り込み済みを置き換え</option>
          </select>
        </div>
        <div className={styles.strategyGroup}>
          <label htmlFor="import-mode">取り込みモード</label>
          <select
            id="import-mode"
            value={importMode}
            onChange={(e) => {
              setImportMode(e.target.value as ImportMode);
              setAnalysisKey(null);
            }}
            disabled={pending !== null}
          >
            <option value="archive">archive: 過去イベント（既定）</option>
            <option value="preserve">preserve: 日時から推定</option>
            <option value="active_event">active_event: 開催中として取り込み</option>
            <option value="draft">draft: 下書き</option>
          </select>
        </div>
        <label className={styles.checkboxLine}>
          <input
            type="checkbox"
            checked={enqueueStaticRebuild}
            onChange={(e) => {
              setEnqueueStaticRebuild(e.target.checked);
              setAnalysisKey(null);
            }}
            disabled={pending !== null}
          />
          <span>取り込み後に静的 JSON 再生成キューへ積む</span>
        </label>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="fn-btn fn-btn-ghost"
          onClick={runAnalyze}
          disabled={files.length === 0 || pending !== null}
        >
          <Icon name="info" size={12} aria-hidden />
          {pending === "analyze" ? "解析中..." : "ドライラン"}
        </button>
        <button
          type="button"
          className="fn-btn fn-btn-primary"
          onClick={() => setConfirmApply(true)}
          disabled={files.length === 0 || pending !== null || !hasFreshSuccessfulPreview}
        >
          <Icon name="upload" size={12} aria-hidden />
          {pending === "apply" ? "取り込み中..." : "取り込み"}
        </button>
      </div>

      {files.length > 0 && !hasFreshSuccessfulPreview ? (
        <div className={styles.fileMeta} style={{ textAlign: "right" }}>
          取り込み前に、現在の設定でドライランを完了してください。
        </div>
      ) : null}

      {/* 結果表示 */}
      {displayResult ? (
        <>
          <div
            className={`${styles.notice} ${displayResult.ok ? styles.successNotice : ""}`}
          >
            <Icon name={displayResult.ok ? "check" : "warning"} size={13} aria-hidden />{" "}
            {applyResult ? "本番取り込み: " : "ドライラン: "}
            {displayResult.message}
          </div>

          <div className={styles.summary}>
            <SummaryCard
              label="イベント"
              value={`${displayResult.counts.events.create + (displayResult.counts.events.replace ?? 0)}`}
              sub={`新規 ${displayResult.counts.events.create} / 置換 ${displayResult.counts.events.replace ?? 0} / skip ${displayResult.counts.events.skip} / 失敗 ${displayResult.counts.events.failed}`}
            />
            <SummaryCard
              label="動画"
              value={`${displayResult.counts.videos.create + (displayResult.counts.videos.replace ?? 0)}`}
              sub={`新規 ${displayResult.counts.videos.create} / 置換 ${displayResult.counts.videos.replace ?? 0} / skip ${displayResult.counts.videos.skip} / 失敗 ${displayResult.counts.videos.failed}`}
            />
            <SummaryCard
              label="X ID"
              value={`${displayResult.counts.xUsers.create}`}
              sub="imported ステータスで取り込み"
            />
            <SummaryCard
              label="メンバー / スタッフ"
              value={`${(displayResult.counts.members ?? 0) + (displayResult.counts.staff ?? 0)}`}
              sub={`members ${displayResult.counts.members ?? 0} / staff ${displayResult.counts.staff ?? 0}`}
            />
          </div>

          {previewRows.length > 0 ? (
            <table className={styles.previewTable}>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>種別</th>
                  <th>ID</th>
                  <th>タイトル</th>
                  <th style={{ width: 90 }}>アクション</th>
                  <th>詳細</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr key={`${row.kind}-${row.id}`}>
                    <td>{row.kind}</td>
                    <td>
                      <code>{row.id}</code>
                    </td>
                    <td>{row.title}</td>
                    <td>
                      <span className={actionClass(row.action, styles)}>{row.action}</span>
                    </td>
                    <td className={styles.warning}>
                      {row.kind === "event" && row.visibility_status ? (
                        <span>公開状態: {row.visibility_status}<br /></span>
                      ) : null}
                      {row.kind === "video" && row.softwareCount > 0 ? (
                        <span>ソフト: {row.softwareCount} 件<br /></span>
                      ) : null}
                      {row.kind === "video" && row.memberCount > 0 ? (
                        <span>メンバー: {row.memberCount} 件<br /></span>
                      ) : null}
                      {row.warnings.length > 0 ? (
                        <span>{row.warnings.join(" / ")}</span>
                      ) : null}
                      {!row.visibility_status &&
                      !row.softwareCount &&
                      !row.memberCount &&
                      row.warnings.length === 0
                        ? "-"
                        : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {truncated > 0 ? (
            <div className={styles.fileMeta}>
              ほか {truncated} 件のプレビューを省略しています。取り込み処理では全件処理します。
            </div>
          ) : null}

          {displayResult.errors.length > 0 ? (
            <div className={styles.errorBox}>
              {displayResult.errors.slice(0, 80).join("\n")}
              {displayResult.errors.length > 80
                ? `\n...ほか ${displayResult.errors.length - 80} 件`
                : ""}
            </div>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        open={confirmApply}
        title="インポートを実行しますか?"
        message={`インポートを実行します。\n\n戦略: ${strategy}\n取り込みモード: ${importMode}\n静的 JSON 再生成: ${enqueueStaticRebuild ? "する" : "しない"}\n\n続行しますか?`}
        confirmLabel="取り込む"
        tone="danger"
        onConfirm={() => {
          setConfirmApply(false);
          void doApply();
        }}
        onCancel={() => setConfirmApply(false)}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}): React.ReactElement {
  return (
    <div className={styles.summaryCard}>
      <div className={styles.summaryLabel}>{label}</div>
      <div className={styles.summaryValue}>{value}</div>
      <div className={styles.summarySub}>{sub}</div>
    </div>
  );
}

function actionClass(action: PreviewRow["action"], cls: typeof styles): string {
  if (action === "create") return cls.statusCreate;
  if (action === "replace") return cls.statusUpdate;
  return cls.statusSkip;
}

function emptyCounts(): ImportCounts {
  return {
    events: { create: 0, replace: 0, skip: 0, failed: 0 },
    videos: { create: 0, replace: 0, skip: 0, failed: 0 },
    xUsers: { create: 0 },
    members: 0,
    staff: 0,
  };
}
