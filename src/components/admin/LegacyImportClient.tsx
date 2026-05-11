"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import styles from "./LegacyImportClient.module.css";
import { Icon } from "@/components/ui/Icon";

interface PreviewRow {
  kind: "event" | "video";
  id: string;
  title: string;
  status: "create" | "update" | "skip" | "merge";
  conflict: boolean;
  warnings: string[];
}

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
      (content.match(/邵|繧|縺|荳|譁|隕/g)?.length ?? 0);
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
        errors: [raw.slice(0, 500)],
      };
    }
    return {
      ok: data.ok === true,
      message: data.message,
      counts: data.counts ?? emptyCounts(),
      preview: Array.isArray(data.preview) ? data.preview : [],
      errors: Array.isArray(data.errors) ? data.errors : [],
    };
  } catch {
    return {
      ok: false,
      message: `JSON として解析できない応答です (HTTP ${res.status})`,
      counts: emptyCounts(),
      preview: [],
      errors: [raw.slice(0, 500)],
    };
  }
}

export function LegacyImportClient(): React.ReactElement {
  const router = useRouter();
  const [files, setFiles] = React.useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const [eventStrategy, setEventStrategy] = React.useState<Strategy>("skip");
  const [videoStrategy, setVideoStrategy] = React.useState<Strategy>("skip");
  const [updateXUsers, setUpdateXUsers] = React.useState(false);
  const [analysis, setAnalysis] = React.useState<ImportResult | null>(null);
  const [applyResult, setApplyResult] = React.useState<ImportResult | null>(null);
  const [pending, setPending] = React.useState<"analyze" | "apply" | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const addFiles = React.useCallback(async (list: FileList | File[]) => {
    const arr = Array.from(list).filter(
      (f) =>
        /\.(json|csv)$/i.test(f.name) ||
        f.type.includes("json") ||
        f.type.includes("csv"),
    );
    const next: PendingFile[] = [];
    for (const f of arr) {
      const decoded = await readTextSmart(f);
      next.push({
        name: f.name,
        size: f.size,
        content: decoded.content,
        encoding: decoded.encoding,
      });
    }
    setFiles((prev) => {
      const merged = new Map(prev.map((f) => [f.name, f]));
      for (const f of next) merged.set(f.name, f);
      return Array.from(merged.values());
    });
    setAnalysis(null);
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
    setApplyResult(null);
  };

  const runAnalyze = async () => {
    if (files.length === 0) return;
    setPending("analyze");
    setApplyResult(null);
    try {
      const res = await fetch("/api/admin/legacy-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "analyze",
          files: files.map((f) => ({ name: f.name, content: f.content })),
        }),
      });
      setAnalysis(await parseImportResponse(res));
    } catch (e) {
      setAnalysis({
        ok: false,
        message: `通信エラー: ${e instanceof Error ? e.message : String(e)}`,
        counts: emptyCounts(),
        preview: [],
        errors: [],
      });
    } finally {
      setPending(null);
    }
  };

  const runApply = async () => {
    if (files.length === 0) return;
    const confirmed = window.confirm(
      `インポートを実行します。\n\nイベント衝突: ${eventStrategy}\n動画衝突: ${videoStrategy}\n既存 X ID 更新: ${updateXUsers ? "する" : "しない"}\n\n続行しますか?`,
    );
    if (!confirmed) return;
    setPending("apply");
    try {
      const res = await fetch("/api/admin/legacy-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          files: files.map((f) => ({ name: f.name, content: f.content })),
          strategy: {
            events: eventStrategy,
            videos: videoStrategy,
            updateXUsers,
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
        errors: [],
      });
    } finally {
      setPending(null);
    }
  };

  const totalSize = files.reduce((acc, f) => acc + f.size, 0);
  const displayResult = applyResult ?? analysis;
  const previewRows = (displayResult?.preview ?? []).slice(0, PREVIEW_LIMIT);
  const truncated = (displayResult?.preview.length ?? 0) - previewRows.length;

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
          accept="application/json,text/csv,.json,.csv"
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
          disabled={files.length === 0 || pending !== null}
        >
          <Icon name="upload" size={12} aria-hidden />
          {pending === "apply" ? "取り込み中..." : "取り込み"}
        </button>
      </div>

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
                      {row.warnings.length === 0
                        ? "-"
                        : row.warnings.join(" / ")}
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
