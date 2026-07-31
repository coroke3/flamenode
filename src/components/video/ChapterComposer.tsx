"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { createChapter, createChaptersBulk } from "@/lib/actions/chapter";
import { appendPublicReflectionDelayNotice } from "@/lib/staticRebuild/publicReflectionNotice";
import {
  MAX_ATOMIC_CHAPTER_BULK_ROWS,
  parseChapterBulkCsv,
} from "@/lib/actions/chapterLimits";
import { usePlayerTimeSnapshot } from "./usePlayerTime";

interface ChapterComposerProps {
  videoId: string;
  /** active_x_user_id が承認済か。false なら disabled 案内のみ。 */
  canPost: boolean;
  /**
   * `canPost = false` のときに「X ID設定へ」リンクとして使う URL。
   * 未指定なら CTA は出さず案内文だけ表示する。
   * 呼び出し側で `/dashboard/settings?next=...` を組み立てて渡す。
   */
  settingsHref?: string;
  /** 動画オーナー / admin のみ CSV 一括登録 UI を出す。 */
  canBulk?: boolean;
  /**
   * true のとき、単発投稿フォームを描画せず CSV 一括登録 UI だけ表示する。
   * 編集ページ側のチャプター一括登録パネル用。動画詳細ページからは false (既定)。
   */
  bulkOnly?: boolean;
  initialTime?: number;
  active?: boolean;
  presentation?: "card" | "inline-sheet";
  onCancel?: () => void;
  onSuccess?: (chapter: {
    chapterTime: number;
    label: string;
    pendingPublicReflection?: boolean;
  }) => void;
}

function parseTimeInput(raw: string): number {
  const s = raw.trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/^(\d{1,2}):([0-5]\d)(?:[.:](\d{1,3}))?$/);
  if (m) {
    const min = Number(m[1]);
    const sec = Number(m[2]);
    const ms = m[3] ? Number(m[3].padEnd(3, "0")) : 0;
    return min * 60 + sec + ms / 1000;
  }
  const mh = s.match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/);
  if (mh) {
    return Number(mh[1]) * 3600 + Number(mh[2]) * 60 + Number(mh[3]);
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatTimeInput(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return [
      String(hours),
      String(minutes).padStart(2, "0"),
      String(remainingSeconds).padStart(2, "0"),
    ].join(":");
  }

  return [
    String(minutes),
    String(remainingSeconds).padStart(2, "0"),
  ].join(":");
}

/**
 * チャプター投稿フォーム。動画詳細ページ右レール下に置く想定。
 */
