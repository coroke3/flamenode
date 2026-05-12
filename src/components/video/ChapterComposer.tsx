"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { createChapter } from "@/lib/actions/chapter";
import { requestCurrentTime } from "./playerBridge";

interface ChapterComposerProps {
  videoId: string;
  /** active_x_user_id が承認済か。false なら disabled ボタンと案内のみ。 */
  canPost: boolean;
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

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const mm = Math.floor(sec / 60);
  const ss = Math.floor(sec % 60);
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

/**
 * チャプター投稿フォーム。動画詳細ページ右レール下に置く想定。
 */
export function ChapterComposer({
  videoId,
  canPost,
}: ChapterComposerProps): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [timeStr, setTimeStr] = React.useState("0:00");
  const [label, setLabel] = React.useState("");
  const [note, setNote] = React.useState("");
  const [isPublic, setIsPublic] = React.useState(true);
  const [showOnBar, setShowOnBar] = React.useState(true);
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const fillCurrentTime = async () => {
    const t = await requestCurrentTime();
    setTimeStr(formatTime(t));
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canPost) {
      setError("チャプター投稿には承認済み X ID が必要です。");
      return;
    }
    if (!label.trim()) {
      setError("ラベルを入力してください。");
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
    fd.set("show_on_player_bar", showOnBar ? "1" : "0");
    startTransition(async () => {
      const r = await createChapter(fd);
      if (!r.ok) {
        setError(r.message ?? "投稿に失敗しました。");
        return;
      }
      setLabel("");
      setNote("");
      setTimeStr("0:00");
      router.refresh();
    });
  };

  if (!canPost) {
    return (
      <section
        style={{
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-card)",
          borderRadius: "var(--radius-md)",
          padding: 12,
          fontSize: 12,
          color: "var(--text-muted)",
        }}
      >
        <Icon name="info" size={12} aria-hidden /> 承認済み X ID を選択すると
        チャプターを投稿できます。
      </section>
    );
  }

  return (
    <section
      style={{
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-card)",
        borderRadius: "var(--radius-md)",
        padding: 12,
      }}
    >
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
      {open ? (
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
              onClick={fillCurrentTime}
              disabled={busy}
            >
              <Icon name="clock" size={11} aria-hidden /> 現在時刻
            </button>
            <span className="fn-badge fn-badge-neutral">チャプターコメント</span>
          </div>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="ラベル (例: サビ前 / 振り返りメモ)"
            className="fn-input"
            maxLength={120}
            required
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="補足メモ (任意, 1000文字以内)"
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
                checked={showOnBar}
                onChange={(e) => setShowOnBar(e.target.checked)}
              />
              再生バーに点表示
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
          <button
            type="submit"
            className="fn-btn fn-btn-primary fn-btn-sm"
            disabled={busy}
          >
            <Icon name="plus" size={11} aria-hidden />
            {busy ? "送信中…" : "投稿"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
