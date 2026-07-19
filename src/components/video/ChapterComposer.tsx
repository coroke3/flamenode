"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { createChapter } from "@/lib/actions/chapter";

interface ChapterComposerProps {
  videoId: string;
  /** active_x_user_id が承認済か。false なら disabled 案内のみ。 */
  canPost: boolean;
  /** canPost=false のときに表示する X ID 設定画面へのリンク。 */
  settingsHref?: string;
  /** 旧呼び出し側との型互換用。通常チャプターのCSV一括登録は廃止済み。 */
  canBulk?: boolean;
  /** 旧呼び出し側との型互換用。true の場合も一括登録UIは表示しない。 */
  bulkOnly?: boolean;
}

function parseTimeInput(raw: string): number {
  const s = raw.trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);

  const mmss = s.match(/^(\d{1,2}):([0-5]\d)(?:[.:](\d{1,3}))?$/);
  if (mmss) {
    const min = Number(mmss[1]);
    const sec = Number(mmss[2]);
    const ms = mmss[3] ? Number(mmss[3].padEnd(3, "0")) : 0;
    return min * 60 + sec + ms / 1000;
  }

  const hhmmss = s.match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/);
  if (hhmmss) {
    return (
      Number(hhmmss[1]) * 3600 +
      Number(hhmmss[2]) * 60 +
      Number(hhmmss[3])
    );
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** 動画詳細ページから通常チャプターコメントを1件投稿するフォーム。 */
export function ChapterComposer({
  videoId,
  canPost,
  settingsHref,
  canBulk: _canBulk,
  bulkOnly = false,
}: ChapterComposerProps): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [timeStr, setTimeStr] = React.useState("0:00");
  const [label, setLabel] = React.useState("");
  const [note, setNote] = React.useState("");
  const [isPublic, setIsPublic] = React.useState(true);
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  void _canBulk;

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
    fd.set("show_on_player_bar", "0");

    startTransition(async () => {
      const result = await createChapter(fd);
      if (!result.ok) {
        setError(result.message ?? "投稿に失敗しました。");
        return;
      }
      setLabel("");
      setNote("");
      setTimeStr("0:00");
      router.refresh();
    });
  };

  if (bulkOnly) return <></>;

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
          onClick={() => setOpen((value) => !value)}
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
            <span className="fn-badge fn-badge-neutral">
              チャプターコメント
            </span>
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

          <label
            style={{
              display: "inline-flex",
              gap: 4,
              alignItems: "center",
              cursor: "pointer",
              fontSize: 11,
              color: "var(--text-secondary)",
            }}
          >
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            公開
          </label>

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
