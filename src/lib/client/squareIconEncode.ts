const OUTPUT_SIZE = 256;
const WEBP_QUALITY = 0.88;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PIXEL_COUNT = 50_000_000;

const ACCEPTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ACCEPTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const REJECTED_MIME_TYPES = new Set(["image/gif"]);

export type SquareIconTransform = {
  offsetX: number;
  offsetY: number;
  scale: number;
};

export type IconPreviewFailure = Error & { code: "ICON_PREVIEW_FAILED" };

export function createIconPreviewError(message = "ICON_PREVIEW_FAILED"): IconPreviewFailure {
  const err = new Error(message) as IconPreviewFailure;
  err.code = "ICON_PREVIEW_FAILED";
  return err;
}

export function isIconPreviewError(error: unknown): error is IconPreviewFailure {
  return (
    error instanceof Error &&
    (error as IconPreviewFailure).code === "ICON_PREVIEW_FAILED"
  );
}

export function isValidBitmap(bitmap: ImageBitmap | { width: number; height: number }): boolean {
  return (
    Number.isFinite(bitmap.width) &&
    Number.isFinite(bitmap.height) &&
    bitmap.width > 0 &&
    bitmap.height > 0
  );
}

export function sanitizeTransform(
  transform: SquareIconTransform,
  minScale = 1,
  maxScale = 3,
): SquareIconTransform {
  const scale = Number.isFinite(transform.scale)
    ? Math.min(maxScale, Math.max(minScale, transform.scale))
    : minScale;
  const offsetX = Number.isFinite(transform.offsetX) ? transform.offsetX : 0;
  const offsetY = Number.isFinite(transform.offsetY) ? transform.offsetY : 0;
  return { offsetX, offsetY, scale };
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw createIconPreviewError(`ICON_PREVIEW_FAILED: invalid ${label}`);
  }
}

function getFileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export function validateIconImageFile(file: File): void {
  if (!(file instanceof File) || file.size <= 0) {
    throw new Error("画像ファイルが無効です。");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("ファイルサイズは 2MB までです。");
  }
  let mime = file.type.toLowerCase();
  if (mime === "image/jpg") mime = "image/jpeg";
  if (ACCEPTED_MIME_TYPES.has(mime)) return;
  if (REJECTED_MIME_TYPES.has(mime)) {
    throw new Error("PNG・JPEG・WEBP 形式の画像を選んでください。");
  }
  if (mime && !mime.startsWith("image/") && mime !== "application/octet-stream") {
    throw new Error("PNG・JPEG・WEBP 形式の画像を選んでください。");
  }
  const ext = getFileExtension(file.name);
  if (!ACCEPTED_EXTENSIONS.has(ext)) {
    throw new Error("PNG・JPEG・WEBP 形式の画像を選んでください。");
  }
}

function assertValidDecodedBitmap(bitmap: ImageBitmap): void {
  if (!isValidBitmap(bitmap)) {
    bitmap.close();
    throw createIconPreviewError("ICON_PREVIEW_FAILED: invalid bitmap dimensions");
  }
  const pixels = bitmap.width * bitmap.height;
  if (!Number.isFinite(pixels) || pixels > MAX_PIXEL_COUNT) {
    bitmap.close();
    throw createIconPreviewError("ICON_PREVIEW_FAILED: image too large");
  }
}

export async function loadOrientedImageBitmap(file: File): Promise<ImageBitmap> {
  validateIconImageFile(file);

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      assertValidDecodedBitmap(bitmap);
      return bitmap;
    } catch (error) {
      if (isIconPreviewError(error)) throw error;
      // Safari 等で orientation オプション非対応の場合は通常読み込みへフォールバック
    }
  }
  return loadImageBitmapViaElement(file);
}

