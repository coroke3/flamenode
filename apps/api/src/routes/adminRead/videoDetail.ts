import { Hono } from "hono";
import type { AdminVideoDetailResponse, AdminVideoModerationCase } from "@flamenode/contracts";
import { formatChapterTime } from "@flamenode/domain/video";
import type { AppEnv } from "../../env.ts";
import { stagePermissionJson, reviewSummarySql, type StageQuestion } from "../../lib/videoReviewSummaries.ts";
import { MAX_JSON_COLUMN_BYTES, parseJsonColumn } from "../personal/context.ts";

// CURRENT: app/(admin)/admin/videos/[id]/page.tsx + src/lib/admin/videoReviewDetail.ts (fetchVideoReviewDetail)
// + src/lib/admin/videoReviewAnswer.ts (formatVideoReviewAnswer) + videoModerationCases query.
// Authorization: admin role check is performed by adminReadRoutes middleware.
// D1: S2 budget <= 3 statements incl. session: statement 1 for review detail + statement 2 for moderation cases.
const MAX_DETAIL_ROWS = 100;
const MODERATION_CASES_LIMIT = 20;

/** Work Order U01: a surface over 100 rows or 64 KiB is reported as `truncated` instead of failing the page. */
function parseSurface<T>(value: unknown): { items: T[]; truncated: boolean } {
  if (typeof value === "string" && value.length > MAX_JSON_COLUMN_BYTES) return { items: [], truncated: true };
  const items = parseJsonColumn<T[]>(value, []) ?? [];
  return { items: items.slice(0, MAX_DETAIL_ROWS), truncated: items.length > MAX_DETAIL_ROWS };
}

function formatAnswer(answerText: string | null | undefined, answerJson: string | null | undefined): string {
  const text = answerText?.trim() ?? "";
  if (text) return text;
  const rawJson = answerJson?.trim() ?? "";
  if (!rawJson) return "";
  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
        .join(", ");
    }
    if (typeof parsed === "string") return parsed.trim();
    if (parsed == null) return "";
    if (typeof parsed === "object") return Object.keys(parsed).length === 0 ? "" : JSON.stringify(parsed);
    return String(parsed);
  } catch {
    return rawJson;
  }
}

interface RawVideoRow {
  id: string;
  title: string;
  creator_name: string | null;
  creator_x_user_id: string | null;
  created_at: number;
  source_type: string;
  youtube_video_id: string | null;
  music: string | null;
  credit: string | null;
  intro_comment: string | null;
  highlights: string | null;
  production_story: string | null;
  visibility_status: string;
  stage_questions: string | null;
  event_ids: string | null;
  questions: string | null;
  members: string | null;
  chapters: string | null;
  software: string | null;
}

