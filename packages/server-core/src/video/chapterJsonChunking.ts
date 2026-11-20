/**
 * MIG-0650 SA-085 U03d-2a: JSON1 bind-size chunking shared by CURRENT Next
 * and future Hono member write planning. Pure utility; no database access.
 * Exact implementation transferred from src/lib/video/replaceVideoMembers.ts.
 */
/** Keep each individual JSON1 bind well below D1's 2 MB string/bind ceiling. */
export const VIDEO_CHAPTER_JSON_MAX_BYTES = 1_000_000;
/** One compound statement must also stay below D1's 100-bound-parameter limit. */
export const VIDEO_CHAPTER_JSON_MAX_BINDS = 90;
const JSON_ENCODER = new TextEncoder();

export function jsonUtf8ByteLength(value: unknown): number {
  return JSON_ENCODER.encode(JSON.stringify(value)).byteLength;
}

export function chunkRowsByJsonByteSize<T>(
  rows: readonly T[],
  maxBytes = VIDEO_CHAPTER_JSON_MAX_BYTES,
): T[][] {
  if (!Number.isInteger(maxBytes) || maxBytes < 256) {
    throw new Error("video_chapter_json_chunk_limit_invalid");
  }
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBytes = 2;
  for (const row of rows) {
    const rowBytes = jsonUtf8ByteLength(row);
    const nextBytes = currentBytes + (current.length > 0 ? 1 : 0) + rowBytes;
    if (rowBytes + 2 > maxBytes) {
      throw new Error("video_chapter_json_row_too_large");
    }
    if (current.length > 0 && nextBytes > maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(row);
    currentBytes += (current.length > 1 ? 1 : 0) + rowBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