export function ChapterComposer({
  videoId,
  canPost,
  settingsHref,
  canBulk = false,
  bulkOnly = false,
  initialTime = 0,
  active = true,
  presentation = "card",
  onCancel,
  onSuccess,
}: ChapterComposerProps): React.ReactElement {
  const isInlineSheet = presentation === "inline-sheet";
  const router = useRouter();
  const playerTime = usePlayerTimeSnapshot();
  const [open, setOpen] = React.useState(false);
  const [timeStr, setTimeStr] = React.useState(() =>
    formatTimeInput(initialTime),
  );
  const [label, setLabel] = React.useState("");
  const [note, setNote] = React.useState("");
  const [isPublic, setIsPublic] = React.useState(true);
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulkCsv, setBulkCsv] = React.useState("");
  const [bulkBusy, startBulkTransition] = React.useTransition();
  const [bulkMessage, setBulkMessage] = React.useState<string | null>(null);
  const [bulkErrors, setBulkErrors] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!isInlineSheet || !active) return;

    setTimeStr(formatTimeInput(initialTime));
  }, [active, initialTime, isInlineSheet]);

  const applyCurrentTime = React.useCallback(() => {
    if (!playerTime.received) {
      return;
    }
    setTimeStr(formatTimeInput(playerTime.currentTime));
  }, [playerTime]);

  const submitBulk = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBulkMessage(null);
    setBulkErrors([]);
    if (!bulkCsv.trim()) {
      setBulkMessage("CSV を貼り付けてください。");
      return;
    }
    const dataRowCount = parseChapterBulkCsv(bulkCsv).length;
    if (dataRowCount > MAX_ATOMIC_CHAPTER_BULK_ROWS) {
      setBulkMessage(`CSVは一度に最大${MAX_ATOMIC_CHAPTER_BULK_ROWS}行まで登録できます。`);
      return;
    }
    const fd = new FormData();
    fd.set("video_id", videoId);
    fd.set("csv", bulkCsv);
    startBulkTransition(async () => {
      const r = await createChaptersBulk(fd);
      const baseMessage = r.message ?? null;
      setBulkMessage(
        baseMessage && r.pendingPublicReflection
          ? appendPublicReflectionDelayNotice(baseMessage)
          : baseMessage,
      );
      setBulkErrors(r.errors ?? []);
      if (r.ok && (r.inserted ?? 0) > 0) {
        setBulkCsv("");
        router.refresh();
      }
    });
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canPost) {
      setError("チャプター投稿には承認済み X ID が必要です。");
      return;
    }
    if (!label.trim()) {
      setError(
        isInlineSheet
          ? "タイトルを入力してください。"
          : "ラベルを入力してください。",
      );
      return;
    }
    const seconds = parseTimeInput(timeStr);
    setError(null);
    const fd = new FormData();
    fd.set("video_id", videoId);
    fd.set("chapter_time", String(seconds));
    fd.set("chapter_label", label.trim());
    fd.set("note", note.trim());
    fd.set("visibility", isPublic ? "public" : "private");
    fd.set("marker_kind", "chapter");
    fd.set("show_on_player_bar", "0");
    startTransition(async () => {
      const r = await createChapter(fd);
      if (!r.ok) {
        setError(r.message ?? "投稿に失敗しました。");
        return;
      }
      const submittedLabel = label.trim();

      setLabel("");
      setNote("");
      setTimeStr(formatTimeInput(seconds));

      router.refresh();

      onSuccess?.({
        chapterTime: seconds,
        label: submittedLabel,
        pendingPublicReflection: r.pendingPublicReflection,
      });
    });
  };

  // 単発フォームを使わない bulkOnly モードでは、canPost ガード (X ID 設定への案内) を
  // 出さない。CSV 一括登録 UI も canBulk が false なら何も描画しない。
  if (!canPost && !bulkOnly) {
    return (
      <section
        style={{
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-card)",
          borderRadius: "var(--radius-md)",
          padding: 12,
          fontSize: 12,
          color: "var(--text-muted)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span>
          <Icon name="info" size={12} aria-hidden /> 承認済み X ID を選択すると
          チャプターを投稿できます。
        </span>
        {settingsHref ? (
          <Link
            href={settingsHref}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            X ID設定へ
          </Link>
        ) : null}
      </section>
    );
  }
  if (bulkOnly && !canBulk) {
    return <></>;
  }

  return (
    <section
      style={
        isInlineSheet
          ? {
              padding: 0,
              background: "transparent",
            }
          : {
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-card)",
              borderRadius: "var(--radius-md)",
              padding: 12,
            }
      }
    >
      {!bulkOnly && !isInlineSheet ? (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: open ? 10 : 0,
          }}
        >
          <strong style={{ fontSize: 12, letterSpacing: "0.08em" }}>
            チャプターコメント投稿
          </strong>
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "閉じる" : "開く"}
          </button>
        </header>
      ) : bulkOnly ? (
        <header style={{ marginBottom: 6 }}>
          <strong style={{ fontSize: 12, letterSpacing: "0.08em" }}>
            チャプターコメント CSV 一括登録
          </strong>
        </header>
      ) : null}
      {(isInlineSheet || open) && !bulkOnly ? (
        <form
          onSubmit={onSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="text"
              value={timeStr}
              onChange={(e) => setTimeStr(e.target.value)}
              placeholder="mm:ss"
              className="fn-input"
              style={{ width: 90 }}
              maxLength={9}
              required
            />
            <button
              type="button"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              onClick={applyCurrentTime}
              disabled={!playerTime.received || busy}
            >
              現在位置
            </button>
            <span className="fn-badge fn-badge-neutral">チャプターコメント</span>
          </div>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={
              isInlineSheet
                ? "タイトル（例：サビの入り）"
                : "ラベル (例: サビ前 / 振り返りメモ)"
            }
            className="fn-input"
            maxLength={120}
            required
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              isInlineSheet
                ? "コメント"
                : "補足メモ (任意, 1000文字以内)"
            }
            className="fn-input"
            rows={2}
            maxLength={1000}
          />
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              fontSize: 11,
              color: "var(--text-secondary)",
            }}
          >
            <label
              style={{
                display: "inline-flex",
                gap: 4,
                alignItems: "center",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              公開
            </label>
          </div>
          {error ? (
            <p
              role="alert"
              style={{ fontSize: 11, color: "var(--accent-danger)" }}
            >
              <Icon name="warning" size={11} aria-hidden /> {error}
            </p>
          ) : null}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isInlineSheet ? "1fr 1fr" : "1fr",
              gap: 8,
            }}
          >
            {isInlineSheet ? (
              <button
                type="button"
                className="fn-btn fn-btn-ghost"
                onClick={onCancel}
                disabled={busy}
              >
                キャンセル
              </button>
            ) : null}
            <button
              type="submit"
              className="fn-btn fn-btn-primary"
              disabled={busy}
            >
              <Icon name="plus" size={11} aria-hidden />
              {busy ? "送信中…" : "投稿"}
            </button>
          </div>
        </form>
      ) : null}

      {canBulk ? (
        <details
          style={{
            // bulkOnly のときは独立カードとして使うので、上区切り線は不要。
            marginTop: bulkOnly ? 0 : open ? 12 : 8,
            borderTop: bulkOnly ? undefined : "1px solid var(--border-subtle)",
            paddingTop: bulkOnly ? 0 : 8,
          }}
          // bulkOnly 時は最初から開いた状態にする (専用パネルとして利用される文脈)
          open={bulkOnly || bulkOpen}
          onToggle={(e) => setBulkOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary
            style={{
              fontSize: 11.5,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            <Icon name="upload" size={11} aria-hidden /> CSV で一括登録 (動画オーナーのみ)
          </summary>
          <form
            onSubmit={submitBulk}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              marginTop: 8,
            }}
          >
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
              列: <code>time,label,note,visibility,member</code> /
              time は <code>mm:ss</code> または <code>hh:mm:ss</code> /
              最大 {MAX_ATOMIC_CHAPTER_BULK_ROWS} 行。member 列は互換入力として受け付けますが登録には使用しません。
            </p>
            <textarea
              className="fn-input"
              rows={5}
              style={{ fontFamily: "monospace", fontSize: 12 }}
              placeholder={"0:30,オープニング,,public,\n1:45,Aパート,音響担当,public,sato_design"}
              value={bulkCsv}
              onChange={(e) => setBulkCsv(e.target.value)}
              disabled={bulkBusy}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="submit"
                className="fn-btn fn-btn-primary fn-btn-sm"
                disabled={bulkBusy}
              >
                <Icon name="plus" size={11} aria-hidden />
                {bulkBusy ? "登録中…" : "一括登録"}
              </button>
              {bulkMessage ? (
                <span
                  style={{
                    fontSize: 11,
                    color: bulkErrors.length > 0
                      ? "var(--accent-danger)"
                      : "var(--text-secondary)",
                  }}
                >
                  {bulkMessage}
                </span>
              ) : null}
            </div>
            {bulkErrors.length > 0 ? (
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  fontSize: 11,
                  color: "var(--accent-danger)",
                }}
              >
                {bulkErrors.slice(0, 8).map((er, i) => (
                  <li key={i}>{er}</li>
                ))}
                {bulkErrors.length > 8 ? (
                  <li>...他 {bulkErrors.length - 8} 件</li>
                ) : null}
              </ul>
            ) : null}
          </form>
        </details>
      ) : null}
    </section>
  );
}
