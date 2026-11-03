/**
 * MIG-0518 U02: Hono chapter write client. The canonical request and response
 * shapes are the already-merged MIG-0603 @flamenode/contracts schemas.
 * Never import legacy Next Server Actions into the Astro Island.
 */
import {
  ChapterWriteBodySchema,
  ChapterBulkBodySchema,
  ChapterActionResultSchema,
  BulkChapterActionResultSchema,
  type ChapterWriteBody,
  type ChapterActionResult,
  type BulkChapterActionResult,
} from "../../../../packages/contracts/src/videoChapter.ts";

type Fetcher = typeof fetch;

async function postChapter<T>(
  url: string,
  method: "POST" | "PUT" | "DELETE",
  body: unknown,
  resultSchema: { parse(value: unknown): T },
  fetcher: Fetcher,
): Promise<T> {
  const res = await fetcher(url, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined
      ? { Accept: "application/json" }
      : { Accept: "application/json", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  // A malformed status/body pairing must never appear successful in the UI.
  const result = resultSchema.parse(await res.json());
  if (!res.ok && (result as { ok: boolean }).ok) {
    throw new TypeError(`Unexpected successful chapter payload on HTTP ${res.status}`);
  }
  return result;
}

/** SA-012; snapshot intentionally remains independent from the Zod body schema. */
export async function createChapter(
  videoId: string,
  body: ChapterWriteBody & { active_x_snapshot?: string },
  fetcher: Fetcher = fetch,
): Promise<ChapterActionResult> {
  const { active_x_snapshot, ...fields } = body;
  const parsed = ChapterWriteBodySchema.parse(fields);
  return postChapter(
    `/api/videos/${encodeURIComponent(videoId)}/chapters`,
    "POST",
    active_x_snapshot === undefined ? parsed : { ...parsed, active_x_snapshot },
    ChapterActionResultSchema,
    fetcher,
  );
}

/** SA-015; the server parses the CSV atomically and caps it at 8 data rows. */
export async function createChaptersBulk(
  videoId: string,
  body: { csv: string; active_x_snapshot?: string },
  fetcher: Fetcher = fetch,
): Promise<BulkChapterActionResult> {
  const { active_x_snapshot, ...fields } = body;
  const parsed = ChapterBulkBodySchema.parse(fields);
  return postChapter(
    `/api/videos/${encodeURIComponent(videoId)}/chapters/bulk`,
    "POST",
    active_x_snapshot === undefined ? parsed : { ...parsed, active_x_snapshot },
    BulkChapterActionResultSchema,
    fetcher,
  );
}

/** SA-013; server independently checks chapter ownership and privileges. */
export async function updateChapter(
  chapterId: string,
  body: ChapterWriteBody,
  fetcher: Fetcher = fetch,
): Promise<ChapterActionResult> {
  return postChapter(
    `/api/videos/chapters/${encodeURIComponent(chapterId)}`,
    "PUT",
    ChapterWriteBodySchema.parse(body),
    ChapterActionResultSchema,
    fetcher,
  );
}

/** SA-014; no JSON body or Content-Type header. */
export async function deleteChapter(
  chapterId: string,
  fetcher: Fetcher = fetch,
): Promise<ChapterActionResult> {
  return postChapter(
    `/api/videos/chapters/${encodeURIComponent(chapterId)}`,
    "DELETE",
    undefined,
    ChapterActionResultSchema,
    fetcher,
  );
}
