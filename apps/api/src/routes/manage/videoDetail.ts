import { Hono } from "hono";
import type { ManageVideoDetailResponse } from "@flamenode/contracts";
import { formatChapterTime } from "@flamenode/domain/video";
import type { AppEnv } from "../../env.ts";
import { stagePermissionJson, reviewSummarySql, type StageQuestion } from "../../lib/videoReviewSummaries.ts";
import { parseJsonColumn } from "../personal/context.ts";
import { canEditEvent, loadManageSnapshot, manageGate } from "./access.ts";

// CURRENT: app/(manage)/manage/events/[id]/videos/[videoId]/page.tsx + src/lib/admin/videoReviewDetail.ts
// (fetchEventVideoReviewDetail) + src/lib/admin/videoReviewAnswer.ts (formatVideoReviewAnswer).
// Authorization (CURRENT): admin or the event is in the caller's manageable ids; the event row and the
// video_events link (video belongs to this event) must exist (else 404). `canReview` = video.status.
// D1 (S2, <= 3 statements incl. the session lookup): staff snapshot (admins skip it), then ONE statement.
// CURRENT is unbounded for questions / members / chapters; S2 caps each at 100 rows and sets `truncated`.
const MAX_DETAIL_ROWS = 100;

/** CURRENT formatVideoReviewAnswer. */
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

interface RawVideo {
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
  event: string | null;
  pending_count: number;
  questions: string | null;
  members: string | null;
  chapters: string | null;
  software: string | null;
}

