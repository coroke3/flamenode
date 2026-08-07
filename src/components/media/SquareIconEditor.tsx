"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import {
  drawSquareIconPreview,
  encodeSquareIconFile,
  isValidBitmap,
  loadOrientedImageBitmap,
  sanitizeTransform,
  validateIconImageFile,
  type SquareIconTransform,
} from "@/lib/client/squareIconEncode";
import styles from "./SquareIconEditor.module.css";

const VIEWPORT_SIZE = 280;
const MIN_SCALE = 1;
const MAX_SCALE = 3;
const DEFAULT_SCALE = 1;

export type SquareIconUseImageResult = { ok: true } | { ok: false; message: string };

export type SquareIconEditorProps = {
  disabled?: boolean;
  pending?: boolean;
  onUseImage: (file: File) => Promise<SquareIconUseImageResult>;
  onCancel?: () => void;
  accept?: string;
  hint?: string;
};

export function SquareIconEditor({
  disabled = false,
  pending = false,
  onUseImage,
  onCancel,
  accept = "image/png,image/jpeg,image/webp",
  hint = "正方形に切り抜いて 256×256 に変換します / PNG・JPEG・WEBP / 2MB まで",
}: SquareIconEditorProps): React.ReactElement {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const bitmapRef = React.useRef<ImageBitmap | null>(null);
  const mountedRef = React.useRef(true);
  const loadGenerationRef = React.useRef(0);
  const dragRef = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  const [sourceFile, setSourceFile] = React.useState<File | null>(null);
  const [bitmap, setBitmap] = React.useState<ImageBitmap | null>(null);
  const [transform, setTransform] = React.useState<SquareIconTransform>({
    offsetX: 0,
    offsetY: 0,
    scale: DEFAULT_SCALE,
  });
  const [loading, setLoading] = React.useState(false);
  const [encoding, setEncoding] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const busy = disabled || pending || loading || encoding;

  const releaseBitmap = React.useCallback((target: ImageBitmap | null) => {
    target?.close();
  }, []);

  const clearImageState = React.useCallback(() => {
    releaseBitmap(bitmapRef.current);
    bitmapRef.current = null;
    setBitmap(null);
    setSourceFile(null);
    setTransform({ offsetX: 0, offsetY: 0, scale: DEFAULT_SCALE });
    setDragging(false);
    dragRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [releaseBitmap]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadGenerationRef.current += 1;
      releaseBitmap(bitmapRef.current);
      bitmapRef.current = null;
    };
  }, [releaseBitmap]);

  const redraw = React.useCallback(
    (target: ImageBitmap, nextTransform: SquareIconTransform) => {
      if (!isValidBitmap(target)) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      try {
        drawSquareIconPreview(ctx, target, VIEWPORT_SIZE, nextTransform);
      } catch {
        setError("画像のプレビューに失敗しました。画像を選択し直してください。");
      }
    },
    [],
  );

  React.useEffect(() => {
    if (!bitmap || !isValidBitmap(bitmap)) return;
    redraw(bitmap, transform);
  }, [bitmap, transform, redraw]);

  const resetEditor = React.useCallback(() => {
    clearImageState();
    setError(null);
  }, [clearImageState]);

  const onPickFile = async (file: File | null) => {
    if (!file || busy) return;

    try {
      validateIconImageFile(file);
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "画像ファイルが無効です。",
      );
      return;
    }

    const generation = ++loadGenerationRef.current;
    setError(null);
    setLoading(true);
    try {
      const nextBitmap = await loadOrientedImageBitmap(file);
      if (generation !== loadGenerationRef.current) {
        releaseBitmap(nextBitmap);
        return;
      }
      if (!mountedRef.current) {
        releaseBitmap(nextBitmap);
        return;
      }

      const previous = bitmapRef.current;
      bitmapRef.current = nextBitmap;
      setBitmap(nextBitmap);
      setSourceFile(file);
      setTransform({ offsetX: 0, offsetY: 0, scale: DEFAULT_SCALE });
      releaseBitmap(previous);
    } catch (pickError) {
      if (generation !== loadGenerationRef.current || !mountedRef.current) return;
      setError(
        pickError instanceof Error
          ? pickError.message
          : "画像の読み込みに失敗しました。別のファイルをお試しください。",
      );
      clearImageState();
    } finally {
      if (mountedRef.current && generation === loadGenerationRef.current) {
        setLoading(false);
      }
    }
  };

  const onPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (!bitmap || busy) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    dragRef.current = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      baseX: transform.offsetX,
      baseY: transform.offsetY,
    };
    setDragging(true);
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== ev.pointerId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return;
    const offsetX = drag.baseX + (ev.clientX - drag.startX) * scaleX;
    const offsetY = drag.baseY + (ev.clientY - drag.startY) * scaleY;
    setTransform((prev) => sanitizeTransform({ ...prev, offsetX, offsetY }, MIN_SCALE, MAX_SCALE));
  };

  const endDrag = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== ev.pointerId) return;
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) {
      ev.currentTarget.releasePointerCapture(ev.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
  };

  const onKeyDown = (ev: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!bitmap || busy) return;
    const step = ev.shiftKey ? 12 : 4;
    if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      setTransform((prev) => ({ ...prev, offsetX: prev.offsetX - step }));
    } else if (ev.key === "ArrowRight") {
      ev.preventDefault();
      setTransform((prev) => ({ ...prev, offsetX: prev.offsetX + step }));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setTransform((prev) => ({ ...prev, offsetY: prev.offsetY - step }));
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setTransform((prev) => ({ ...prev, offsetY: prev.offsetY + step }));
    }
  };

  const onScaleChange = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const raw = Number(ev.currentTarget.value);
    const nextScale = Number.isFinite(raw)
      ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw))
      : DEFAULT_SCALE;
    setTransform((prev) => sanitizeTransform({ ...prev, scale: nextScale }, MIN_SCALE, MAX_SCALE));
  };

  const onConfirm = async () => {
    if (!bitmap || !sourceFile || busy || encoding || pending || disabled) return;
    setError(null);
    setEncoding(true);
    try {
      const encoded = await encodeSquareIconFile(bitmap, VIEWPORT_SIZE, transform, sourceFile.name);
      const result = await onUseImage(encoded);
      if (!mountedRef.current) return;
      if (!result.ok) {
        setError(result.message || "アップロードに失敗しました。");
        return;
      }
    } catch {
      if (!mountedRef.current) return;
      setError("画像の変換に失敗しました。位置や拡大率を変えて再試行してください。");
    } finally {
      if (mountedRef.current) setEncoding(false);
    }
  };

  const onCancelClick = () => {
    if (busy) return;
    resetEditor();
    onCancel?.();
  };

  if (!bitmap) {
    return (
      <div className={styles.root}>
        <div className={styles.pickRow}>
          <label className="fn-btn fn-btn-ghost fn-btn-sm" style={{ cursor: busy ? "not-allowed" : "pointer" }}>
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              className={styles.fileInputHidden}
              disabled={busy}
              aria-label="アイコン画像を選ぶ"
              onChange={(ev) => {
                void onPickFile(ev.currentTarget.files?.[0] ?? null);
                ev.currentTarget.value = "";
              }}
            />
            <Icon name="upload" size={12} aria-hidden /> {loading ? "読み込み中…" : "画像を選ぶ"}
          </label>
        </div>
        <p className={styles.hint}>{hint}</p>
        <p className={styles.hint} role="status" aria-live="polite">
          {loading ? "画像を読み込んでいます…" : "ファイルを選んでもまだ保存されません。"}
        </p>
        {error ? (
          <p className={styles.statusErr} role="alert">
            <Icon name="warning" size={12} aria-hidden /> {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.editor}>
        <div className={styles.viewportWrap}>
          <canvas
            ref={canvasRef}
            width={VIEWPORT_SIZE}
            height={VIEWPORT_SIZE}
            className={`${styles.viewport} ${dragging ? styles.viewportDragging : ""}`}
            role="img"
            aria-label="アイコンの切り抜きプレビュー。ドラッグまたは矢印キーで位置を調整できます。"
            tabIndex={busy ? -1 : 0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className={styles.controls}>
          <label className={styles.sliderLabel} htmlFor="square-icon-scale">
            <span>縮小</span>
            <span aria-hidden>{Math.round(transform.scale * 100)}%</span>
            <span>拡大</span>
          </label>
          <input
            id="square-icon-scale"
            type="range"
            className={styles.slider}
            min={MIN_SCALE}
            max={MAX_SCALE}
            step={0.01}
            value={transform.scale}
            disabled={busy}
            aria-label="拡大率"
            onChange={onScaleChange}
          />
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className="fn-btn fn-btn-primary fn-btn-sm"
            disabled={busy}
            aria-busy={encoding || pending}
            onClick={() => void onConfirm()}
          >
            {encoding || pending ? "保存中…" : "この画像を使用"}
          </button>
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            disabled={busy}
            onClick={onCancelClick}
          >
            キャンセル
          </button>
          <label className="fn-btn fn-btn-ghost fn-btn-sm" style={{ cursor: busy ? "not-allowed" : "pointer" }}>
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              className={styles.fileInputHidden}
              disabled={busy}
              aria-label="別の画像を選び直す"
              onChange={(ev) => {
                void onPickFile(ev.currentTarget.files?.[0] ?? null);
                ev.currentTarget.value = "";
              }}
            />
            選び直し
          </label>
        </div>
      </div>
      <p className={styles.hint}>{hint}</p>
      <p className={styles.hint} role="status" aria-live="polite">
        {encoding || pending
          ? "画像を処理しています…"
          : "ドラッグで表示位置を調整できます。確定するまで保存されません。"}
      </p>
      {error ? (
        <p className={styles.statusErr} role="alert">
          <Icon name="warning" size={12} aria-hidden /> {error}
        </p>
      ) : null}
    </div>
  );
}
