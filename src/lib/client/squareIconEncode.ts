const OUTPUT_SIZE = 512;
const WEBP_QUALITY = 0.88;

export type SquareIconTransform = {
  offsetX: number;
  offsetY: number;
  scale: number;
};

export async function loadOrientedImageBitmap(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
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
      return await createImageBitmap(img);
    }
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas が利用できません。");
    ctx.drawImage(img, 0, 0);
    return await createImageBitmap(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function getCoverBaseScale(
  imageWidth: number,
  imageHeight: number,
  viewportSize: number,
): number {
  return Math.max(viewportSize / imageWidth, viewportSize / imageHeight);
}

export function drawSquareIconPreview(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  viewportSize: number,
  transform: SquareIconTransform,
): void {
  ctx.clearRect(0, 0, viewportSize, viewportSize);
  const baseScale = getCoverBaseScale(bitmap.width, bitmap.height, viewportSize);
  const drawScale = baseScale * transform.scale;
  const drawWidth = bitmap.width * drawScale;
  const drawHeight = bitmap.height * drawScale;
  const x = (viewportSize - drawWidth) / 2 + transform.offsetX;
  const y = (viewportSize - drawHeight) / 2 + transform.offsetY;
  ctx.drawImage(bitmap, x, y, drawWidth, drawHeight);
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
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas が利用できません。");

  const scaleFactor = OUTPUT_SIZE / viewportSize;
  drawSquareIconPreview(ctx, bitmap, OUTPUT_SIZE, {
    offsetX: transform.offsetX * scaleFactor,
    offsetY: transform.offsetY * scaleFactor,
    scale: transform.scale,
  });

  let blob = await canvasToBlob(canvas, "image/webp", WEBP_QUALITY);
  let ext = "webp";
  let mime = "image/webp";
  if (!blob) {
    blob = await canvasToBlob(canvas, "image/png");
    ext = "png";
    mime = "image/png";
  }
  if (!blob) throw new Error("画像の変換に失敗しました。");

  const baseName = originalName.replace(/\.[^.]+$/, "") || "icon";
  return new File([blob], `${baseName}.${ext}`, { type: mime, lastModified: Date.now() });
}

export const SQUARE_ICON_OUTPUT_SIZE = OUTPUT_SIZE;
