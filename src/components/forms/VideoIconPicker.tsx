"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { SquareIconEditor } from "@/components/media/SquareIconEditor";
import type { VideoIconMode } from "@/lib/video/videoFormSchema";

/**
 * 作品ごとアイコンの選択コンポーネント。
 *
 * ファイル選択時はローカルプレビューのみ。R2/DB への書き込みは作品保存時に行う。
 * 出力: `icon_mode`, `icon_url`, `icon_file`（upload 時のみ）。
 */
export interface VideoIconPickerProps {
  candidates: string[];
  initialIconUrl?: string | null;
  disabled?: boolean;
  /** 編集フォームでは未変更時 `keep` を送る。 */
  isEdit?: boolean;
}

export function VideoIconPicker({
  candidates,
  initialIconUrl,
  disabled,
  isEdit = false,
}: VideoIconPickerProps): React.ReactElement {
  const initialUrl = initialIconUrl ?? "";
  const [iconMode, setIconMode] = React.useState<VideoIconMode>(
    isEdit ? "keep" : initialUrl ? "existing" : "none",
  );
  const [selectedUrl, setSelectedUrl] = React.useState(initialUrl);
  const [tab, setTab] = React.useState<"select" | "upload">("select");
  const [uploadPreview, setUploadPreview] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const clearUploadPreview = React.useCallback(() => {
    setUploadPreview((current) => {
      if (current) window.URL.revokeObjectURL(current);
      return null;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  React.useEffect(() => {
    return () => {
      if (uploadPreview) window.URL.revokeObjectURL(uploadPreview);
    };
  }, [uploadPreview]);

  const resolveModeForUrl = React.useCallback(
    (url: string): VideoIconMode => {
      if (isEdit && url === initialUrl) return "keep";
      if (!url.trim()) return "none";
      return "existing";
    },
    [initialUrl, isEdit],
  );

  const choose = React.useCallback(
    (url: string) => {
      if (disabled) return;
      clearUploadPreview();
      setSelectedUrl(url);
      setIconMode(resolveModeForUrl(url));
      setError(null);
      setTab("select");
    },
    [clearUploadPreview, disabled, resolveModeForUrl],
  );

  const syncFileToNamedInput = React.useCallback((file: File) => {
    const input = fileInputRef.current;
    if (!input) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
  }, []);

  const onUseUploadedImage = React.useCallback(
    async (file: File) => {
      clearUploadPreview();
      setUploadPreview(window.URL.createObjectURL(file));
      setIconMode("upload");
      setSelectedUrl("");
      setError(null);
      syncFileToNamedInput(file);
    },
    [clearUploadPreview, syncFileToNamedInput],
  );

  const cancelUpload = () => {
    clearUploadPreview();
    setError(null);
    if (isEdit) {
      setSelectedUrl(initialUrl);
      setIconMode("keep");
    } else {
      setSelectedUrl(initialUrl);
      setIconMode(initialUrl ? "existing" : "none");
    }
    setTab("select");
  };

  const buttonStyle: React.CSSProperties = {
    position: "relative",
    aspectRatio: "1 / 1",
    minWidth: 0,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border-subtle)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-base)",
    cursor: disabled ? "not-allowed" : "pointer",
    overflow: "hidden",
    padding: 3,
    opacity: disabled ? 0.6 : 1,
  };
  const activeStyle: React.CSSProperties = {
    borderColor: "var(--accent-primary)",
    boxShadow: "0 0 0 2px var(--accent-primary-soft)",
  };
  const thumbStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    borderRadius: 4,
    display: "block",
  };
  const checkMarkStyle: React.CSSProperties = {
    position: "absolute",
    top: 2,
    right: 2,
    background: "var(--accent-primary)",
    color: "var(--bg-surface)",
    borderRadius: 999,
    width: 16,
    height: 16,
    display: "grid",
    placeItems: "center",
  };

  const modeBtnStyle = (active: boolean): React.CSSProperties => ({
    border: 0,
    borderRadius: "calc(var(--radius-sm) - 2px)",
    background: active ? "var(--bg-surface)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
    fontWeight: 700,
    minHeight: 30,
    padding: "0 10px",
    boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : undefined,
  });

  const selectedCandidate =
    iconMode === "keep" || iconMode === "existing" ? selectedUrl : "";
  const showNoneSelected = iconMode === "none";

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <input type="hidden" name="icon_mode" value={iconMode} />
      <input
        type="hidden"
        name="icon_url"
        value={iconMode === "existing" ? selectedUrl : ""}
      />
      <input
        ref={fileInputRef}
        type="file"
        name={iconMode === "upload" ? "icon_file" : undefined}
        accept="image/png,image/jpeg,image/webp"
        style={{ display: "none" }}
        disabled={disabled || iconMode !== "upload"}
      />
      <div
        role="tablist"
        aria-label="作品アイコンの設定方法"
        style={{
          display: "inline-flex",
          width: "fit-content",
          maxWidth: "100%",
          padding: 3,
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-elevated)",
          gap: 3,
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "select"}
          disabled={disabled}
          onClick={() => setTab("select")}
          style={modeBtnStyle(tab === "select")}
        >
          候補から選ぶ
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "upload"}
          disabled={disabled}
          onClick={() => setTab("upload")}
          style={modeBtnStyle(tab === "upload")}
        >
          新規アップロード
        </button>
      </div>
      {tab === "upload" ? (
        <div style={{ display: "grid", gap: 10 }}>
          <SquareIconEditor
            disabled={disabled}
            onUseImage={onUseUploadedImage}
            onCancel={cancelUpload}
          />
          {uploadPreview ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: "var(--radius-sm)",
                  overflow: "hidden",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={uploadPreview} alt="" style={thumbStyle} />
              </div>
              <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
                フォーム送信時にアップロードされます。
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
      {tab === "select" && candidates.length > 0 ? (
        <div
          role="radiogroup"
          aria-label="アイコン候補"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(58px, 1fr))",
            gap: 8,
            maxWidth: 520,
          }}
        >
          {candidates.map((url) => {
            const active = url === selectedCandidate;
            return (
              <button
                key={url}
                type="button"
                onClick={() => choose(url)}
                aria-pressed={active}
                aria-label="このアイコンを選択"
                disabled={disabled}
                style={{ ...buttonStyle, ...(active ? activeStyle : {}) }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" style={thumbStyle} />
                {active ? (
                  <span style={checkMarkStyle}>
                    <Icon name="check" size={10} aria-hidden />
                  </span>
                ) : null}
              </button>
            );
          })}
          <button
            key="__none__"
            type="button"
            onClick={() => choose("")}
            aria-pressed={showNoneSelected}
            aria-label="アイコンを指定しない"
            disabled={disabled}
            title="アイコンを指定しない"
            style={{
              ...buttonStyle,
              ...(showNoneSelected ? activeStyle : {}),
              color: "var(--text-muted)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <Icon name="close" size={16} aria-hidden />
          </button>
        </div>
      ) : tab === "select" ? (
        <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
          まだ候補がありません。「新規アップロード」か下の URL 欄から指定できます。
        </p>
      ) : null}
      {tab === "select" ? (
        <input
          type="text"
          value={selectedUrl}
          onChange={(e) => {
            if (disabled) return;
            const next = e.target.value;
            setSelectedUrl(next);
            setIconMode(resolveModeForUrl(next));
            clearUploadPreview();
            setError(null);
          }}
          placeholder="アイコン URL を直接入力 (任意)"
          className="fn-input"
          maxLength={500}
          disabled={disabled}
          aria-label="アイコン URL"
        />
      ) : null}
      {error ? (
        <p
          role="alert"
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--accent-danger)",
          }}
        >
          <Icon name="warning" size={11} aria-hidden /> {error}
        </p>
      ) : null}
    </div>
  );
}
