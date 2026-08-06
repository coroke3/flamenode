export type SupportedImageUpload = {
  contentType: "image/png" | "image/jpeg" | "image/webp";
  ext: "png" | "jpg" | "webp";
};

export type ValidatedImageUpload = SupportedImageUpload & {
  width: number;
  height: number;
  animated: boolean;
};

const DEFAULT_ICON_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_ICON_MIN_DIMENSION = 64;
const DEFAULT_ICON_MAX_DIMENSION = 2048;

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readFourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function isValidDimension(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 0x7fff_ffff;
}

function parsePng(bytes: Uint8Array): { width: number; height: number; animated: boolean } | null {
  if (bytes.length < 33) return null;
  if (readUint32BE(bytes, 8) !== 13 || readFourCC(bytes, 12) !== "IHDR") return null;

  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  if (!isValidDimension(width) || !isValidDimension(height)) return null;

  let animated = false;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const chunkLength = readUint32BE(bytes, offset);
    const chunkType = readFourCC(bytes, offset + 4);
    if (chunkType === "acTL") {
      animated = true;
      break;
    }
    if (chunkType === "IEND") break;
    const chunkTotal = 12 + chunkLength;
    if (chunkLength < 0 || chunkTotal <= 0 || offset + chunkTotal > bytes.length) break;
    offset += chunkTotal;
  }

  return { width, height, animated };
}

function isJpegSofMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function parseJpeg(bytes: Uint8Array): { width: number; height: number; animated: boolean } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    if (marker === 0xd9) break;
    if (marker === 0x00) {
      offset += 2;
      continue;
    }

    if (isJpegSofMarker(marker)) {
      if (offset + 9 >= bytes.length) return null;
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      if (!isValidDimension(width) || !isValidDimension(height)) return null;
      return { width, height, animated: false };
    }

    if (offset + 3 >= bytes.length) break;
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }

  return null;
}

function parseVp8Dimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 10) return null;
  if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) {
    return null;
  }
  const width = ((data[7] << 8) | data[6]) & 0x3fff;
  const height = ((data[9] << 8) | data[8]) & 0x3fff;
  if (!isValidDimension(width) || !isValidDimension(height)) return null;
  return { width, height };
}

function parseVp8lDimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 5 || data[0] !== 0x2f) return null;
  const bits = data[1] | (data[2] << 8) | (data[3] << 16) | (data[4] << 24);
  const width = (bits & 0x3fff) + 1;
  const height = ((bits >> 14) & 0x3fff) + 1;
  if (!isValidDimension(width) || !isValidDimension(height)) return null;
  return { width, height };
}

function parseWebp(bytes: Uint8Array): { width: number; height: number; animated: boolean } | null {
  if (bytes.length < 12) return null;
  if (readFourCC(bytes, 0) !== "RIFF" || readFourCC(bytes, 8) !== "WEBP") return null;
  const riffSize = readUint32LE(bytes, 4);
  const expectedLength = 8 + riffSize;
  if (expectedLength < 12 || bytes.length !== expectedLength) return null;

  let offset = 12;
  let animated = false;
  let width: number | null = null;
  let height: number | null = null;

  while (offset + 8 <= bytes.length) {
    const chunkType = readFourCC(bytes, offset);
    const chunkSize = readUint32LE(bytes, offset + 4);
    const dataStart = offset + 8;
    if (chunkSize > bytes.length - dataStart) return null;
    const chunkData = bytes.subarray(dataStart, dataStart + chunkSize);

    if (chunkType === "VP8X") {
      if (chunkSize < 10) return null;
      if ((chunkData[0] & 0x02) !== 0) animated = true;
      if (width === null || height === null) {
        const canvasWidth =
          1 +
          (chunkData[4] | (chunkData[5] << 8) | (chunkData[6] << 16));
        const canvasHeight =
          1 +
          (chunkData[7] | (chunkData[8] << 8) | (chunkData[9] << 16));
        if (!isValidDimension(canvasWidth) || !isValidDimension(canvasHeight)) return null;
        width = canvasWidth;
        height = canvasHeight;
      }
    } else if (chunkType === "ANIM") {
      animated = true;
    } else if (chunkType === "VP8 ") {
      const dimensions = parseVp8Dimensions(chunkData);
      if (!dimensions) return null;
      width = dimensions.width;
      height = dimensions.height;
    } else if (chunkType === "VP8L") {
      const dimensions = parseVp8lDimensions(chunkData);
      if (!dimensions) return null;
      width = dimensions.width;
      height = dimensions.height;
    }

    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (width === null || height === null) return null;
  return { width, height, animated };
}

export function detectImageFormat(bytes: Uint8Array): ValidatedImageUpload["contentType"] | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function extForContentType(
  contentType: ValidatedImageUpload["contentType"],
): ValidatedImageUpload["ext"] {
  return contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "webp";
}

function parseImageContent(
  bytes: Uint8Array,
  contentType: ValidatedImageUpload["contentType"],
): { width: number; height: number; animated: boolean } | null {
  return contentType === "image/png"
    ? parsePng(bytes)
    : contentType === "image/jpeg"
      ? parseJpeg(bytes)
      : parseWebp(bytes);
}

export function inspectSupportedImageUpload(buffer: ArrayBuffer): ValidatedImageUpload | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) return null;

  const contentType = detectImageFormat(bytes);
  if (!contentType) return null;

  const parsed = parseImageContent(bytes, contentType);
  if (!parsed) return null;

  return {
    contentType,
    ext: extForContentType(contentType),
    width: parsed.width,
    height: parsed.height,
    animated: parsed.animated,
  };
}

