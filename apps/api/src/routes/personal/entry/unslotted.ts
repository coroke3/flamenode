import { Hono } from "hono";
import type { UnslottedEntryResponse, UnslottedEventOption } from "@flamenode/contracts";
import type { AppEnv } from "../../../env.ts";
import { loadPersonalContext } from "../context.ts";
import { groupCustomQuestions, type CustomQuestionRow } from "./customQuestions.ts";
import {
  approvedXRows,
  channelCandidatesOf,
  iconCandidatesOf,
  initialProfileOf,
  softwareSuggestionsOf,
  unslottedSubmitBlock,
  type ActiveXRow,
} from "./formData.ts";
import {
  armOf,
  armOne,
  assertResponseBytes,
  ENTRY_PAGE_ROWS,
  jsonBytes,
  loadArmRows,
  MAX_RESPONSE_BYTES,
  nestedRows,
  parseOffset,
  takeWithinBytes,
} from "./rows.ts";
import { activeXArm, candidateArms, customQuestionArm, softwareArms } from "./sql.ts";

// CURRENT: app/(auth)/entry/unslotted/page.tsx. GET only.
// D1 (S2, 3 statements incl. the session lookup): context = 1, then ONE data statement (active X + software +
// candidates + eligible event options (<= ENTRY_PAGE_ROWS per `?offset=` page, cut earlier to keep the response <= 64 KiB;
// `truncated` + `nextOffset`) + their questions).
export const MAX_EVENT_QUERY_LENGTH = 100;

interface UnslottedEventRow {
  id: string;
  title: string;
  end_time: number | null;
  parts_json: string | null;
  youtube_description_template: string | null;
  required_video_fields_json: string | null;
}

export const personalEntryUnslottedRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) return c.json({ error: "Unauthorized" }, 401);
  const db = c.env.DB;
  const ctx = await loadPersonalContext(db, sessionUser, {});
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const user = ctx.user;
  const activeX = user.active_x_user_id;
  const eventQuery = (c.req.query("event_q") ?? "").trim().slice(0, MAX_EVENT_QUERY_LENGTH);
  const now = Math.floor(Date.now() / 1000);
  const offset = parseOffset(c.req.query("offset"));

  const questions = customQuestionArm("ev");
  // unslottedEventEligibilityWhere(now) + the optional title/id LIKE filter (CURRENT does not escape % and _).
  const arms = await loadArmRows(
    db
      .prepare(
        `WITH ax AS (SELECT NULLIF(?, '') AS id),
         ev AS (
           SELECT events.id AS id, events.title AS title, events.start_time AS start_time, events.end_time AS end_time,
             events.parts_json AS parts_json, events.youtube_description_template AS youtube_description_template,
             events.required_video_fields_json AS required_video_fields_json
           FROM events
           WHERE events.visibility_status = 'public'
             AND (events.allow_unslotted_posts = 1 OR (events.end_time IS NOT NULL AND events.end_time <= ?))
             AND (? = '' OR events.title LIKE ? OR events.id LIKE ?)
           ORDER BY events.end_time DESC, events.start_time DESC, events.id ASC
           LIMIT ${ENTRY_PAGE_ROWS} OFFSET ?
         )
         ${activeXArm()}
         UNION ALL
         SELECT 'ev' AS k, json_object('id', q.id, 'title', q.title, 'end_time', q.end_time, 'parts_json', q.parts_json,
             'youtube_description_template', q.youtube_description_template,
             'required_video_fields_json', q.required_video_fields_json) AS j
           FROM (SELECT id, title, end_time, parts_json, youtube_description_template, required_video_fields_json
                 FROM ev ORDER BY end_time DESC, start_time DESC, id ASC) q
         UNION ALL
         ${questions.sql}
         UNION ALL
         ${softwareArms()}
         UNION ALL
         ${candidateArms()}`,
      )
      .bind(activeX, now, eventQuery, `%${eventQuery}%`, `%${eventQuery}%`, offset),
  );

  const xRow = armOne<ActiveXRow>(arms, "x");
  const xIdOptions = approvedXRows(ctx.linkedRows).sort((a, b) =>
    a.x_name === b.x_name ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.x_name < b.x_name ? -1 : 1,
  );
  const events = armOf<UnslottedEventRow>(arms, "ev");
  const questionsByEvent = groupCustomQuestions(
    nestedRows<CustomQuestionRow>(arms, "cq"),
    events.map((event) => event.id),
  );
  const allOptions: UnslottedEventOption[] = events.map((event) => ({
    id: event.id,
    title: event.title,
    parts_json: event.parts_json ?? null,
    youtube_description_template: event.youtube_description_template ?? null,
    required_video_fields_json: event.required_video_fields_json ?? null,
    custom_questions: questionsByEvent.get(event.id) ?? [],
    status_label: event.end_time != null && event.end_time <= now ? "終了済" : "開催前・開催中の個別許可",
  }));

  const rest = {
    user,
    activeXId: activeX ?? null,
    submitBlock: unslottedSubmitBlock(activeX, xIdOptions, xRow),
    initialProfile: initialProfileOf(xRow?.x_name ?? user.name, xRow, user),
    xIdOptions,
    softwareSuggestions: softwareSuggestionsOf(arms),
    iconCandidates: activeX ? iconCandidatesOf(arms) : [],
    channelCandidates: activeX ? channelCandidatesOf(arms) : [],
    eventQuery,
  };
  // Options are cut by bytes (after the row page) so the whole response stays <= 64 KiB; nextOffset continues from the cut.
  const fit = takeWithinBytes(
    allOptions,
    MAX_RESPONSE_BYTES - jsonBytes({ ...rest, eventOptions: [], truncated: true, nextOffset: 1000 }),
  );
  const truncated = events.length >= ENTRY_PAGE_ROWS || fit.cut;
  const body: UnslottedEntryResponse = {
    ...rest,
    eventOptions: fit.items,
    truncated,
    nextOffset: truncated ? offset + fit.items.length : null,
  };
  assertResponseBytes(body);
  return c.json(body);
});
