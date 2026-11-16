/**
 * MIG-0650 U03d-2c: exact CURRENT SA-085 member-managed chapter JSON1 bulk
 * SQL planners, independent of Next.js. D1 statement execution, CAS and audit
 * are still owned by the authenticated caller and remain unchanged.
 * D-10 compatibility bridge: src/lib/video/replaceVideoMembers.ts.
 */
import { sql } from "drizzle-orm";
import { videoChapters } from "@flamenode/db/schema";
import {
  chunkRowsByJsonByteSize,
  jsonUtf8ByteLength,
  VIDEO_CHAPTER_JSON_MAX_BINDS,
} from "./chapterJsonChunking.ts";

type ChapterBulkStatement = {
  statement: ReturnType<typeof sql>;
  rowCount: number;
  payloadBytes: number;
};

function buildChunkValueUnion(chunks: readonly unknown[][]) {
  if (chunks.length === 0) throw new Error("video_chapter_json_chunk_empty");
  if (chunks.length > VIDEO_CHAPTER_JSON_MAX_BINDS) {
    throw new Error("video_chapter_json_bind_limit_exceeded");
  }
  const payloads = chunks.map((chunk) => JSON.stringify(chunk));
  return {
    source: sql.join(
      payloads.map(
        (payload) => sql`SELECT value FROM json_each(${payload})`,
      ),
      sql` UNION ALL `,
    ),
    maxPayloadBytes: Math.max(
      ...chunks.map((chunk) => jsonUtf8ByteLength(chunk)),
    ),
  };
}

export function buildVideoChapterBulkDeleteSql(
  videoId: string,
  rows: readonly (typeof videoChapters.$inferSelect)[],
): ChapterBulkStatement[] {
  if (rows.length === 0) throw new Error("video_chapter_bulk_delete_empty");
  const chunks = chunkRowsByJsonByteSize(rows.map((row) => row.id));
  const { source, maxPayloadBytes } = buildChunkValueUnion(chunks);
  return [
    {
      statement: sql`
        DELETE FROM video_chapters
        WHERE video_id = ${videoId}
          AND id IN (
            SELECT CAST(chapter_ids.value AS TEXT)
            FROM (${source}) AS chapter_ids
          )
      `,
      rowCount: rows.length,
      payloadBytes: maxPayloadBytes,
    },
  ];
}

export function buildVideoChapterBulkInsertSql(
  rows: readonly (typeof videoChapters.$inferSelect)[],
): ChapterBulkStatement[] {
  if (rows.length === 0) throw new Error("video_chapter_bulk_insert_empty");
  // Large 100-member payloads are split into <=1MB bound strings, but those
  // binds are consumed by one compound INSERT. This avoids turning every byte
  // chunk into a separate D1 statement + changes() assertion while keeping
  // each individual bind comfortably below the 2MB platform limit.
  const chunks = chunkRowsByJsonByteSize(rows);
  const { source, maxPayloadBytes } = buildChunkValueUnion(chunks);
  return [
    {
      statement: sql`
        INSERT INTO video_chapters (
          id,
          video_id,
          x_user_id,
          chapter_time,
          chapter_label,
          note,
          visibility,
          created_at,
          updated_at
        )
        SELECT
          json_extract(chapter_rows.value, '$.id'),
          json_extract(chapter_rows.value, '$.video_id'),
          json_extract(chapter_rows.value, '$.x_user_id'),
          json_extract(chapter_rows.value, '$.chapter_time'),
          json_extract(chapter_rows.value, '$.chapter_label'),
          json_extract(chapter_rows.value, '$.note'),
          json_extract(chapter_rows.value, '$.visibility'),
          json_extract(chapter_rows.value, '$.created_at'),
          json_extract(chapter_rows.value, '$.updated_at')
        FROM (${source}) AS chapter_rows
      `,
      rowCount: rows.length,
      payloadBytes: maxPayloadBytes,
    },
  ];
}

