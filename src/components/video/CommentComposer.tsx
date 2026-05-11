"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { createComment } from "@/lib/actions/comment";

export interface CommentComposerChapterOption {
  id: string;
  chapter_time: number;
  chapter_label: string;
}

interface CommentComposerProps {
  videoId: string;
  canPost: boolean;
  chapterOptions: CommentComposerChapterOption[];
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const mm = Math.floor(sec / 60);
  const ss = Math.floor(sec % 60);
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

/**
 * 時間付きコメント投稿フォーム。
 * チャプター紐付けは任意 (未選択時は動画への直接コメント)。
 */
export function CommentComposer({
  videoId,
  canPost,
  chapterOptions,
}: CommentComposerProps): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [chapterId, setChapterId] = React.useState<string>("");
  const [body, setBody] = React.useState("");
  const [isPublic, setIsPublic] = React.useState(true);
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canPost) {
      setError("コメント投稿には承認済み X ID が必要です。");
      return;
    }
    if (!body.trim()) {
      setError("本文を入力してください。");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("video_id", videoId);
    if (chapterId) fd.set("chapter_id", chapterId);
    fd.set("body", body.trim());
    fd.set("visibility", isPublic ? "public" : "private");
    startTransition(async () => {
      const r = await createComment(fd);
      if (!r.ok) {
        setError(r.message ?? "投稿に失敗しました。");
        return;
      }
      setBody("");
      setChapterId("");
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
        コメントを投稿できます。
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
          コメント投稿
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
          {chapterOptions.length > 0 ? (
            <select
              className="fn-select"
              value={chapterId}
              onChange={(e) => setChapterId(e.target.value)}
              aria-label="紐付けるチャプター"
            >
              <option value="">チャプター無し (動画全体)</option>
              {chapterOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {formatTime(c.chapter_time)} - {c.chapter_label}
                </option>
              ))}
            </select>
          ) : null}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="短いコメント (500文字以内)"
            className="fn-input"
            rows={3}
            maxLength={500}
            required
          />
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              fontSize: 11,
              color: "var(--text-secondary)",
              alignItems: "center",
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
            <span style={{ marginLeft: "auto" }}>{body.length}/500</span>
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