async function loadImageBitmapViaElement(file: File): Promise<ImageBitmap> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("画像の読み込みに失敗しました。"));
      el.src = url;
    });
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(img);
      assertValidDecodedBitmap(bitmap);
      return bitmap;
    }
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas が利用できません。");
    ctx.drawImage(img, 0, 0);
    const bitmap = await createImageBitmap(canvas);
    assertValidDecodedBitmap(bitmap);
    return bitmap;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function getCoverBaseScale(
  imageWidth: number,
  imageHeight: number,
  viewportSize: number,
): number {
  assertFinitePositive(imageWidth, "image width");
  assertFinitePositive(imageHeight, "image height");
  assertFinitePositive(viewportSize, "viewport size");
  return Math.max(viewportSize / imageWidth, viewportSize / imageHeight);
}

export function drawSquareIconPreview(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap | { width: number; height: number },
  viewportSize: number,
  transform: SquareIconTransform,
): void {
  if (!Number.isFinite(viewportSize) || viewportSize <= 0) {
    throw createIconPreviewError("ICON_PREVIEW_FAILED: invalid viewport");
  }
  if (!isValidBitmap(bitmap)) {
    throw createIconPreviewError("ICON_PREVIEW_FAILED: invalid bitmap");
  }

  const safe = sanitizeTransform(transform);
  ctx.clearRect(0, 0, viewportSize, viewportSize);

  const baseScale = getCoverBaseScale(bitmap.width, bitmap.height, viewportSize);
  const drawScale = baseScale * safe.scale;
  const drawWidth = bitmap.width * drawScale;
  const drawHeight = bitmap.height * drawScale;
  const x = (viewportSize - drawWidth) / 2 + safe.offsetX;
  const y = (viewportSize - drawHeight) / 2 + safe.offsetY;

  if (
    !Number.isFinite(drawWidth) ||
    !Number.isFinite(drawHeight) ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    drawWidth <= 0 ||
    drawHeight <= 0
  ) {
    throw createIconPreviewError("ICON_PREVIEW_FAILED: invalid draw dimensions");
  }

  try {
    ctx.drawImage(bitmap as CanvasImageSource, x, y, drawWidth, drawHeight);
  } catch {
    throw createIconPreviewError("ICON_PREVIEW_FAILED: drawImage failed");
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

export async function encodeSquareIconFile(
  bitmap: ImageBitmap,
  viewportSize: number,
  transform: SquareIconTransform,
  originalName: string,
): Promise<File> {
  if (!isValidBitmap(bitmap)) {
    throw createIconPreviewError("ICON_PREVIEW_FAILED: invalid bitmap");
  }
  assertFinitePositive(viewportSize, "viewport size");

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas が利用できません。");

  const scaleFactor = OUTPUT_SIZE / viewportSize;
  const safe = sanitizeTransform(transform);
  try {
    drawSquareIconPreview(ctx, bitmap, OUTPUT_SIZE, {
      offsetX: safe.offsetX * scaleFactor,
      offsetY: safe.offsetY * scaleFactor,
      scale: safe.scale,
    });
  } catch (error) {
    if (isIconPreviewError(error)) throw error;
    throw createIconPreviewError("ICON_PREVIEW_FAILED: encode draw failed");
  }

  if (canvas.width !== OUTPUT_SIZE || canvas.height !== OUTPUT_SIZE) {
    throw createIconPreviewError("ICON_PREVIEW_FAILED: invalid canvas size");
  }

  let blob = await canvasToBlob(canvas, "image/webp", WEBP_QUALITY);
  if (!blob || blob.size === 0 || blob.type !== "image/webp") {
    blob = await canvasToBlob(canvas, "image/png");
  }
  if (!blob || blob.size === 0) throw new Error("画像の変換に失敗しました。");
  const mime = blob.type === "image/webp" ? "image/webp" : "image/png";
  const ext = mime === "image/webp" ? "webp" : "png";

  const baseName = originalName.replace(/\.[^.]+$/, "") || "icon";
  return new File([blob], `${baseName}.${ext}`, { type: mime, lastModified: Date.now() });
}

export const SQUARE_ICON_OUTPUT_SIZE = OUTPUT_SIZE;
