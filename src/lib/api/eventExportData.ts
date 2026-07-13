import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  eventCustomQuestions,
  eventStaff,
  events,
  softwareCatalog,
  videoChapters,
  videoCustomAnswers,
  videoEvents,
  videoMembers,
  videos,
  videoSoftwares,
  xUsers,
} from "@/lib/db/schema";
import type {
  EventExportAnswerSnapshot,
  EventExportChapterSnapshot,
  EventExportMemberSnapshot,
  EventExportSnapshot,
  EventExportSoftwareSnapshot,
  EventExportVideoSnapshot,
} from "./eventExportPayload";

const EVENT_EXPORT_VIDEO_LIMIT = 500;

export interface EventExportEventRow {
  id: string;
  title: string;
  explanation: string | null;
  icon_url: string | null;
  img_url: string | null;
  accent_color: string | null;
  event_type: string | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
  visibility_status: string;
  public_api_enabled: number;
  updated_at: number;
}

function appendGrouped<T>(
  target: Map<string, T[]>,
  key: string,
  value: T,
): void {
  const rows = target.get(key);
  if (rows) rows.push(value);
  else target.set(key, [value]);
}

export async function loadEventExportEvent(
  db: DB,
  eventId: string,
): Promise<EventExportEventRow | null> {
  return (
    (
      await db
        .select({
          id: events.id,
          title: events.title,
          explanation: events.explanation,
          icon_url: events.icon_url,
          img_url: events.img_url,
          accent_color: events.accent_color,
          event_type: events.event_type,
          start_time: events.start_time,
          end_time: events.end_time,
          entry_start_time: events.entry_start_time,
          entry_end_time: events.entry_end_time,
          visibility_status: events.visibility_status,
          public_api_enabled: events.public_api_enabled,
          updated_at: events.updated_at,
        })
        .from(events)
        .where(eq(events.id, eventId))
        .limit(1)
    )[0] ?? null
  );
}

