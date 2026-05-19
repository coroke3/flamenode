"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { uploadVideoIconCandidate } from "@/lib/actions/video";

/**
 * 作品ごとアイコンの選択コンポーネント。
 *
 * ユーザー既定アイコン (`x_users.icon_url`) を変更しない点が `XIdIconPicker` と異なる。
 * 出力は `<input type="hidden" name="icon_url">` のみで、作品保存時に
 * `videos.icon_url` へそのまま入る。空文字なら null として保存される。
 *
 * 候補は server 側で `getXIconCandidates(db, xId)` から取得する。
 * 「アイコンなし」を明示的に選べるよう、最後に空選択ボタンを置く。
 * アップロード成功時は active X ID の候補に追加され、router.refresh() で再取得される。
 */
export interface VideoIconPickerProps {
  candidates: string[];
  initialIconUrl?: string | null;
  disabled?: boolean;
}

export function VideoIconPicker({
  candidates,
  initialIconUrl,
  disabled,
}: VideoIconPickerProps): React.ReactElement {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string>(initialIconUrl ?? "");
  const [mode, setMode] = React.useState<"select" | "upload">("select");
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const choose = React.useCallback(
    (url: string) => {
      if (disabled) return;
      setSelected(url);
    },
    [disabled],
  );

  const onUpload = (file: File | null) => {
    if (!file || disabled) return;
    setError(null);
    setMessage(null);
    const fd = new FormData();
    fd.set("icon_file", file);
    startTransition(async () => {
      const r = await uploadVideoIconCandidate(fd);
      if (!r.ok || !r.iconUrl) {
        setError(r.message ?? "アップロードに失敗しました。");
        return;
      }
      setMessage(r.message ?? "アップロードしました。");
      setSelected(r.iconUrl);
      // 新規候補をサーバー側 getXIconCandidates から再取得する。
      router.refresh();
    });
  };

  const buttonStyle: React.CSSProperties = {
    position: "relative",
    aspectRatio: "1 / 1",
    minWidth: 0,
    border: "1px solid var(--border-subtle)",
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

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <input type="hidden" name="icon_url" value={selected} />
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
          aria-selected={mode === "select"}
          disabled={disabled}
          onClick={() => setMode("select")}
          style={modeBtnStyle(mode === "select")}
        >
          候補から選ぶ
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "upload"}
          disabled={disabled || pending}
          onClick={() => setMode("upload")}
          style={modeBtnStyle(mode === "upload")}
        >
          新規アップロード
        </button>
      </div>
      {mode === "upload" ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
          }}
        >
          <label
            className="fn-btn fn-btn-ghost fn-btn-sm"
            style={{ cursor: disabled || pending ? "not-allowed" : "pointer" }}
          >
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(ev) =>
                onUpload(ev.currentTarget.files?.[0] ?? null)
              }
              style={{ display: "none" }}
              disabled={disabled || pending}
            />
            <Icon name="upload" size={12} aria-hidden /> 画像を選ぶ
          </label>
          <span className="fn-muted fn-text-sm">
            PNG/JPEG/WEBP / 2MB まで / 正方形推奨
          </span>
          {pending ? (
            <span className="fn-muted fn-text-sm">アップロード中…</span>
          ) : null}
        </div>
      ) : null}
      {mode === "select" && candidates.length > 0 ? (
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
            const active = url === selected;
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
            aria-pressed={selected === ""}
            aria-label="アイコンを指定しない"
            disabled={disabled}
            title="アイコンを指定しない"
            style={{
              ...buttonStyle,
              ...(selected === "" ? activeStyle : {}),
              color: "var(--text-muted)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <Icon name="close" size={16} aria-hidden />
          </button>
        </div>
      ) : mode === "select" ? (
        <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
          まだ候補がありません。「新規アップロード」か下の URL 欄から指定できます。
        </p>
      ) : null}
      <input
        type="text"
        value={selected}
        onChange={(e) => !disabled && setSelected(e.target.value)}
        placeholder="アイコン URL を直接入力 (任意)"
        className="fn-input"
        maxLength={500}
        disabled={disabled}
        aria-label="アイコン URL"
      />
      {message ? (
        <p className="fn-muted fn-text-sm" role="status" style={{ margin: 0 }}>
          <Icon name="check" size={11} aria-hidden /> {message}
        </p>
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
