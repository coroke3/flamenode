import { Hono } from "hono";
import type { AdminVideoMembersResponse, AdminVideoMemberInput } from "@flamenode/contracts";
import { formatChapterTime } from "@flamenode/domain/video";
import type { AppEnv } from "../../env.ts";
import { parseJsonColumn } from "../personal/context.ts";

// CURRENT: app/(admin)/admin/videos/[id]/members/page.tsx.
// D1: S2 budget <= 3 statements incl. session: statement 1 for video row, statement 2 for members with correlated chapters.
// CURRENT MAX_VIDEO_MEMBERS = 100. If members > 100, return 404 (CURRENT notFound()).
const MAX_VIDEO_MEMBERS = 100;

interface RawMemberRow {
  id: string;
  name: string;
  role: string | null;
  comment: string | null;
  order_index: number;
  can_edit: number;
  is_public_member: number;
  x_user_id: string | null;
  chapters: string | null;
}

export const adminVideoMembersRoutes = new Hono<AppEnv>().get("/:id/members", async (c) => {
  const videoId = c.req.param("id");
  const db = c.env.DB;

  // Statement 1: video row
  const video = await db
    .prepare(
      `SELECT id, title, youtube_video_id, collaboration_type
       FROM videos
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(videoId)
    .first<{
      id: string;
      title: string;
      youtube_video_id: string | null;
      collaboration_type: string | null;
    }>();

  if (!video) return c.json({ error: "Not Found" }, 404);

  // Statement 2: public members with correlated chapters
  const { results: memberRows } = await db
    .prepare(
      `SELECT m.id AS id, m.name AS name, m.role AS role, m.comment AS comment,
         m.order_index AS order_index, m.can_edit AS can_edit, m.is_public_member AS is_public_member,
         m.x_user_id AS x_user_id,
         (SELECT json_group_array(json_object('time', ch.chapter_time, 'label', ch.chapter_label, 'note', ch.note)) FROM (
            SELECT c.chapter_time AS chapter_time, c.chapter_label AS chapter_label, coalesce(c.note, '') AS note
            FROM video_chapters c
            WHERE c.video_id = m.video_id
              AND (instr(c.id, m.id || ':member:') = 1 OR instr(c.id, m.id || ':legacy:') = 1)
            ORDER BY c.chapter_time ASC, c.id ASC
         ) ch) AS chapters
       FROM video_members m
       WHERE m.video_id = ? AND m.is_public_member = 1
       ORDER BY m.order_index ASC, m.id ASC
       LIMIT ?`,
    )
    .bind(videoId, MAX_VIDEO_MEMBERS + 1)
    .all<RawMemberRow>();

  if (memberRows.length > MAX_VIDEO_MEMBERS) return c.json({ error: "Not Found" }, 404);

  const initialMembers: AdminVideoMemberInput[] = memberRows.map((member) => {
    const rawChapters = parseJsonColumn<Array<{ time: number; label: string; note: string }>>(member.chapters, []) ?? [];
    return {
      name: member.name,
      x_user_id: member.x_user_id ?? "",
      role: member.role ?? "",
      comment: member.comment ?? "",
      order_index: member.order_index,
      can_edit: member.can_edit,
      is_public_member: member.is_public_member,
      chapters: rawChapters.map((ch) => ({
        time: formatChapterTime(ch.time),
        label: ch.label,
        note: ch.note ?? "",
      })),
    };
  });

  const body: AdminVideoMembersResponse = {
    video: {
      id: video.id,
      title: video.title,
      youtube_video_id: video.youtube_video_id,
      collaboration_type: video.collaboration_type,
    },
    initialMembers,
  };

  return c.json(body);
});