export async function loadEventExportSnapshot(
  db: DB,
  eventId: string,
  prefetchedEvent?: EventExportEventRow | null,
): Promise<EventExportSnapshot | null> {
  const event =
    prefetchedEvent === undefined
      ? await loadEventExportEvent(db, eventId)
      : prefetchedEvent;

  if (
    !event ||
    event.public_api_enabled !== 1 ||
    event.visibility_status !== "public"
  ) {
    return null;
  }

  const [rawVideos, staffRows] = await Promise.all([
    db
      .select({
        id: videos.id,
        title: videos.title,
        primary_event_id: videos.primary_event_id,
        collaboration_type: videos.collaboration_type,
        part: videos.part,
        source_type: videos.source_type,
        creator_display_name: videos.creator_display_name,
        creator_display_name_yomi: videos.creator_display_name_yomi,
        creator_x_user_id: videos.creator_x_user_id,
        creator_icon_url: videos.creator_icon_url,
        creator_youtube_channel_url: videos.creator_youtube_channel_url,
        creator_other_social_links: xUsers.other_social_links,
        music: videos.music,
        credit: videos.credit,
        music_reference_url: videos.music_reference_url,
        intro_comment: videos.intro_comment,
        highlights: videos.highlights,
        production_story: videos.production_story,
        closing_comment: videos.closing_comment,
        youtube_video_id: videos.youtube_video_id,
        scheduled_time: videos.scheduled_time,
        app_like_count: videos.app_like_count,
        score: videos.score,
        created_at: videos.created_at,
        updated_at: videos.updated_at,
      })
      .from(videoEvents)
      .innerJoin(videos, eq(videos.id, videoEvents.video_id))
      .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
      .where(
        and(
          eq(videoEvents.event_id, eventId),
          eq(videos.visibility_status, "public"),
        ),
      )
      .orderBy(asc(videos.scheduled_time), asc(videos.id))
      .limit(EVENT_EXPORT_VIDEO_LIMIT + 1),
    db
      .select({
        x_user_id: eventStaff.x_user_id,
        display_name: eventStaff.display_name,
        public_role_label: eventStaff.public_role_label,
        x_name: xUsers.x_name,
        icon_url: xUsers.icon_url,
      })
      .from(eventStaff)
      .leftJoin(xUsers, eq(xUsers.id, eventStaff.x_user_id))
      .where(
        and(
          eq(eventStaff.event_id, eventId),
          eq(eventStaff.is_public, 1),
        ),
      )
      .orderBy(asc(eventStaff.created_at), asc(eventStaff.id)),
  ]);

  const truncated = rawVideos.length > EVENT_EXPORT_VIDEO_LIMIT;
  const selectedVideos = rawVideos.slice(0, EVENT_EXPORT_VIDEO_LIMIT);
  const videoIds = selectedVideos.map((video) => video.id);

  const membersByVideo = new Map<string, EventExportMemberSnapshot[]>();
  const softwaresByVideo = new Map<string, EventExportSoftwareSnapshot[]>();
  const answersByVideo = new Map<string, EventExportAnswerSnapshot[]>();
  const chaptersByVideo = new Map<string, EventExportChapterSnapshot[]>();
  const eventIdsByVideo = new Map<string, string[]>();

  if (videoIds.length > 0) {
    const [memberRows, softwareRows, answerRows, chapterRows, relationRows] =
      await Promise.all([
        db
          .select({
            video_id: videoMembers.video_id,
            x_user_id: videoMembers.x_user_id,
            name: videoMembers.name,
            role_label: videoMembers.role,
            order_index: videoMembers.order_index,
            chapters_json: videoMembers.chapters_json,
          })
          .from(videoMembers)
          .where(
            and(
              inArray(videoMembers.video_id, videoIds),
              eq(videoMembers.is_public_member, 1),
            ),
          )
          .orderBy(asc(videoMembers.video_id), asc(videoMembers.order_index)),
        db
          .select({
            video_id: videoSoftwares.video_id,
            name: softwareCatalog.name,
            raw_label: videoSoftwares.raw_label,
            order_index: videoSoftwares.order_index,
          })
          .from(videoSoftwares)
          .innerJoin(
            softwareCatalog,
            eq(softwareCatalog.id, videoSoftwares.software_id),
          )
          .where(inArray(videoSoftwares.video_id, videoIds))
          .orderBy(asc(videoSoftwares.video_id), asc(videoSoftwares.order_index)),
        db
          .select({
            video_id: videoCustomAnswers.video_id,
            key: eventCustomQuestions.question_key,
            label: eventCustomQuestions.label,
            answer_text: videoCustomAnswers.answer_text,
            answer_json: videoCustomAnswers.answer_json,
            sort_order: eventCustomQuestions.sort_order,
          })
          .from(videoCustomAnswers)
          .innerJoin(
            eventCustomQuestions,
            and(
              eq(eventCustomQuestions.id, videoCustomAnswers.question_id),
              eq(eventCustomQuestions.event_id, videoCustomAnswers.event_id),
            ),
          )
          .where(
            and(
              eq(videoCustomAnswers.event_id, eventId),
              inArray(videoCustomAnswers.video_id, videoIds),
              eq(eventCustomQuestions.is_active, 1),
              eq(eventCustomQuestions.visibility, "public"),
            ),
          )
          .orderBy(
            asc(videoCustomAnswers.video_id),
            asc(eventCustomQuestions.sort_order),
          ),
        db
          .select({
            video_id: videoChapters.video_id,
            x_user_id: videoChapters.x_user_id,
            chapter_time: videoChapters.chapter_time,
            chapter_label: videoChapters.chapter_label,
            note: videoChapters.note,
            show_on_player_bar: videoChapters.show_on_player_bar,
            order_index: videoChapters.order_index,
          })
          .from(videoChapters)
          .where(
            and(
              inArray(videoChapters.video_id, videoIds),
              eq(videoChapters.visibility, "public"),
            ),
          )
          .orderBy(
            asc(videoChapters.video_id),
            asc(videoChapters.chapter_time),
            asc(videoChapters.order_index),
          ),
        db
          .select({
            video_id: videoEvents.video_id,
            event_id: videoEvents.event_id,
          })
          .from(videoEvents)
          .innerJoin(events, eq(events.id, videoEvents.event_id))
          .where(
            and(
              inArray(videoEvents.video_id, videoIds),
              eq(events.visibility_status, "public"),
            ),
          )
          .orderBy(asc(videoEvents.video_id), asc(videoEvents.event_id)),
      ]);

    for (const row of memberRows) {
      appendGrouped(membersByVideo, row.video_id, {
        x_user_id: row.x_user_id,
        name: row.name,
        role_label: row.role_label,
        order_index: row.order_index,
        chapters_json: row.chapters_json,
      });
    }
    for (const row of softwareRows) {
      appendGrouped(softwaresByVideo, row.video_id, {
        name: row.name,
        raw_label: row.raw_label,
        order_index: row.order_index,
      });
    }
    for (const row of answerRows) {
      appendGrouped(answersByVideo, row.video_id, {
        key: row.key,
        label: row.label,
        answer_text: row.answer_text,
        answer_json: row.answer_json,
        sort_order: row.sort_order,
      });
    }
    for (const row of chapterRows) {
      appendGrouped(chaptersByVideo, row.video_id, {
        x_user_id: row.x_user_id,
        chapter_time: row.chapter_time,
        chapter_label: row.chapter_label,
        note: row.note,
        show_on_player_bar: row.show_on_player_bar,
        order_index: row.order_index,
      });
    }
    for (const row of relationRows) {
      appendGrouped(eventIdsByVideo, row.video_id, row.event_id);
    }
  }

  const exportVideos: EventExportVideoSnapshot[] = selectedVideos.map((video) => ({
    ...video,
    collaboration_type: video.collaboration_type ?? "individual",
    source_type: video.source_type ?? "youtube",
    creator_other_social_links: video.creator_other_social_links ?? null,
    event_ids: eventIdsByVideo.get(video.id) ?? [eventId],
    members: membersByVideo.get(video.id) ?? [],
    softwares: softwaresByVideo.get(video.id) ?? [],
    answers: answersByVideo.get(video.id) ?? [],
    chapters: chaptersByVideo.get(video.id) ?? [],
  }));

  return {
    event: {
      id: event.id,
      title: event.title,
      explanation: event.explanation,
      icon_url: event.icon_url,
      img_url: event.img_url,
      accent_color: event.accent_color,
      event_type: event.event_type,
      start_time: event.start_time,
      end_time: event.end_time,
      entry_start_time: event.entry_start_time,
      entry_end_time: event.entry_end_time,
      updated_at: event.updated_at,
      public_staff: staffRows.map((staff) => ({
        x_user_id: staff.x_user_id,
        display_name: staff.display_name,
        public_role_label: staff.public_role_label,
        x_name: staff.x_name,
        icon_url: staff.icon_url,
      })),
    },
    videos: exportVideos,
    limit: EVENT_EXPORT_VIDEO_LIMIT,
    truncated,
  };
}
