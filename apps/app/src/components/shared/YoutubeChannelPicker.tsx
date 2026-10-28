// Port of CURRENT src/components/settings/YoutubeChannelPicker.tsx (MIG-0712, shared D-16-4). Same output.
import * as React from "react";
import { Icon } from "../../routes/ui/Icon.js";
import {
  formatYoutubeChannelLabel,
  normalizeYoutubeChannelInput,
} from "../../lib/youtubeChannel.js";

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
    <div className={"ychan-root"}>
      <input type="hidden" name={name} value={value} />
      <div className={"ychan-summary"}>
        {display ? (
          <a
            href={display}
            target="_blank"
            rel="noopener noreferrer"
            className={"ychan-currentLink"}
          >
            <Icon name="youtube" size={14} aria-hidden />
            <span className={"ychan-currentLabel"}>
              {formatYoutubeChannelLabel(display)}
            </span>
            <Icon name="external" size={11} aria-hidden />
          </a>
        ) : (
          <span className={"ychan-emptyLabel"}>未設定</span>
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
          className={"cdlg-backdrop"}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className={`cdlg-dialog ychan-dialog`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="youtube-channel-picker-title"
          >
            <div className={"cdlg-body"}>
              <p id="youtube-channel-picker-title" className={"cdlg-title"}>
                YouTube チャンネル
              </p>
              <p className={"cdlg-message"}>
                候補から選ぶか、チャンネル URL を直接入力してください。
              </p>

              <div className={"ychan-modeSwitch"} role="tablist" aria-label="設定方法">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "select"}
                  className={`ychan-modeButton ${mode === "select" ? "ychan-modeButtonActive" : ""}`}
                  onClick={() => setMode("select")}
                  disabled={candidates.length === 0}
                >
                  候補から選ぶ
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "custom"}
                  className={`ychan-modeButton ${mode === "custom" ? "ychan-modeButtonActive" : ""}`}
                  onClick={() => setMode("custom")}
                >
                  URLを入力
                </button>
              </div>

              {mode === "select" ? (
                <ul className={"ychan-candidateList"}>
                  {candidates.length === 0 ? (
                    <li className={"ychan-candidateEmpty"}>
                      この X ID の過去作品に登録されたチャンネルがありません。「URLを入力」から設定できます。
                    </li>
                  ) : (
                    candidates.map((url) => (
                      <li key={url}>
                        <button
                          type="button"
                          className={`ychan-candidateButton ${url === value ? "ychan-candidateButtonActive" : ""}`}
                          onClick={() => applyUrl(url)}
                        >
                          <Icon
                            name="youtube"
                            size={14}
                            aria-hidden
                            className={"ychan-candidateLeadIcon"}
                          />
                          <span className={"ychan-candidateLabel"}>
                            {formatYoutubeChannelLabel(url)}
                          </span>
                          <span className={"ychan-candidateUrl"}>{url}</span>
                          {url === value ? (
                            <Icon
                              name="check"
                              size={14}
                              aria-hidden
                              className={"ychan-candidateCheck"}
                            />
                          ) : null}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : (
                <div className={"ychan-customPanel"}>
                  <label className={"ychan-customLabel"} htmlFor="youtube-channel-custom">
                    チャンネル URL
                  </label>
                  <input
                    id="youtube-channel-custom"
                    type="url"
                    className={"ychan-customInput"}
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
                  {error ? <p className={"ychan-error"}>{error}</p> : null}
                  <div className={"ychan-customActions"}>
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
            <div className={"cdlg-footer"}>
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
