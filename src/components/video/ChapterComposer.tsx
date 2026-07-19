"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import {
  createChapter,
  getChapterPostingContext,
} from "@/lib/actions/chapter";
import { formatDuration } from "@/lib/utils/format";
import styles from "./ChapterComposer.module.css";

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

function parseTimeInput(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^\d+(?:\.\d{1,3})?$/.test(value)) return Number(value);

  const mmss = value.match(/^(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?$/);
  if (mmss) {
    const minutes = Number(mmss[1]);
    const seconds = Number(mmss[2]);
    const milliseconds = mmss[3]
      ? Number(mmss[3].padEnd(3, "0"))
      : 0;
    return minutes * 60 + seconds + milliseconds / 1000;
  }

  const hhmmss = value.match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/);
  if (hhmmss) {
    return (
      Number(hhmmss[1]) * 3600 +
      Number(hhmmss[2]) * 60 +
      Number(hhmmss[3])
    );
  }

  return null;
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
  const [visibility, setVisibility] = React.useState<"public" | "private">(
    "public",
  );
  const [durationSeconds, setDurationSeconds] = React.useState<number | null>(
    null,
  );
  const [contextError, setContextError] = React.useState<string | null>(null);
  const [busy, startTransition] = React.useTransition();
  const [contextLoading, startContextTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const contextRequestRef = React.useRef(0);

  void _canBulk;

  const loadContext = React.useCallback(() => {
    const requestId = contextRequestRef.current + 1;
    contextRequestRef.current = requestId;
    setContextError(null);
    setDurationSeconds(null);

    startContextTransition(async () => {
      const result = await getChapterPostingContext(videoId);
      if (contextRequestRef.current !== requestId) return;
      if (!result.ok || result.durationSeconds == null) {
        setDurationSeconds(null);
        setContextError(
          result.message ?? "動画時間を取得できないため投稿できません。",
        );
        return;
      }
      setDurationSeconds(result.durationSeconds);
    });
  }, [videoId]);

  React.useEffect(() => {
    contextRequestRef.current += 1;
    setDurationSeconds(null);
    setContextError(null);
    setError(null);
    setSuccess(null);
  }, [videoId]);

  React.useEffect(() => {
    if (
      !open ||
      !canPost ||
      bulkOnly ||
      contextLoading ||
      durationSeconds != null ||
      contextError
    ) {
      return;
    }
    loadContext();
  }, [
    bulkOnly,
    canPost,
    contextError,
    contextLoading,
    durationSeconds,
    loadContext,
    open,
  ]);

  const parsedTime = React.useMemo(() => parseTimeInput(timeStr), [timeStr]);
  const timeError = React.useMemo(() => {
    if (parsedTime == null) {
      return "時刻は 1:23、0:01:23、または秒数で入力してください。";
    }
    if (durationSeconds != null && parsedTime > durationSeconds) {
      return `動画時間 ${formatDuration(durationSeconds)} を超えています。`;
    }
    return null;
  }, [durationSeconds, parsedTime]);

  const clearFeedback = React.useCallback(() => {
    setError(null);
    setSuccess(null);
  }, []);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSuccess(null);
    if (!canPost) {
      setError("チャプター投稿には承認済み X ID が必要です。");
      return;
    }
    if (!label.trim()) {
      setError("見出しを入力してください。");
      return;
    }
    if (parsedTime == null) {
      setError("時刻の形式を確認してください。");
      return;
    }
    if (durationSeconds == null) {
      setError(
        contextError ?? "動画時間を確認できないため、現在は投稿できません。",
      );
      return;
    }
    if (parsedTime > durationSeconds) {
      setError(`動画時間 ${formatDuration(durationSeconds)} を超えています。`);
      return;
    }

    setError(null);
    const formData = new FormData();
    formData.set("video_id", videoId);
    formData.set("chapter_time", String(parsedTime));
    formData.set("chapter_label", label.trim());
    formData.set("note", note.trim());
    formData.set("visibility", visibility);
    formData.set("show_on_player_bar", "0");

    startTransition(async () => {
      const result = await createChapter(formData);
      if (!result.ok) {
        setError(result.message ?? "投稿に失敗しました。");
        return;
      }
      setLabel("");
      setNote("");
      setTimeStr("0:00");
      setVisibility("public");
      setSuccess("チャプターコメントを投稿しました。");
      router.refresh();
    });
  };

  if (bulkOnly) return <></>;

  if (!canPost) {
    return (
      <section className={styles.disabledPanel}>
        <span>
          <Icon name="info" size={12} aria-hidden /> 承認済み X ID を選択すると
          チャプターを投稿できます。
        </span>
        {settingsHref ? (
          <Link href={settingsHref} className="fn-btn fn-btn-ghost fn-btn-sm">
            X ID設定へ
          </Link>
        ) : null}
      </section>
    );
  }

  const submitDisabled =
    busy ||
    contextLoading ||
    durationSeconds == null ||
    parsedTime == null ||
    parsedTime > durationSeconds ||
    !label.trim();

  return (
    <section className={styles.root} aria-labelledby="chapter-composer-heading">
      <header className={styles.header}>
        <span className={styles.headingGroup}>
          <span className={styles.headingIcon} aria-hidden>
            <Icon name="comment" size={13} />
          </span>
          <strong id="chapter-composer-heading" className={styles.heading}>
            チャプターコメント投稿
          </strong>
        </span>
        <button
          type="button"
          className={styles.toggleButton}
          onClick={() => {
            setOpen((value) => !value);
            setError(null);
            setSuccess(null);
          }}
          aria-expanded={open}
          aria-controls="chapter-comment-form"
        >
          <span>{open ? "閉じる" : "投稿する"}</span>
          <Icon name={open ? "chevron-up" : "chevron-down"} size={13} aria-hidden />
        </button>
      </header>

      {open ? (
        <form
          id="chapter-comment-form"
          onSubmit={onSubmit}
          className={styles.form}
          aria-busy={busy || contextLoading}
        >
          <div className={styles.field}>
            <label htmlFor="chapter-comment-time" className={styles.label}>
              時刻
            </label>
            <div className={styles.timeRow}>
              <input
                id="chapter-comment-time"
                type="text"
                value={timeStr}
                onChange={(event) => {
                  setTimeStr(event.target.value);
                  clearFeedback();
                }}
                placeholder="1:23"
                className="fn-input"
                aria-invalid={Boolean(timeError)}
                aria-describedby="chapter-comment-time-help"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={10}
                disabled={busy}
                required
              />
              <span className={styles.durationText}>
                / 動画時間{" "}
                {contextLoading
                  ? "確認中…"
                  : durationSeconds != null
                    ? formatDuration(durationSeconds)
                    : "未取得"}
              </span>
            </div>
            <p
              id="chapter-comment-time-help"
              className={timeError ? styles.fieldError : styles.fieldHelp}
            >
              {timeError ?? "例: 1:23、0:01:23、83、83.5"}
            </p>
          </div>

          <div className={styles.field}>
            <label htmlFor="chapter-comment-label" className={styles.label}>
              見出し
            </label>
            <input
              id="chapter-comment-label"
              type="text"
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                clearFeedback();
              }}
              placeholder="例: サビ前 / 振り返りメモ"
              className="fn-input"
              maxLength={120}
              disabled={busy}
              required
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="chapter-comment-note" className={styles.label}>
              補足コメント <span className={styles.optional}>任意</span>
            </label>
            <textarea
              id="chapter-comment-note"
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                clearFeedback();
              }}
              placeholder="コメントや補足を入力"
              className="fn-input"
              rows={3}
              maxLength={1000}
              disabled={busy}
            />
            <span className={styles.characterCount}>{note.length} / 1000</span>
          </div>

          <fieldset className={styles.visibilityFieldset} disabled={busy}>
            <legend className={styles.label}>公開範囲</legend>
            <div className={styles.visibilityOptions}>
              <label
                className={
                  visibility === "public"
                    ? styles.visibilityOptionActive
                    : styles.visibilityOption
                }
              >
                <input
                  type="radio"
                  name="chapter_visibility"
                  value="public"
                  checked={visibility === "public"}
                  onChange={() => {
                    setVisibility("public");
                    clearFeedback();
                  }}
                />
                <span>
                  <strong>公開</strong>
                  <small>この作品を見られる全員に表示します</small>
                </span>
              </label>
              <label
                className={
                  visibility === "private"
                    ? styles.visibilityOptionActive
                    : styles.visibilityOption
                }
              >
                <input
                  type="radio"
                  name="chapter_visibility"
                  value="private"
                  checked={visibility === "private"}
                  onChange={() => {
                    setVisibility("private");
                    clearFeedback();
                  }}
                />
                <span>
                  <strong>非公開</strong>
                  <small>自分と作品管理者だけに表示します</small>
                </span>
              </label>
            </div>
          </fieldset>

          {contextError ? (
            <div className={styles.contextWarning} role="alert">
              <span>
                <Icon name="info" size={12} aria-hidden /> {contextError}
              </span>
              <button
                type="button"
                className="fn-btn fn-btn-ghost fn-btn-sm"
                onClick={loadContext}
                disabled={contextLoading}
              >
                <Icon name="refresh" size={11} aria-hidden />
                再取得
              </button>
            </div>
          ) : null}

          {error ? (
            <p className={styles.submitError} role="alert">
              <Icon name="warning" size={12} aria-hidden /> {error}
            </p>
          ) : null}

          {success ? (
            <p className={styles.submitSuccess} role="status" aria-live="polite">
              <Icon name="check" size={12} aria-hidden /> {success}
            </p>
          ) : null}

          <button
            type="submit"
            className={`fn-btn fn-btn-primary fn-btn-sm ${styles.submitButton}`}
            disabled={submitDisabled}
          >
            <Icon name="plus" size={11} aria-hidden />
            {busy ? "送信中…" : contextLoading ? "動画時間を確認中…" : "投稿"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
