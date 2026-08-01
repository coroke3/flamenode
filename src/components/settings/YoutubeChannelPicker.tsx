"use client";

import * as React from "react";
import styles from "./YoutubeChannelPicker.module.css";
import dialogStyles from "@/components/ui/ConfirmDialog.module.css";
import { Icon } from "@/components/ui/Icon";
import {
  formatYoutubeChannelLabel,
  normalizeYoutubeChannelInput,
} from "@/lib/utils/youtubeChannel";

export function YoutubeChannelPicker({
  name = "youtube_channel_url",
  defaultValue,
  candidates,
  disabled = false,
  onValueChange,
}: {
  name?: string;
  defaultValue: string | null;
  candidates: string[];
  disabled?: boolean;
  onValueChange?: (url: string) => void;
}): React.ReactElement {
  const [value, setValue] = React.useState(defaultValue ?? "");
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"select" | "custom">(
    candidates.length > 0 ? "select" : "custom",
  );
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValue(defaultValue ?? "");
  }, [defaultValue]);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const openModal = () => {
    setError(null);
    setDraft(value);
    setMode(candidates.length > 0 ? "select" : "custom");
    setOpen(true);
  };

  const applyUrl = (next: string) => {
    setValue(next);
    onValueChange?.(next);
    setError(null);
    setOpen(false);
  };

  const applyCustom = () => {
    const raw = draft.trim();
    if (!raw) {
      applyUrl("");
      return;
    }
    const normalized = normalizeYoutubeChannelInput(raw);
    if (!normalized) {
      setError(
        "有効な URL を入力してください (例: https://www.youtube.com/@handle)",
      );
      return;
    }
    applyUrl(normalized);
  };

  const display = value.trim();

  return (
    <div className={styles.root}>
      <input type="hidden" name={name} value={value} />
      <div className={styles.summary}>
        {display ? (
          <a
            href={display}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.currentLink}
          >
            <Icon name="youtube" size={14} aria-hidden />
            <span className={styles.currentLabel}>
              {formatYoutubeChannelLabel(display)}
            </span>
            <Icon name="external" size={11} aria-hidden />
          </a>
        ) : (
          <span className={styles.emptyLabel}>未設定</span>
        )}
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          onClick={openModal}
          disabled={disabled}
        >
          <Icon name="edit" size={12} aria-hidden />
          {display ? "変更" : "設定"}
        </button>
        {display ? (
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={() => applyUrl("")}
            disabled={disabled}
          >
            解除
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          className={dialogStyles.backdrop}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className={`${dialogStyles.dialog} ${styles.dialog}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="youtube-channel-picker-title"
          >
            <div className={dialogStyles.body}>
              <p id="youtube-channel-picker-title" className={dialogStyles.title}>
                YouTube チャンネル
              </p>
              <p className={dialogStyles.message}>
                候補から選ぶか、チャンネル URL を直接入力してください。
              </p>

              <div className={styles.modeSwitch} role="tablist" aria-label="設定方法">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "select"}
                  className={`${styles.modeButton} ${mode === "select" ? styles.modeButtonActive : ""}`}
                  onClick={() => setMode("select")}
                  disabled={candidates.length === 0}
                >
                  候補から選ぶ
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "custom"}
                  className={`${styles.modeButton} ${mode === "custom" ? styles.modeButtonActive : ""}`}
                  onClick={() => setMode("custom")}
                >
                  URLを入力
                </button>
              </div>

              {mode === "select" ? (
                <ul className={styles.candidateList}>
                  {candidates.length === 0 ? (
                    <li className={styles.candidateEmpty}>
                      この X ID の過去作品に登録されたチャンネルがありません。「URLを入力」から設定できます。
                    </li>
                  ) : (
                    candidates.map((url) => (
                      <li key={url}>
                        <button
                          type="button"
                          className={`${styles.candidateButton} ${url === value ? styles.candidateButtonActive : ""}`}
                          onClick={() => applyUrl(url)}
                        >
                          <Icon
                            name="youtube"
                            size={14}
                            aria-hidden
                            className={styles.candidateLeadIcon}
                          />
                          <span className={styles.candidateLabel}>
                            {formatYoutubeChannelLabel(url)}
                          </span>
                          <span className={styles.candidateUrl}>{url}</span>
                          {url === value ? (
                            <Icon
                              name="check"
                              size={14}
                              aria-hidden
                              className={styles.candidateCheck}
                            />
                          ) : null}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : (
                <div className={styles.customPanel}>
                  <label className={styles.customLabel} htmlFor="youtube-channel-custom">
                    チャンネル URL
                  </label>
                  <input
                    id="youtube-channel-custom"
                    type="url"
                    className={styles.customInput}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.currentTarget.value);
                      setError(null);
                    }}
                    placeholder="https://www.youtube.com/@..."
                    autoComplete="off"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyCustom();
                      }
                    }}
                  />
                  {error ? <p className={styles.error}>{error}</p> : null}
                  <div className={styles.customActions}>
                    <button
                      type="button"
                      className="fn-btn fn-btn-primary fn-btn-sm"
                      onClick={applyCustom}
                    >
                      適用
                    </button>
                    <button
                      type="button"
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                      onClick={() => applyUrl("")}
                    >
                      未設定にする
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className={dialogStyles.footer}>
              <button
                type="button"
                className="fn-btn fn-btn-ghost fn-btn-sm"
                onClick={() => setOpen(false)}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
