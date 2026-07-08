/**
 * LegacyImportPlan 組み立て。
 *
 * - ソフトウェアカタログの重複排除
 * - イベントごとのデフォルトカスタム質問（stage_permission / stage_participation / production_experience）
 * - video_custom_answers のマッピング
 * - event_staff は representative_candidate → "manager", 他 → "public_staff"
 */

import type {
  CanonicalEvent,
  CanonicalEventCustomQuestion,
  CanonicalEventStaff,
  CanonicalVideo,
  CanonicalVideoCustomAnswer,
  CanonicalVideoEvent,
  CanonicalVideoMember,
  CanonicalXUser,
  CanonicalYoutubeMetadata,
  ImportError,
  ImportMode,
  ImportStats,
  ImportWarning,
  LegacyImportPlan,
  SoftwareCatalogEntry,
  VideoNormalizationExtra,
} from "./types.ts";
import type {
  LegacyEventResult,
  LegacyVideoResult,
  LegacyXUserRow,
} from "./normalize.ts";

const LEGACY_QUESTION_KEYS = [
  "stage_permission",
  "stage_participation",
  "production_experience",
] as const;

const LEGACY_QUESTION_LABELS: Record<string, string> = {
  stage_permission: "ステージ使用権",
  stage_participation: "当日参加",
  production_experience: "制作年数・経験",
};

const LEGACY_QUESTION_DESCRIPTIONS: Record<string, string> = {
  stage_permission: "旧データの righttype フィールド",
  stage_participation: "旧データの toudan フィールド",
  production_experience: "旧データの movieyear フィールド",
};