export function detectSupportedImageUpload(buffer: ArrayBuffer): SupportedImageUpload | null {
  const image = inspectSupportedImageUpload(buffer);
  if (!image) return null;
  return {
    contentType: image.contentType,
    ext: image.ext,
  };
}

function normalizeDeclaredContentType(
  declaredType: string | null | undefined,
): ValidatedImageUpload["contentType"] | null {
  const normalized = declaredType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (normalized === "image/png" || normalized === "image/jpeg" || normalized === "image/webp") {
    return normalized;
  }
  return null;
}

export function validateIconImageUpload(args: {
  buffer: ArrayBuffer;
  declaredType?: string | null;
  maxBytes?: number;
  minDimension?: number;
  maxDimension?: number;
}): { ok: true; image: ValidatedImageUpload } | { ok: false; message: string } {
  const maxBytes = args.maxBytes ?? DEFAULT_ICON_MAX_BYTES;
  const minDimension = args.minDimension ?? DEFAULT_ICON_MIN_DIMENSION;
  const maxDimension = args.maxDimension ?? DEFAULT_ICON_MAX_DIMENSION;
  const byteLength = args.buffer.byteLength;

  if (byteLength === 0) {
    return { ok: false, message: "空の画像ファイルです。" };
  }
  if (byteLength > maxBytes) {
    return { ok: false, message: "変換後の画像サイズが2MBを超えています。" };
  }

  const bytes = new Uint8Array(args.buffer);
  const contentType = detectImageFormat(bytes);
  if (!contentType) {
    return { ok: false, message: "PNG・JPEG・WEBP画像を選んでください。" };
  }

  const parsed = parseImageContent(bytes, contentType);
  if (!parsed) {
    return { ok: false, message: "画像を読み取れませんでした。別の画像を選んでください。" };
  }

  const image: ValidatedImageUpload = {
    contentType,
    ext: extForContentType(contentType),
    width: parsed.width,
    height: parsed.height,
    animated: parsed.animated,
  };

  const normalizedDeclared = normalizeDeclaredContentType(args.declaredType);
  if (normalizedDeclared && normalizedDeclared !== image.contentType) {
    return { ok: false, message: "画像の変換に失敗しました。画像を選び直してください。" };
  }

  if (image.width < minDimension || image.height < minDimension) {
    return { ok: false, message: `${minDimension}px 以上の画像を選んでください。` };
  }
  if (image.width > maxDimension || image.height > maxDimension) {
    return { ok: false, message: `${maxDimension}px 以下の画像を選んでください。` };
  }
  if (image.animated) {
    return { ok: false, message: "アニメーション画像はアップロードできません。" };
  }

  return { ok: true, image };
}
