import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  auditLogs,
  eventStaff,
  events,
  softwareCatalog,
  users,
  videoChapters,
  videoEvents,
  videoMembers,
  videoSoftwares,
  videoYoutubeMetadata,
  videos,
  xUsers,
} from "@/lib/db/schema";
import { mutateWithAudit } from "@/lib/audit/mutate";
import type { CanonicalLegacyPlan, LegacyImportStrategy } from "./normalize";

const LEGACY_IMPORT_SYSTEM_USER_ID = "system_legacy_import";
const MAX_IDS_PER_QUERY = 80;

type ApplyOptions = {
  actorAuthUserId: string;
  strategy: LegacyImportStrategy;
};

export type LegacyApplyResult = {
  created: { events: number; videos: number; xUsers: number; softwares: number };
  replaced: { events: number; videos: number };
  skipped: { events: number; videos: number };
  warnings: string[];
};

function chunks<T>(values: readonly T[], size = MAX_IDS_PER_QUERY): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

function normalizeSoftwareName(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function stableSoftwareId(normalizedName: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalizedName.length; index += 1) {
    hash ^= normalizedName.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `sw_imp_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function ensureSystemUser(db: DB, actorAuthUserId: string): Promise<void> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, LEGACY_IMPORT_SYSTEM_USER_ID))
    .limit(1);
  if (existing[0]) return;
  const now = Math.floor(Date.now() / 1000);
  await mutateWithAudit(db, {
    mutationStatements: [
      db.run(sql`
        INSERT INTO "user" (
          id, name, role, can_create_events, is_notification_enabled,
          is_tos_accepted, is_banned, created_at
        ) VALUES (
          ${LEGACY_IMPORT_SYSTEM_USER_ID}, 'Legacy import system', 'user', 0, 0, 0, 0, ${now}
        )
      `),
    ],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "user",
        target_id: LEGACY_IMPORT_SYSTEM_USER_ID,
        operation: "CREATE",
        before: null,
        after: { id: LEGACY_IMPORT_SYSTEM_USER_ID, technical_principal: true },
        actor_user_id: actorAuthUserId,
        reason: "旧形式インポート専用principalを作成",
        context: "legacy_import",
        retention_class: "long_audit",
        restore_strategy: "delete_created",
      },
    ],
  });
}

async function ensureXUsers(
  db: DB,
  rows: CanonicalLegacyPlan["xUsers"],
  actorAuthUserId: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  const existing = new Set<string>();
  for (const group of chunks(rows.map((row) => row.id))) {
    const found = await db.select({ id: xUsers.id }).from(xUsers).where(inArray(xUsers.id, group));
    found.forEach((row) => existing.add(row.id));
  }
  const missing = rows.filter((row) => !existing.has(row.id));
  for (const group of chunks(missing, 40)) {
    const payload = JSON.stringify(group);
    await mutateWithAudit(db, {
      mutationStatements: [
        db.run(sql`
          INSERT INTO x_users (
            id, x_name, icon_url, profile_text, portfolio_contact,
            youtube_channel_url, other_social_links, creative_start_date, approval_status
          )
          SELECT
            json_extract(value, '$.id'),
            json_extract(value, '$.x_name'),
            json_extract(value, '$.icon_url'),
            NULL,
            NULL,
            json_extract(value, '$.youtube_channel_url'),
            json_extract(value, '$.other_social_links'),
            NULL,
            'imported'
          FROM json_each(${payload})
        `),
      ],
      expectedMutationChanges: [group.length],
      audits: [
        {
          table_name: "x_users_import_batch",
          target_id: `legacy:${group[0]?.id ?? "empty"}`,
          operation: "CREATE",
          before: null,
          after: { ids: group.map((row) => row.id) },
          actor_user_id: actorAuthUserId,
          reason: "旧形式からX名義を新正本へ作成",
          context: "legacy_import",
          retention_class: "long_audit",
          restore_strategy: "none",
        },
      ],
    });
  }
  return missing.length;
}

async function ensureSoftwareCatalog(
  db: DB,
  labels: readonly string[],
  actorAuthUserId: string,
): Promise<{ created: number; ids: Map<string, string> }> {
  const normalizedToLabel = new Map<string, string>();
  labels.forEach((label) => {
    const normalized = normalizeSoftwareName(label);
    if (normalized) normalizedToLabel.set(normalized, label.trim());
  });
  const normalizedNames = [...normalizedToLabel.keys()];
  const ids = new Map<string, string>();
  for (const group of chunks(normalizedNames)) {
    const found = await db
      .select({ id: softwareCatalog.id, normalized_name: softwareCatalog.normalized_name })
      .from(softwareCatalog)
      .where(inArray(softwareCatalog.normalized_name, group));
    found.forEach((row) => ids.set(row.normalized_name, row.id));
  }
  const missing = normalizedNames
    .filter((normalized) => !ids.has(normalized))
    .map((normalized) => ({
      id: stableSoftwareId(normalized),
      name: normalizedToLabel.get(normalized)!,
      normalized_name: normalized,
    }));
  const now = Math.floor(Date.now() / 1000);
  for (const group of chunks(missing, 40)) {
    const payload = JSON.stringify(group);
    await mutateWithAudit(db, {
      mutationStatements: [
        db.run(sql`
          INSERT INTO software_catalog (
            id, name, normalized_name, category, usage_count,
            is_active, is_verified, created_at, updated_at
          )
          SELECT
            json_extract(value, '$.id'),
            json_extract(value, '$.name'),
            json_extract(value, '$.normalized_name'),
            NULL, 0, 1, 0, ${now}, ${now}
          FROM json_each(${payload})
        `),
      ],
      expectedMutationChanges: [group.length],
      audits: [
        {
          table_name: "software_catalog_import_batch",
          target_id: `legacy:${group[0]?.id ?? "empty"}`,
          operation: "CREATE",
          before: null,
          after: { rows: group },
          actor_user_id: actorAuthUserId,
          reason: "旧形式の使用ソフトを新正本辞書へ追加",
          context: "legacy_import",
          retention_class: "long_audit",
          restore_strategy: "none",
        },
      ],
    });
    group.forEach((row) => ids.set(row.normalized_name, row.id));
  }
  return { created: missing.length, ids };
}

async function wasImportedEvent(db: DB, eventId: string): Promise<boolean> {
  const rows = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.table_name, "events"),
        eq(auditLogs.target_id, eventId),
        eq(auditLogs.context, "legacy_import"),
      ),
    )
    .limit(1);
  return !!rows[0];
}

async function applyEvent(
  db: DB,
  event: CanonicalLegacyPlan["events"][number],
  staffRows: CanonicalLegacyPlan["eventStaff"],
  options: ApplyOptions,
): Promise<"created" | "replaced" | "skipped"> {
  const existing = (await db.select().from(events).where(eq(events.id, event.id)).limit(1))[0] ?? null;
  if (existing && options.strategy === "skip_existing") return "skipped";
  if (existing && options.strategy === "create_only") {
    throw new Error(`イベント ${event.id} は既に存在します。`);
  }
  if (existing && !(await wasImportedEvent(db, event.id))) {
    throw new Error(`イベント ${event.id} は旧形式インポート由来ではないため置換できません。`);
  }
  const beforeStaff = existing
    ? await db.select().from(eventStaff).where(eq(eventStaff.event_id, event.id))
    : [];
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify(staffRows);
  const mutationStatements = [
    existing
      ? db.run(sql`
          UPDATE events SET
            title = ${event.title}, event_type = ${event.event_type},
            explanation = ${event.explanation}, icon_url = ${event.icon_url}, img_url = ${event.img_url},
            visibility_status = ${event.visibility_status}, start_time = ${event.start_time},
            end_time = ${event.end_time}, updated_at = ${now}
          WHERE id = ${event.id} AND updated_at = ${existing.updated_at}
        `)
      : db.run(sql`
          INSERT INTO events (
            id, title, event_type, explanation, icon_url, img_url, accent_color,
            visibility_status, allow_user_video_event_links, allow_unslotted_posts,
            allow_user_video_edits, slot_type, slot_visibility_mode, start_time, end_time,
            entry_start_time, entry_end_time, created_at, updated_at, max_slots_per_video,
            slot_part_gap_minutes, public_api_enabled
          ) VALUES (
            ${event.id}, ${event.title}, ${event.event_type}, ${event.explanation}, ${event.icon_url},
            ${event.img_url}, NULL, ${event.visibility_status}, 0, 0, 0, 'time', 'public_name',
            ${event.start_time}, ${event.end_time}, NULL, NULL, ${now}, ${now}, 1, 15, 0
          )
        `),
    ...(existing && beforeStaff.length > 0
      ? [db.run(sql`DELETE FROM event_staff WHERE event_id = ${event.id}`)]
      : []),
    ...(staffRows.length > 0
      ? [db.run(sql`
          INSERT INTO event_staff (
            id, event_id, x_user_id, display_name, permission_preset,
            custom_permission_keys_json, is_public, public_role_label,
            approved_by_auth_user_id, approved_at, created_at, updated_at
          )
          SELECT
            json_extract(value, '$.id'), json_extract(value, '$.event_id'),
            json_extract(value, '$.x_user_id'), json_extract(value, '$.display_name'),
            json_extract(value, '$.permission_preset'), NULL,
            json_extract(value, '$.is_public'), json_extract(value, '$.public_role_label'),
            ${options.actorAuthUserId}, ${now}, ${now}, ${now}
          FROM json_each(${payload})
        `)]
      : []),
  ];
  const expected = [
    1,
    ...(existing && beforeStaff.length > 0 ? [beforeStaff.length] : []),
    ...(staffRows.length > 0 ? [staffRows.length] : []),
  ];
  await mutateWithAudit(db, {
    mutationStatements,
    expectedMutationChanges: expected,
    audits: [
      {
        table_name: "events",
        target_id: event.id,
        operation: existing ? "UPDATE" : "CREATE",
        before: existing,
        after: { ...event, staff: staffRows },
        actor_user_id: options.actorAuthUserId,
        reason: "旧形式イベントを新正本へ変換",
        context: "legacy_import",
        retention_class: "long_audit",
        restore_strategy: existing ? "update_before" : "delete_created",
      },
    ],
  });
  return existing ? "replaced" : "created";
}

async function applyVideo(
  db: DB,
  video: CanonicalLegacyPlan["videos"][number],
  relations: CanonicalLegacyPlan["videoEvents"],
  members: CanonicalLegacyPlan["videoMembers"],
  chapters: CanonicalLegacyPlan["videoChapters"],
  softwareRows: Array<{ video_id: string; software_id: string; raw_label: string }>,
  options: ApplyOptions,
): Promise<"created" | "replaced" | "skipped"> {
  const existing = (await db.select().from(videos).where(eq(videos.id, video.id)).limit(1))[0] ?? null;
  if (existing && options.strategy === "skip_existing") return "skipped";
  if (existing && options.strategy === "create_only") throw new Error(`作品 ${video.id} は既に存在します。`);
  if (existing && existing.submitted_by_user_id !== LEGACY_IMPORT_SYSTEM_USER_ID) {
    throw new Error(`作品 ${video.id} は旧形式インポート由来ではないため置換できません。`);
  }
  for (const relation of relations) {
    const found = await db.select({ id: events.id }).from(events).where(eq(events.id, relation.event_id)).limit(1);
    if (!found[0]) throw new Error(`作品 ${video.id} の所属イベント ${relation.event_id} が存在しません。`);
  }

  const [beforeEvents, beforeMembers, beforeChapters, beforeSoftwares, beforeMetadata] = existing
    ? await Promise.all([
        db.select().from(videoEvents).where(eq(videoEvents.video_id, video.id)),
        db.select().from(videoMembers).where(eq(videoMembers.video_id, video.id)),
        db.select().from(videoChapters).where(eq(videoChapters.video_id, video.id)),
        db.select().from(videoSoftwares).where(eq(videoSoftwares.video_id, video.id)),
        db.select().from(videoYoutubeMetadata).where(eq(videoYoutubeMetadata.video_id, video.id)),
      ])
    : [[], [], [], [], []];
  const now = Math.floor(Date.now() / 1000);
  const relationPayload = JSON.stringify(relations);
  const memberPayload = JSON.stringify(members);
  const chapterPayload = JSON.stringify(chapters);
  const softwarePayload = JSON.stringify(softwareRows);
  const statements = [
    existing
      ? db.run(sql`
          UPDATE videos SET
            primary_event_id = ${video.primary_event_id}, creator_x_user_id = ${video.creator_x_user_id},
            submitted_by_user_id = ${LEGACY_IMPORT_SYSTEM_USER_ID},
            collaboration_type = ${video.collaboration_type}, part = NULL, source_type = ${video.source_type},
            creator_display_name = ${video.creator_display_name},
            creator_display_name_yomi = ${video.creator_display_name_yomi},
            creator_icon_url = ${video.creator_icon_url},
            creator_youtube_channel_url = ${video.creator_youtube_channel_url},
            title = ${video.title}, music = ${video.music}, credit = ${video.credit},
            music_reference_url = ${video.music_reference_url}, closing_comment = ${video.closing_comment},
            youtube_video_id = ${video.youtube_video_id}, intro_comment = ${video.intro_comment},
            highlights = ${video.highlights}, production_story = ${video.production_story},
            visibility_status = ${video.visibility_status}, scheduling_type = 'manual',
            scheduled_time = ${video.scheduled_time}, updated_at = ${now}
          WHERE id = ${video.id} AND updated_at = ${existing.updated_at}
        `)
      : db.run(sql`
          INSERT INTO videos (
            id, primary_event_id, creator_x_user_id, submitted_by_user_id, collaboration_type,
            part, source_type, creator_display_name, creator_display_name_yomi, creator_icon_url,
            creator_youtube_channel_url, title, music, credit, music_reference_url, closing_comment,
            youtube_video_id, intro_comment, highlights, production_story, visibility_status,
            scheduling_type, scheduled_time, app_like_count, score, score_updated_at, created_at, updated_at
          ) VALUES (
            ${video.id}, ${video.primary_event_id}, ${video.creator_x_user_id},
            ${LEGACY_IMPORT_SYSTEM_USER_ID}, ${video.collaboration_type}, NULL, ${video.source_type},
            ${video.creator_display_name}, ${video.creator_display_name_yomi}, ${video.creator_icon_url},
            ${video.creator_youtube_channel_url}, ${video.title}, ${video.music}, ${video.credit},
            ${video.music_reference_url}, ${video.closing_comment}, ${video.youtube_video_id},
            ${video.intro_comment}, ${video.highlights}, ${video.production_story},
            ${video.visibility_status}, 'manual', ${video.scheduled_time}, 0, 0, NULL,
            ${video.created_at}, ${now}
          )
        `),
    ...(beforeEvents.length ? [db.run(sql`DELETE FROM video_events WHERE video_id = ${video.id}`)] : []),
    ...(beforeMembers.length ? [db.run(sql`DELETE FROM video_members WHERE video_id = ${video.id}`)] : []),
    ...(beforeChapters.length ? [db.run(sql`DELETE FROM video_chapters WHERE video_id = ${video.id}`)] : []),
    ...(beforeSoftwares.length ? [db.run(sql`DELETE FROM video_softwares WHERE video_id = ${video.id}`)] : []),
    ...(beforeMetadata.length ? [db.run(sql`DELETE FROM video_youtube_metadata WHERE video_id = ${video.id}`)] : []),
    ...(relations.length
      ? [db.run(sql`
          INSERT INTO video_events (video_id, event_id)
          SELECT json_extract(value, '$.video_id'), json_extract(value, '$.event_id')
          FROM json_each(${relationPayload})
        `)]
      : []),
    ...(members.length
      ? [db.run(sql`
          INSERT INTO video_members (
            id, video_id, x_user_id, name, role, comment, order_index,
            can_edit, is_public_member, edit_granted_by_auth_user_id,
            edit_granted_at, edit_updated_at
          )
          SELECT
            json_extract(value, '$.id'), json_extract(value, '$.video_id'),
            json_extract(value, '$.x_user_id'), json_extract(value, '$.name'),
            json_extract(value, '$.role'), NULL, json_extract(value, '$.order_index'),
            0, 1, NULL, NULL, NULL
          FROM json_each(${memberPayload})
        `)]
      : []),
    ...(chapters.length
      ? [db.run(sql`
          INSERT INTO video_chapters (
            id, video_id, x_user_id, chapter_time, chapter_label,
            note, visibility, created_at, updated_at
          )
          SELECT
            json_extract(value, '$.id'), json_extract(value, '$.video_id'),
            json_extract(value, '$.x_user_id'), json_extract(value, '$.chapter_time'),
            json_extract(value, '$.chapter_label'), json_extract(value, '$.note'),
            'public', ${now}, ${now}
          FROM json_each(${chapterPayload})
        `)]
      : []),
    ...(softwareRows.length
      ? [db.run(sql`
          INSERT INTO video_softwares (video_id, software_id, raw_label)
          SELECT
            json_extract(value, '$.video_id'), json_extract(value, '$.software_id'),
            json_extract(value, '$.raw_label')
          FROM json_each(${softwarePayload})
        `)]
      : []),
    ...(video.youtube_video_id
      ? [db.run(sql`
          INSERT INTO video_youtube_metadata (
            video_id, youtube_privacy_status, youtube_availability_status,
            duration_seconds, view_count, synced_at, sync_status, sync_error, updated_at
          ) VALUES (${video.id}, NULL, NULL, NULL, 0, NULL, 'pending', NULL, ${now})
        `)]
      : []),
    db.run(sql`
      INSERT OR IGNORE INTO static_rebuild_queue (
        id, target_type, target_id, reason, priority, status,
        attempt_count, requested_by_user_id, created_at, updated_at
      ) VALUES (
        ${`legacy_import_video_${video.id}`}, 'video', ${video.id}, 'legacy_import',
        'normal', 'pending', 0, ${options.actorAuthUserId}, ${now}, ${now}
      )
    `),
  ];
  const expected = [
    1,
    ...(beforeEvents.length ? [beforeEvents.length] : []),
    ...(beforeMembers.length ? [beforeMembers.length] : []),
    ...(beforeChapters.length ? [beforeChapters.length] : []),
    ...(beforeSoftwares.length ? [beforeSoftwares.length] : []),
    ...(beforeMetadata.length ? [beforeMetadata.length] : []),
    ...(relations.length ? [relations.length] : []),
    ...(members.length ? [members.length] : []),
    ...(chapters.length ? [chapters.length] : []),
    ...(softwareRows.length ? [softwareRows.length] : []),
    ...(video.youtube_video_id ? [1] : []),
    null,
  ];
  await mutateWithAudit(db, {
    mutationStatements: statements,
    expectedMutationChanges: expected,
    audits: [
      {
        table_name: "videos",
        target_id: video.id,
        operation: existing ? "UPDATE" : "CREATE",
        before: existing,
        after: {
          ...video,
          event_ids: relations.map((row) => row.event_id),
          member_ids: members.map((row) => row.id),
          chapter_ids: chapters.map((row) => row.id),
          software_ids: softwareRows.map((row) => row.software_id),
        },
        actor_user_id: options.actorAuthUserId,
        reason: "旧形式作品を新正本へ変換",
        context: "legacy_import",
        retention_class: "long_audit",
        restore_strategy: existing ? "update_before" : "delete_created",
      },
    ],
  });
  return existing ? "replaced" : "created";
}

export async function applyLegacyImportPlan(
  db: DB,
  plan: CanonicalLegacyPlan,
  options: ApplyOptions,
): Promise<LegacyApplyResult> {
  if (plan.errors.length > 0) throw new Error(plan.errors.join("\n"));
  await ensureSystemUser(db, options.actorAuthUserId);
  const xUserCount = await ensureXUsers(db, plan.xUsers, options.actorAuthUserId);
  const catalog = await ensureSoftwareCatalog(
    db,
    plan.videoSoftwares.map((row) => row.label),
    options.actorAuthUserId,
  );
  const result: LegacyApplyResult = {
    created: { events: 0, videos: 0, xUsers: xUserCount, softwares: catalog.created },
    replaced: { events: 0, videos: 0 },
    skipped: { events: 0, videos: 0 },
    warnings: [...plan.warnings],
  };

  for (const event of plan.events) {
    const action = await applyEvent(
      db,
      event,
      plan.eventStaff.filter((row) => row.event_id === event.id),
      options,
    );
    result[action === "created" ? "created" : action === "replaced" ? "replaced" : "skipped"].events += 1;
  }

  for (const video of plan.videos) {
    const softwareRows = plan.videoSoftwares
      .filter((row) => row.video_id === video.id)
      .map((row) => ({
        video_id: video.id,
        software_id: catalog.ids.get(normalizeSoftwareName(row.label))!,
        raw_label: row.label,
      }))
      .filter((row) => !!row.software_id);
    const action = await applyVideo(
      db,
      video,
      plan.videoEvents.filter((row) => row.video_id === video.id),
      plan.videoMembers.filter((row) => row.video_id === video.id),
      plan.videoChapters.filter((row) => row.video_id === video.id),
      softwareRows,
      options,
    );
    result[action === "created" ? "created" : action === "replaced" ? "replaced" : "skipped"].videos += 1;
  }
  return result;
}