function normalizeSoftwareName(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** インポートプランと previewToken がリクエスト間で安定するよう、決定的 ID を使う。 */
function legacySoftwareCatalogId(normalizedName: string): string {
  const slug = normalizedName.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `sw_imp_${slug || "unknown"}`;
}

function legacyEventQuestionId(eventId: string, questionKey: string): string {
  return `ecq_imp_${eventId}_${questionKey}`;
}

/**
 * 正規化済みイベント・動画リストから LegacyImportPlan を組み立てる。
 */
export function buildLegacyImportPlan(
  normalizedEvents: LegacyEventResult[],
  normalizedVideos: LegacyVideoResult[],
  now: number,
  options: { importMode?: ImportMode } = {},
): LegacyImportPlan {
  const warnings: ImportWarning[] = [];
  const errors: ImportError[] = [];

  // ----------------------------------------------------------
  // 1. X ユーザー収集（重複排除）
  // ----------------------------------------------------------
  const xUserMap = new Map<string, LegacyXUserRow>();
  const mergeXUser = (row: LegacyXUserRow): void => {
    const prev = xUserMap.get(row.id);
    if (!prev) {
      xUserMap.set(row.id, { ...row });
      return;
    }
    xUserMap.set(row.id, {
      id: row.id,
      x_name: row.x_name || prev.x_name,
      profile_text: row.profile_text ?? prev.profile_text ?? null,
      portfolio_contact: row.portfolio_contact ?? prev.portfolio_contact ?? null,
      youtube_channel_url: row.youtube_channel_url ?? prev.youtube_channel_url ?? null,
      other_social_links: row.other_social_links ?? prev.other_social_links ?? null,
    });
  };
  for (const e of normalizedEvents) for (const x of e.xUsers) mergeXUser(x);
  for (const v of normalizedVideos) for (const x of v.xUsers) mergeXUser(x);

  const xUsers: CanonicalXUser[] = Array.from(xUserMap.values()).map((x) => ({
    id: x.id,
    x_name: x.x_name,
    profile_text: x.profile_text ?? null,
    portfolio_contact: x.portfolio_contact ?? null,
    youtube_channel_url: x.youtube_channel_url ?? null,
    other_social_links: x.other_social_links ?? null,
    approval_status: "imported",
  }));

  // ----------------------------------------------------------
  // 2. ソフトウェアカタログ（重複排除）
  // ----------------------------------------------------------
  const softwareCatalogMap = new Map<string, SoftwareCatalogEntry>();
  const resolveSoftwareId = (label: string): string => {
    const normalized = normalizeSoftwareName(label);
    const existing = softwareCatalogMap.get(normalized);
    if (existing) return existing.id;
    const id = legacySoftwareCatalogId(normalized);
    softwareCatalogMap.set(normalized, { id, name: label, normalized_name: normalized });
    return id;
  };

  // ----------------------------------------------------------
  // 3. イベント
  // ----------------------------------------------------------
  const events: CanonicalEvent[] = [];
  const eventStaff: CanonicalEventStaff[] = [];
  const eventCustomQuestions: CanonicalEventCustomQuestion[] = [];

  // どのイベントがカスタム質問を必要とするか後で計算するため、
  // 先にビデオ→イベントIDのマッピングを準備
  const videoEventIds = new Set<string>();
  for (const v of normalizedVideos) {
    if (v.ok && v.video) {
      for (const eid of v.eventIds) videoEventIds.add(eid);
    }
  }

  // イベントIDごとのカスタム質問IDマップ
  const eventQuestionIdMap = new Map<string, Map<string, string>>();

  for (const e of normalizedEvents) {
    if (!e.ok || !e.event) {
      errors.push({
        source: "event",
        message: e.warnings.join(" / ") || "parse error",
      });
      continue;
    }
    for (const w of e.warnings) {
      warnings.push({ source: `event:${e.event.id}`, message: w });
    }

    const ev = e.event;
    events.push({
      id: ev.id,
      title: ev.title,
      event_type: ev.event_type,
      explanation: ev.explanation,
      icon_url: ev.icon_url,
      img_url: ev.img_url,
      start_time: ev.start_time,
      end_time: ev.end_time,
      visibility_status: ev.visibility_status,
      representative_x_user_id: ev.representative_x_user_id,
    });

    // event_staff: representative_candidate → "manager", other → "public_staff"
    for (const ed of e.editors) {
      const staffId = `legacy_es_${ev.id}_${ed.x_user_id}`;
      const preset: CanonicalEventStaff["permission_preset"] = ed.is_representative_candidate
        ? "manager"
        : "public_staff";
      eventStaff.push({
        id: staffId,
        event_id: ev.id,
        x_user_id: ed.x_user_id,
        display_name: ed.x_name ?? `@${ed.x_user_id}`,
        permission_preset: preset,
        is_public: ed.is_public,
        public_role_label: ed.public_role_label,
      });
    }

    // デフォルトカスタム質問 (イベントにビデオが紐付いている場合のみ)
    if (videoEventIds.has(ev.id)) {
      const qMap = new Map<string, string>();
      LEGACY_QUESTION_KEYS.forEach((key, idx) => {
        const qid = legacyEventQuestionId(ev.id, key);
        qMap.set(key, qid);
        eventCustomQuestions.push({
          id: qid,
          event_id: ev.id,
          question_key: key,
          label: LEGACY_QUESTION_LABELS[key] ?? key,
          description: LEGACY_QUESTION_DESCRIPTIONS[key] ?? null,
          type: "textarea",
          required: 0,
          options_json: null,
          placeholder: null,
          max_length: 1000,
          sort_order: idx,
          is_active: 1,
          visibility: "review",
        });
      });
      eventQuestionIdMap.set(ev.id, qMap);
    }
  }

  // ----------------------------------------------------------
  // 4. 動画
  // ----------------------------------------------------------
  const videos: CanonicalVideo[] = [];
  const videoEvents: CanonicalVideoEvent[] = [];
  const videoMembers: CanonicalVideoMember[] = [];
  const videoCustomAnswers: CanonicalVideoCustomAnswer[] = [];
  const videoNormExtras: VideoNormalizationExtra[] = [];
  const youtubeMetadata: CanonicalYoutubeMetadata[] = [];

  for (const v of normalizedVideos) {
    if (!v.ok || !v.video) {
      errors.push({
        source: "video",
        message: v.warnings.join(" / ") || "parse error",
      });
      continue;
    }
    for (const w of v.warnings) {
      warnings.push({ source: `video:${v.video.id}`, message: w });
    }

    const vi = v.video;
    videos.push({
      id: vi.id,
      title: vi.title,
      creator_display_name: vi.display_name,
      creator_display_name_yomi: vi.display_name_yomi,
      creator_x_user_id: vi.creator_x_user_id,
      creator_icon_url: vi.creator_icon_url,
      collaboration_type: vi.submission_type,
      source_type: "youtube",
      youtube_video_id: vi.youtube_video_id,
      music: vi.music,
      credit: vi.credit,
      music_reference_url: vi.music_reference_url,
      intro_comment: vi.intro_comment,
      closing_comment: vi.closing_comment,
      highlights: vi.highlights,
      primary_event_id: vi.primary_event_id,
      scheduling_type: vi.scheduling_type,
      scheduled_time: vi.scheduled_time,
      visibility_status: vi.status,
      created_at: vi.created_at,
    });

    // video_events
    for (const eid of v.eventIds) {
      videoEvents.push({ video_id: vi.id, event_id: eid });
    }

    // video_members
    for (const m of v.members) {
      const memberId = `${vi.id}-${m.order_index}-${m.x_user_id ?? "x"}`;
      videoMembers.push({
        id: memberId,
        video_id: vi.id,
        x_user_id: m.x_user_id,
        name: m.name,
        role: m.role,
        order_index: m.order_index,
        chapters_json: m.chapters_json,
      });
    }

    // video_custom_answers: 各イベントのカスタム質問に回答をマッピング
    for (const eid of v.eventIds) {
      const qMap = eventQuestionIdMap.get(eid);
      if (!qMap) {
        // そのイベントが本インポートに含まれない場合はスキップ
        // （別バッチでインポート済みのイベントへの紐付け時はapply側で処理）
        continue;
      }
      for (const ans of vi.legacyCustomAnswers) {
        const qid = qMap.get(ans.key);
        if (!qid) continue;
        videoCustomAnswers.push({
          video_id: vi.id,
          event_id: eid,
          question_id: qid,
          question_key: ans.key,
          answer_text: ans.value,
        });
      }
    }

    // video_softwares（プランには extra として保持、apply 側で replaceVideoSoftwareLabels を呼ぶ）
    for (const label of vi.softwareLabels) {
      resolveSoftwareId(label);
    }

    videoNormExtras.push({
      video_id: vi.id,
      softwareLabels: vi.softwareLabels,
      legacyCustomAnswers: vi.legacyCustomAnswers,
    });

    // youtube_metadata
    if (vi.youtube_video_id) {
      youtubeMetadata.push({
        video_id: vi.id,
        youtube_video_id: vi.youtube_video_id,
      });
    }
  }

  // ----------------------------------------------------------
  // 5. 統計
  // ----------------------------------------------------------
  const stats: ImportStats = {
    events: events.length,
    videos: videos.length,
    xUsers: xUsers.length,
    eventStaff: eventStaff.length,
    videoMembers: videoMembers.length,
    softwareLabels: softwareCatalogMap.size,
    warnings: warnings.length,
    errors: errors.length,
  };

  return {
    events,
    eventStaff,
    eventCustomQuestions,
    videos,
    videoEvents,
    videoMembers,
    videoCustomAnswers,
    videoNormExtras,
    xUsers,
    youtubeMetadata,
    warnings,
    errors,
    stats,
  };
}
