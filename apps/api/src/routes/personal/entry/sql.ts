import type { SqlFragment } from "../sql.ts";
import { CUSTOM_QUESTION_COLUMNS, MAX_VIDEO_CUSTOM_QUESTIONS_READ, STAGE_PERMISSION_KEY_SQL } from "./customQuestions.ts";

// MIG-0623: SQL arms shared by the Entry data statements. Each arm is `SELECT '<kind>' AS k, json_object(...) AS j ...`
// and every arm is bounded by a named LIMIT (see ./rows.ts for the statement shape).

/** CURRENT getUsedSoftwareSuggestions(db) default limit. */
export const MAX_SOFTWARE_SUGGESTIONS = 80;
/** CURRENT getXIconCandidates / getYoutubeChannelCandidates default limit (entry pages pass none). */
export const MAX_ENTRY_ICON_CANDIDATES = 24;
export const MAX_ENTRY_CHANNEL_CANDIDATES = 24;
/** Index reserved slots (CURRENT .limit(24)). */
export const MAX_RESERVED_SLOTS = 24;
/** Stage-permission question rows read per event; rows beyond it are silently NOT read (no throw, no truncated flag): judged unreachable. */
export const MAX_STAGE_QUESTIONS_PER_EVENT = 100;

const obj = (columns: readonly string[], alias = "q") => columns.map((c) => `'${c}', ${alias}.${c}`).join(", ");

/** getUsedSoftwareSuggestions: catalog names, then alias names (merged in JS). */
export function softwareArms(guard = "1 = 1"): string {
  return `SELECT 'sw_cat' AS k, json_object('v', q.name) AS j FROM (
      SELECT name FROM software_catalog WHERE ${guard} ORDER BY name LIMIT ${MAX_SOFTWARE_SUGGESTIONS}) q
    UNION ALL
    SELECT 'sw_alias' AS k, json_object('v', q.alias) AS j FROM (
      SELECT alias FROM software_aliases WHERE ${guard} ORDER BY alias LIMIT ${MAX_SOFTWARE_SUGGESTIONS}) q`;
}

/**
 * getXIconCandidates + getYoutubeChannelCandidates for the X ID of the CTE `ax` (single row, column `id`,
 * NULL when there is no active X ID -> no rows). Needs no bind parameters.
 */
export function candidateArms(): string {
  return `SELECT 'icon_x' AS k, json_object('v', q.icon_url) AS j FROM (
      SELECT x_users.icon_url AS icon_url FROM x_users WHERE x_users.id = (SELECT id FROM ax) LIMIT 1) q
    UNION ALL
    SELECT 'icon_v' AS k, json_object('v', q.icon_url) AS j FROM (
      SELECT videos.creator_icon_url AS icon_url FROM videos
      WHERE videos.creator_x_user_id = (SELECT id FROM ax) AND videos.creator_icon_url IS NOT NULL
        AND videos.visibility_status = 'public'
      ORDER BY videos.created_at DESC LIMIT ${MAX_ENTRY_ICON_CANDIDATES * 2}) q
    UNION ALL
    SELECT 'chan_x' AS k, json_object('v', q.youtube_channel_url) AS j FROM (
      SELECT x_users.youtube_channel_url AS youtube_channel_url FROM x_users
      WHERE lower(x_users.id) = lower(trim((SELECT id FROM ax))) LIMIT 1) q
    UNION ALL
    SELECT 'chan_v' AS k, json_object('v', q.youtube_channel_url) AS j FROM (
      SELECT videos.creator_youtube_channel_url AS youtube_channel_url FROM videos
      WHERE lower(videos.creator_x_user_id) = lower(trim((SELECT id FROM ax)))
        AND videos.creator_youtube_channel_url IS NOT NULL
      ORDER BY videos.created_at DESC LIMIT ${MAX_ENTRY_CHANNEL_CANDIDATES * 2}) q`;
}

/** The active X row of the CTE `ax` (CURRENT xRow: select from x_users where id = activeX). */
export function activeXArm(): string {
  return `SELECT 'x' AS k, json_object('x_name', q.x_name, 'icon_url', q.icon_url,
        'approval_status', q.approval_status, 'profile_text', q.profile_text,
        'youtube_channel_url', q.youtube_channel_url, 'other_social_links', q.other_social_links) AS j FROM (
      SELECT x_name, icon_url, approval_status, profile_text, youtube_channel_url, other_social_links
      FROM x_users WHERE x_users.id = (SELECT id FROM ax) LIMIT 1) q`;
}

/**
 * Active custom questions (non stage-permission) of the events in the CTE named `eventsCte` (column `id`), in CURRENT's
 * order (sort_order, id) per event. ONE row per event: `{event_id, rows:[...]}`, each bounded by a named LIMIT
 * (MAX_VIDEO_CUSTOM_QUESTIONS_READ + 1 so a larger event is detected and fails like CURRENT).
 */
export function customQuestionArm(eventsCte: string): SqlFragment {
  return {
    sql: `SELECT 'cq' AS k, json_object('event_id', e.id, 'rows', json((
      SELECT json_group_array(json_object(${obj(CUSTOM_QUESTION_COLUMNS)})) FROM (
        SELECT ${CUSTOM_QUESTION_COLUMNS.join(", ")} FROM event_custom_questions
        WHERE event_id = e.id AND is_active = 1 AND NOT ${STAGE_PERMISSION_KEY_SQL}
        ORDER BY sort_order, id
        LIMIT ${MAX_VIDEO_CUSTOM_QUESTIONS_READ + 1}) q))) AS j
      FROM ${eventsCte} e`,
    params: [],
  };
}

const STAGE_COLUMNS = ["event_id", "question_key", "label", "description", "placeholder", "required", "is_active"] as const;

/** Stage-permission question rows per event of `eventsCte` (one row per event, `{event_id, rows}`), ordered like CURRENT; at most MAX_STAGE_QUESTIONS_PER_EVENT per event, the rest are silently dropped. */
export function stageQuestionArm(eventsCte: string): SqlFragment {
  return {
    sql: `SELECT 'stage' AS k, json_object('event_id', e.id, 'rows', json((
      SELECT json_group_array(json_object(${obj(STAGE_COLUMNS)})) FROM (
        SELECT ${STAGE_COLUMNS.join(", ")} FROM event_custom_questions
        WHERE event_id = e.id AND ${STAGE_PERMISSION_KEY_SQL}
        ORDER BY sort_order
        LIMIT ${MAX_STAGE_QUESTIONS_PER_EVENT}) q))) AS j
      FROM ${eventsCte} e`,
    params: [],
  };
}
