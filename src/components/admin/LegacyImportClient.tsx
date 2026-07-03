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
  status: "create" | "update" | "skip" | "merge";
  conflict: boolean;
  warnings: string[];
  importedState?: {
    visibility_status: "draft" | "private" | "public" | "archived";
    is_active: 0 | 1;
    is_entry_open: 0 | 1;
    is_archived: 0 | 1;
    importMode: string;
  };
  staticRebuildTargets?: string[];
  dbReductionNotes?: string[];
}

type LegacyImportMode = "archive" | "preserve" | "active_event" | "draft";
type StaticRebuildStrategy = "none" | "summary" | "event" | "full";

interface ImportCounts {
  events: { create: number; update: number; skip: number; failed: number };
  videos: { create: number; update: number; skip: number; failed: number };
  xUsers: { create: number; update: number };
  members: number;
  editors: number;
}

interface ImportResult {
  ok: boolean;
  message: string;
  counts: ImportCounts;
  preview: PreviewRow[];
  previewTotal: number;
  errors: string[];
}

interface PendingFile {
  name: string;
  size: number;
  content: string;
  encoding: string;
}

type Strategy = "skip" | "update" | "merge";

const PREVIEW_LIMIT = 80;
const DECODER_CANDIDATES = ["utf-8", "shift_jis", "windows-31j"];