export const manageVideoDetailRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const eventId = c.req.param("id") ?? "";
  const videoId = c.req.param("videoId") ?? "";
  const db = c.env.DB;
  const snapshot = await loadManageSnapshot(db, user);
  const denied = manageGate(c, snapshot);
  if (denied) return denied;
  if (!snapshot.isAdmin && !snapshot.manageableEventIds.includes(eventId)) return c.json({ error: "Not Found" }, 404);

  const summary = reviewSummarySql("v.id", eventId);
  const row = await db
    .prepare(
      `SELECT v.id AS id, v.title AS title, v.creator_display_name AS creator_name, v.creator_x_user_id AS creator_x_user_id,
         v.created_at AS created_at, v.source_type AS source_type, v.youtube_video_id AS youtube_video_id, v.music AS music,
         v.credit AS credit, v.intro_comment AS intro_comment, v.highlights AS highlights,
         v.production_story AS production_story, v.visibility_status AS visibility_status,
         ${summary.sql},
         (SELECT json_object('id', e.id, 'title', e.title, 'accent_color', e.accent_color) FROM events e WHERE e.id = ?) AS event,
         (SELECT COUNT(*) FROM video_events pe INNER JOIN videos pv ON pv.id = pe.video_id
           WHERE pe.event_id = ? AND pv.visibility_status = 'pending') AS pending_count,
         (SELECT json_group_array(json_object('label', q.label, 'required', q.required, 'answer_text', q.answer_text, 'answer_json', q.answer_json)) FROM (
            SELECT c.label AS label, c.required AS required,
              (SELECT a.answer_text FROM video_custom_answers a WHERE a.video_id = v.id AND a.question_id = c.id LIMIT 1) AS answer_text,
              (SELECT a.answer_json FROM video_custom_answers a WHERE a.video_id = v.id AND a.question_id = c.id LIMIT 1) AS answer_json
            FROM event_custom_questions c
            WHERE c.event_id = ? AND substr(c.question_key, 1, 16) <> 'stage_permission'
            ORDER BY c.sort_order ASC, c.id ASC LIMIT ?) q) AS questions,
         (SELECT json_group_array(json_object('name', q.name, 'role', q.role, 'x_user_id', q.x_user_id, 'is_public_member', q.is_public_member)) FROM (
            SELECT m.name AS name, m.role AS role, m.x_user_id AS x_user_id, m.is_public_member AS is_public_member
            FROM video_members m WHERE m.video_id = v.id ORDER BY m.order_index ASC, m.id ASC LIMIT ?) q) AS members,
         (SELECT json_group_array(json_object('x_user_id', q.x_user_id, 'chapter_time', q.chapter_time, 'chapter_label', q.chapter_label)) FROM (
            SELECT ch.x_user_id AS x_user_id, ch.chapter_time AS chapter_time, ch.chapter_label AS chapter_label
            FROM video_chapters ch WHERE ch.video_id = v.id ORDER BY ch.chapter_time ASC, ch.id ASC LIMIT ?) q) AS chapters,
         (SELECT json_group_array(q.raw_label) FROM (
            SELECT vs.raw_label AS raw_label FROM video_softwares vs
            INNER JOIN software_catalog sc ON sc.id = vs.software_id
            WHERE vs.video_id = v.id ORDER BY sc.name ASC, vs.raw_label ASC LIMIT ?) q) AS software
       FROM videos v INNER JOIN video_events ve ON ve.video_id = v.id
       WHERE v.id = ? AND ve.event_id = ? LIMIT 1`,
    )
    .bind(
      ...summary.params,
      eventId,
      eventId,
      eventId,
      MAX_DETAIL_ROWS + 1,
      MAX_DETAIL_ROWS + 1,
      MAX_DETAIL_ROWS + 1,
      MAX_DETAIL_ROWS + 1,
      videoId,
      eventId,
    )
    .first<RawVideo>();
  if (!row) return c.json({ error: "Not Found" }, 404);
  const event = parseJsonColumn<{ id: string; title: string; accent_color: string | null } | null>(row.event, null);
  if (!event) return c.json({ error: "Not Found" }, 404);

  const questions = parseJsonColumn<{ label: string; required: number; answer_text: string | null; answer_json: string | null }[]>(row.questions, []);
  const members = parseJsonColumn<{ name: string; role: string | null; x_user_id: string | null; is_public_member: number }[]>(row.members, []);
  const chapters = parseJsonColumn<{ x_user_id: string | null; chapter_time: number; chapter_label: string }[]>(row.chapters, []);
  const software = parseJsonColumn<string[]>(row.software, []);
  const truncated =
    questions.length > MAX_DETAIL_ROWS || members.length > MAX_DETAIL_ROWS || chapters.length > MAX_DETAIL_ROWS || software.length > MAX_DETAIL_ROWS;

  const chaptersByXUserId = new Map<string, string[]>();
  for (const chapter of chapters.slice(0, MAX_DETAIL_ROWS)) {
    if (!chapter.x_user_id) continue;
    const labels = chaptersByXUserId.get(chapter.x_user_id) ?? [];
    labels.push(`${formatChapterTime(chapter.chapter_time)} ${chapter.chapter_label}`);
    chaptersByXUserId.set(chapter.x_user_id, labels);
  }
  const body: ManageVideoDetailResponse = {
    isAdmin: snapshot.isAdmin,
    event,
    pendingCount: Number(row.pending_count ?? 0),
    canReview: canEditEvent(snapshot, eventId, "video.status"),
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
      software_label: software.length > 0 ? software.slice(0, MAX_DETAIL_ROWS).join(", ") : null,
      event_ids: [eventId],
      customAnswers: questions.slice(0, MAX_DETAIL_ROWS).map((q) => ({
        label: q.label,
        required: q.required === 1,
        answer: formatAnswer(q.answer_text, q.answer_json).trim() || "（未回答）",
      })),
      members: members.slice(0, MAX_DETAIL_ROWS).map((member) => ({
        name: member.name,
        role: member.role,
        x_user_id: member.x_user_id,
        is_public_member: member.is_public_member === 1,
        chapters: member.x_user_id ? (chaptersByXUserId.get(member.x_user_id)?.join(", ") ?? null) : null,
      })),
    },
    truncated,
  };
  return c.json(body);
});