export const adminVideoDetailRoutes = new Hono<AppEnv>().get("/:id", async (c) => {
  const videoId = c.req.param("id");
  const eventParam = c.req.query("event")?.trim() || null;
  const db = c.env.DB;

  const summary = reviewSummarySql("v.id");

  // Statement 1: video detail, stage permission, event_ids, custom answers, members, chapters, software
  const row = await db
    .prepare(
      `SELECT v.id AS id, v.title AS title, v.creator_display_name AS creator_name,
         v.creator_x_user_id AS creator_x_user_id, v.created_at AS created_at,
         v.source_type AS source_type, v.youtube_video_id AS youtube_video_id,
         v.music AS music, v.credit AS credit, v.intro_comment AS intro_comment,
         v.highlights AS highlights, v.production_story AS production_story,
         v.visibility_status AS visibility_status,
         ${summary.sql},
         (SELECT json_group_array(q.event_id) FROM (
            SELECT ve.event_id AS event_id FROM video_events ve WHERE ve.video_id = v.id ORDER BY ve.event_id ASC LIMIT ?
          ) q) AS event_ids,
         (SELECT json_group_array(json_object('label', q.label, 'required', q.required, 'answer_text', q.answer_text, 'answer_json', q.answer_json)) FROM (
            SELECT c.label AS label, c.required AS required,
              (SELECT a.answer_text FROM video_custom_answers a WHERE a.video_id = v.id AND a.question_id = c.id LIMIT 1) AS answer_text,
              (SELECT a.answer_json FROM video_custom_answers a WHERE a.video_id = v.id AND a.question_id = c.id LIMIT 1) AS answer_json
            FROM event_custom_questions c
            WHERE c.event_id IN (SELECT ve.event_id FROM video_events ve WHERE ve.video_id = v.id)
              AND substr(c.question_key, 1, 16) <> 'stage_permission' -- CURRENT startsWith (case-sensitive, no LIKE wildcards)
            ORDER BY c.event_id ASC, c.sort_order ASC, c.id ASC
            LIMIT ?
          ) q) AS questions,
         (SELECT json_group_array(json_object('name', q.name, 'role', q.role, 'x_user_id', q.x_user_id, 'is_public_member', q.is_public_member)) FROM (
            SELECT m.name AS name, m.role AS role, m.x_user_id AS x_user_id, m.is_public_member AS is_public_member
            FROM video_members m WHERE m.video_id = v.id ORDER BY m.order_index ASC, m.id ASC
            LIMIT ?
          ) q) AS members,
         (SELECT json_group_array(json_object('x_user_id', q.x_user_id, 'chapter_time', q.chapter_time, 'chapter_label', q.chapter_label)) FROM (
            SELECT ch.x_user_id AS x_user_id, ch.chapter_time AS chapter_time, ch.chapter_label AS chapter_label
            FROM video_chapters ch WHERE ch.video_id = v.id ORDER BY ch.chapter_time ASC, ch.id ASC
            LIMIT ?
          ) q) AS chapters,
         (SELECT json_group_array(q.raw_label) FROM (
            SELECT vs.raw_label AS raw_label
            FROM video_softwares vs
            INNER JOIN software_catalog sc ON sc.id = vs.software_id
            WHERE vs.video_id = v.id
            ORDER BY sc.name ASC, vs.raw_label ASC
            LIMIT ?
          ) q) AS software
       FROM videos v
       WHERE v.id = ?
       LIMIT 1`,
    )
    .bind(
      ...summary.params,
      MAX_DETAIL_ROWS + 1,
      MAX_DETAIL_ROWS + 1,
      MAX_DETAIL_ROWS + 1,
      MAX_DETAIL_ROWS + 1,
      MAX_DETAIL_ROWS + 1,
      videoId,
    )
    .first<RawVideoRow>();

  if (!row) return c.json({ error: "Not Found" }, 404);

  // Statement 2: moderation cases
  const { results: moderationCases } = await db
    .prepare(
      `SELECT id, case_type, status, public_reason, private_note, due_at,
         related_x_user_id, created_at, resolved_at
       FROM video_moderation_cases
       WHERE video_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(videoId, MODERATION_CASES_LIMIT)
    .all<AdminVideoModerationCase>();

  const eventIds = parseSurface<string>(row.event_ids);
  const questions = parseSurface<{ label: string; required: number; answer_text: string | null; answer_json: string | null }>(row.questions);
  const members = parseSurface<{ name: string; role: string | null; x_user_id: string | null; is_public_member: number }>(row.members);
  const chapters = parseSurface<{ x_user_id: string | null; chapter_time: number; chapter_label: string }>(row.chapters);
  const software = parseSurface<string>(row.software);

  const truncated = [eventIds, questions, members, chapters, software].some((surface) => surface.truncated);

  const chaptersByXUserId = new Map<string, string[]>();
  for (const chapter of chapters.items) {
    if (!chapter.x_user_id) continue;
    const labels = chaptersByXUserId.get(chapter.x_user_id) ?? [];
    labels.push(`${formatChapterTime(chapter.chapter_time)} ${chapter.chapter_label}`);
    chaptersByXUserId.set(chapter.x_user_id, labels);
  }

  const openCaseCount = moderationCases.filter((item) => item.status === "open").length;
  const openVoidCaseId =
    moderationCases.find((item) => item.status === "open" && item.case_type === "void")?.id ??
    moderationCases.find((item) => item.status === "open")?.id ??
    null;

  const body: AdminVideoDetailResponse = {
    video: {
      id: row.id,
      title: row.title,
      creator_name: row.creator_name ?? row.creator_x_user_id ?? "—",
      creator_x_user_id: row.creator_x_user_id,
      created_at: row.created_at,
      source_type: row.source_type,
      youtube_video_id: row.youtube_video_id,
      music: row.music,
      credit: row.credit,
      intro_comment: row.intro_comment,
      highlights: row.highlights,
      production_story: row.production_story,
      stagePermission: stagePermissionJson({ stage_questions: parseJsonColumn<StageQuestion[]>(row.stage_questions, []) }),
      visibility_status: row.visibility_status,
      software_label: software.items.length > 0 ? software.items.join(", ") : null,
      event_ids: eventIds.items,
      customAnswers: questions.items.map((q) => ({
        label: q.label,
        required: q.required === 1,
        answer: formatAnswer(q.answer_text, q.answer_json).trim() || "（未回答）",
      })),
      members: members.items.map((member) => ({
        name: member.name,
        role: member.role,
        x_user_id: member.x_user_id,
        is_public_member: member.is_public_member === 1,
        chapters: member.x_user_id ? (chaptersByXUserId.get(member.x_user_id)?.join(", ") ?? null) : null,
      })),
    },
    moderationCases,
    openCaseCount,
    openVoidCaseId,
    event: eventParam,
    truncated,
  };

  return c.json(body);
});