async function readTextSmart(file: File): Promise<{ content: string; encoding: string }> {
  const buffer = await file.arrayBuffer();
  const decoded = DECODER_CANDIDATES.map((encoding) => {
    const content = new TextDecoder(encoding, { fatal: false }).decode(buffer);
    const score =
      (content.match(/\uFFFD/g)?.length ?? 0) * 20 +
      mojibakeHitCount(content);
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
    if (typeof data.message !== "string") {
      return {
        ok: false,
        message: data.error ?? `想定外の応答です (HTTP ${res.status})`,
        counts: emptyCounts(),
        preview: [],
        previewTotal: 0,
        errors: [raw.slice(0, 500)],
      };
    }
    return {
      ok: data.ok === true,
      message: data.message,
      counts: data.counts ?? emptyCounts(),
      preview: Array.isArray(data.preview) ? data.preview : [],
      previewTotal:
        typeof data.previewTotal === "number"
          ? data.previewTotal
          : Array.isArray(data.preview)
            ? data.preview.length
            : 0,
      errors: Array.isArray(data.errors) ? data.errors : [],
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

function buildPreviewKey({
  files,
  importMode,
  enqueueStaticRebuild,
  staticRebuildStrategy,
}: {
  files: PendingFile[];
  importMode: LegacyImportMode;
  enqueueStaticRebuild: boolean;
  staticRebuildStrategy: StaticRebuildStrategy;
}): string {
  return JSON.stringify({
    files: files.map((file) => ({
      name: file.name,
      size: file.size,
      length: file.content.length,
      encoding: file.encoding,
    })),
    importMode,
    enqueueStaticRebuild,
    staticRebuildStrategy,
  });
}

export function LegacyImportClient(): React.ReactElement {
  const router = useRouter();
  const [files, setFiles] = React.useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const [eventStrategy, setEventStrategy] = React.useState<Strategy>("skip");
  const [videoStrategy, setVideoStrategy] = React.useState<Strategy>("skip");
  const [updateXUsers, setUpdateXUsers] = React.useState(false);
  const [importMode, setImportMode] = React.useState<LegacyImportMode>("archive");
  const [staticRebuildStrategy, setStaticRebuildStrategy] =
    React.useState<StaticRebuildStrategy>("event");
  const [enqueueStaticRebuild, setEnqueueStaticRebuild] = React.useState(true);
  const [analysis, setAnalysis] = React.useState<ImportResult | null>(null);
  const [analysisKey, setAnalysisKey] = React.useState<string | null>(null);
  const [applyResult, setApplyResult] = React.useState<ImportResult | null>(null);
  const [pending, setPending] = React.useState<"analyze" | "apply" | null>(null);
  const [confirmApply, setConfirmApply] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const addFiles = React.useCallback(async (list: FileList | File[]) => {
    const arr = Array.from(list).filter(
      (f) =>
        /\.(json|csv|tsv)$/i.test(f.name) ||
        f.type.includes("json") ||
        f.type.includes("csv") ||
        f.type.includes("tab-separated-values"),
    );
    const next: PendingFile[] = await Promise.all(arr.map(async (f) => {
      const decoded = await readTextSmart(f);
      return {
        name: f.name,
        size: f.size,
        content: decoded.content,
        encoding: decoded.encoding,
      };
    }));
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
    if (e.dataTransfer.files?.length) {
      void addFiles(e.dataTransfer.files);
    }
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setAnalysis(null);
    setAnalysisKey(null);
    setApplyResult(null);
  };

  const runAnalyze = async () => {
    if (files.length === 0) return;
    const key = buildPreviewKey({
      files,
      importMode,
      enqueueStaticRebuild,
      staticRebuildStrategy,
    });
    setPending("analyze");
    setApplyResult(null);
    try {
      const res = await fetch("/api/admin/legacy-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "analyze",
          previewLimit: PREVIEW_LIMIT,
          files: files.map((f) => ({ name: f.name, content: f.content })),
          strategy: {
            importMode,
            enqueueStaticRebuild,
            staticRebuildStrategy,
          },
        }),
      });
      const json = await parseImportResponse(res);
      setAnalysis(json);
      setAnalysisKey(key);
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
    if (!hasFreshSuccessfulPreview) {
      setApplyResult({
        ok: false,
        message: "先に現在のファイルと取り込みモードでドライランを実行してください。",
        counts: emptyCounts(),
        preview: [],
        previewTotal: 0,
        errors: ["preview-required"],
      });
      return;
    }
    setPending("apply");
    try {
      const res = await fetch("/api/admin/legacy-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          previewLimit: PREVIEW_LIMIT,
          files: files.map((f) => ({ name: f.name, content: f.content })),
          strategy: {
            events: eventStrategy,
            videos: videoStrategy,
            updateXUsers,
            importMode,
            enqueueStaticRebuild,
            staticRebuildStrategy,
          },
        }),
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

  const runApply = () => {
    if (files.length === 0) return;
    if (!hasFreshSuccessfulPreview) return;
    setConfirmApply(true);
  };

  const totalSize = files.reduce((acc, f) => acc + f.size, 0);
  const currentPreviewKey = buildPreviewKey({
    files,
    importMode,
    enqueueStaticRebuild,
    staticRebuildStrategy,
  });
  const hasFreshSuccessfulPreview =
    analysis?.ok === true &&
    analysis.errors.length === 0 &&
    analysisKey === currentPreviewKey;
  const displayResult = applyResult ?? analysis;
  const previewRows = (displayResult?.preview ?? []).slice(0, PREVIEW_LIMIT);
  const truncated = (displayResult?.previewTotal ?? 0) - previewRows.length;

  return (
    <div className={styles.root}>
      <div
        className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
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

      <div className={styles.controls}>
        <div className={styles.strategyGroup}>
          <label htmlFor="ev-strategy">イベント衝突</label>
          <select
            id="ev-strategy"
            value={eventStrategy}
            onChange={(e) => setEventStrategy(e.target.value as Strategy)}
            disabled={pending !== null}
          >
            <option value="skip">skip: 既存を保護</option>
            <option value="update">update: 全置換</option>
            <option value="merge">merge: 空欄は保持</option>
          </select>
        </div>
        <div className={styles.strategyGroup}>
          <label htmlFor="vd-strategy">動画衝突</label>
          <select
            id="vd-strategy"
            value={videoStrategy}
            onChange={(e) => setVideoStrategy(e.target.value as Strategy)}
            disabled={pending !== null}
          >
            <option value="skip">skip: 既存を保護</option>
            <option value="update">update: 全置換</option>
            <option value="merge">merge: 空欄は保持</option>
          </select>
        </div>
        <div className={styles.strategyGroup}>
          <label htmlFor="import-mode">取り込みモード</label>
          <select
            id="import-mode"
            value={importMode}
            onChange={(e) => {
              setImportMode(e.target.value as LegacyImportMode);
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
        <div className={styles.strategyGroup}>
          <label htmlFor="rebuild-strategy">静的 JSON 再生成</label>
          <select
            id="rebuild-strategy"
            value={staticRebuildStrategy}
            onChange={(e) =>
              {
                setStaticRebuildStrategy(e.target.value as StaticRebuildStrategy);
                setAnalysisKey(null);
              }
            }
            disabled={pending !== null}
          >
            <option value="event">event: イベント単位（推奨）</option>
            <option value="summary">summary: 一覧のみ</option>
            <option value="full">full: 動画単位も含む</option>
            <option value="none">none: キューに積まない</option>
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
        <label className={styles.checkboxLine}>
          <input
            type="checkbox"
            checked={updateXUsers}
            onChange={(e) => setUpdateXUsers(e.target.checked)}
            disabled={pending !== null}
          />
          <span>既存 X ID の表示名も更新</span>
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
          onClick={runApply}
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

      {displayResult ? (
        <>
          <div
            className={`${styles.notice} ${
              displayResult.ok ? styles.successNotice : ""
            }`}
          >
            <Icon
              name={displayResult.ok ? "check" : "warning"}
              size={13}
              aria-hidden
            />{" "}
            {applyResult ? "本番取り込み: " : "ドライラン: "}
            {displayResult.message}
          </div>

          <div className={styles.summary}>
            <SummaryCard
              label="イベント"
              value={`${displayResult.counts.events.create + displayResult.counts.events.update}`}
              sub={`新規 ${displayResult.counts.events.create} / 更新 ${displayResult.counts.events.update} / skip ${displayResult.counts.events.skip} / 失敗 ${displayResult.counts.events.failed}`}
            />
            <SummaryCard
              label="動画"
              value={`${displayResult.counts.videos.create + displayResult.counts.videos.update}`}
              sub={`新規 ${displayResult.counts.videos.create} / 更新 ${displayResult.counts.videos.update} / skip ${displayResult.counts.videos.skip} / 失敗 ${displayResult.counts.videos.failed}`}
            />
            <SummaryCard
              label="X ID"
              value={`${displayResult.counts.xUsers.create}`}
              sub={`既存更新 ${displayResult.counts.xUsers.update}`}
            />
            <SummaryCard
              label="運営 / メンバー"
              value={`${displayResult.counts.editors + displayResult.counts.members}`}
              sub={`editors ${displayResult.counts.editors} / members ${displayResult.counts.members}`}
            />
          </div>

          {previewRows.length > 0 ? (
            <table className={styles.previewTable}>
              <thead>
                <tr>
                  <th style={{ width: 70 }}>種別</th>
                  <th>ID</th>
                  <th>タイトル</th>
                  <th style={{ width: 90 }}>状態</th>
                  <th>警告</th>
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
                      <span className={statusClass(row.status, styles)}>
                        {row.status}
                      </span>
                    </td>
                    <td className={styles.warning}>
                      {row.importedState ? (
                        <span>
                          公開状態: {row.importedState.visibility_status}
                          <br />
                          互換フラグ: archived=
                          {row.importedState.is_archived} active=
                          {row.importedState.is_active}
                          <br />
                        </span>
                      ) : null}
                      {row.staticRebuildTargets?.length ? (
                        <span>
                          静的JSON: {row.staticRebuildTargets.join(", ")}
                          <br />
                        </span>
                      ) : null}
                      {row.dbReductionNotes?.length ? (
                        <span>{row.dbReductionNotes.join(" · ")}</span>
                      ) : null}
                      {row.warnings.length > 0 ? (
                        <span>{row.warnings.join(" / ")}</span>
                      ) : null}
                      {!row.importedState &&
                      !row.staticRebuildTargets?.length &&
                      !row.dbReductionNotes?.length &&
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
        message={`インポートを実行します。\n\nイベント衝突: ${eventStrategy}\n動画衝突: ${videoStrategy}\n既存 X ID 更新: ${updateXUsers ? "する" : "しない"}\n\n続行しますか?`}
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

function statusClass(
  status: PreviewRow["status"],
  cls: typeof styles,
): string {
  if (status === "create") return cls.statusCreate;
  if (status === "update" || status === "merge") return cls.statusUpdate;
  return cls.statusSkip;
}

function emptyCounts(): ImportCounts {
  return {
    events: { create: 0, update: 0, skip: 0, failed: 0 },
    videos: { create: 0, update: 0, skip: 0, failed: 0 },
    xUsers: { create: 0, update: 0 },
    members: 0,
    editors: 0,
  };
}
