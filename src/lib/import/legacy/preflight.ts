import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  auditLogs,
  eventCustomQuestions,
  events,
  videoCustomAnswers,
  videos,
} from "@/lib/db/schema";
import {
  MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO,
  type CanonicalLegacyPlan,
  type LegacyImportStrategy,
} from "./normalize";
import { compositeAuditTargetId } from "@/lib/video/atomicWritePlanCore";

const LEGACY_IMPORT_SYSTEM_USER_ID = "system_legacy_import";
const MAX_EVENT_CUSTOM_QUESTIONS = 18;
const LEGACY_CUSTOM_ANSWER_AUDIT_CONTEXT = "legacy_import:custom-answer";

export type LegacyImportPreflightResult = {
  existingEventIds: string[];
  existingVideoIds: string[];
};

function unique(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}

async function existingEventIds(db: DB, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const payload = JSON.stringify(unique(ids));
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(sql`${events.id} IN (SELECT value FROM json_each(${payload}))`);
  return new Set(rows.map((row) => row.id));
}

async function existingVideoRows(
  db: DB,
  ids: readonly string[],
): Promise<Map<string, { id: string; submittedBy: string | null; youtubeVideoId: string | null }>> {
  if (ids.length === 0) return new Map();
  const payload = JSON.stringify(unique(ids));
  const rows = await db
    .select({
      id: videos.id,
      submittedBy: videos.submitted_by_user_id,
      youtubeVideoId: videos.youtube_video_id,
    })
    .from(videos)
    .where(sql`${videos.id} IN (SELECT value FROM json_each(${payload}))`);
  return new Map(rows.map((row) => [row.id, row]));
}

async function importedEventIds(db: DB, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const payload = JSON.stringify(unique(ids));
  const rows = await db
    .select({ targetId: auditLogs.target_id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.table_name, "events"),
        eq(auditLogs.context, "legacy_import"),
        sql`${auditLogs.target_id} IN (SELECT value FROM json_each(${payload}))`,
      ),
    );
  return new Set(rows.map((row) => row.targetId));
}

async function youtubeOwners(
  db: DB,
  youtubeIds: readonly string[],
): Promise<Array<{ id: string; youtubeVideoId: string | null }>> {
  if (youtubeIds.length === 0) return [];
  const payload = JSON.stringify(unique(youtubeIds));
  return db
    .select({ id: videos.id, youtubeVideoId: videos.youtube_video_id })
    .from(videos)
    .where(sql`${videos.youtube_video_id} IN (SELECT value FROM json_each(${payload}))`);
}

type ExistingQuestion = typeof eventCustomQuestions.$inferSelect;
type PlannedQuestion = CanonicalLegacyPlan["eventCustomQuestions"][number];

function eventQuestionKey(eventId: string, questionKey: string): string {
  return `${eventId}:${questionKey}`;
}

function answerKey(videoId: string, eventId: string, questionId: string): string {
  return `${videoId}:${eventId}:${questionId}`;
}

function sameQuestionDefinition(current: ExistingQuestion, planned: PlannedQuestion): boolean {
  return (
    current.id === planned.id &&
    current.event_id === planned.event_id &&
    current.question_key === planned.question_key &&
    current.label === planned.label &&
    current.description === planned.description &&
    current.type === planned.type &&
    current.required === planned.required &&
    current.options_json === planned.options_json &&
    current.placeholder === planned.placeholder &&
    current.max_length === planned.max_length &&
    current.sort_order === planned.sort_order &&
    current.is_active === planned.is_active &&
    current.visibility === planned.visibility
  );
}

async function existingCustomQuestionRows(
  db: DB,
  eventIds: readonly string[],
  questionIds: readonly string[],
): Promise<ExistingQuestion[]> {
  const rows = new Map<string, ExistingQuestion>();
  if (eventIds.length > 0) {
    const payload = JSON.stringify(unique(eventIds));
    const found = await db
      .select()
      .from(eventCustomQuestions)
      .where(sql`${eventCustomQuestions.event_id} IN (SELECT value FROM json_each(${payload}))`);
    found.forEach((row) => rows.set(row.id, row));
  }
  if (questionIds.length > 0) {
    const payload = JSON.stringify(unique(questionIds));
    const found = await db
      .select()
      .from(eventCustomQuestions)
      .where(sql`${eventCustomQuestions.id} IN (SELECT value FROM json_each(${payload}))`);
    found.forEach((row) => rows.set(row.id, row));
  }
  return [...rows.values()];
}

type ExistingAnswer = typeof videoCustomAnswers.$inferSelect;

async function existingAnswersForVideos(
  db: DB,
  videoIds: readonly string[],
): Promise<ExistingAnswer[]> {
  if (videoIds.length === 0) return [];
  const payload = JSON.stringify(unique(videoIds));
  return db
    .select()
    .from(videoCustomAnswers)
    .where(sql`${videoCustomAnswers.video_id} IN (
      SELECT value FROM json_each(${payload})
    )`)
    .limit(videoIds.length * MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO + 1);
}

function answerMatchesAuditSnapshot(current: ExistingAnswer, raw: string | null): boolean {
  if (!raw) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const snapshot = parsed as Record<string, unknown>;
  return (
    snapshot.video_id === current.video_id &&
    snapshot.event_id === current.event_id &&
    snapshot.question_id === current.question_id &&
    snapshot.answer_text === current.answer_text &&
    snapshot.answer_json === current.answer_json &&
    snapshot.created_at === current.created_at &&
    snapshot.updated_at === current.updated_at
  );
}

async function latestImportedCustomAnswerTargets(
  db: DB,
  currentRows: readonly ExistingAnswer[],
): Promise<Set<string>> {
  if (currentRows.length === 0) return new Set();
  const byTarget = new Map(
    currentRows.map((row) => [
      compositeAuditTargetId(row.video_id, row.event_id, row.question_id),
      row,
    ]),
  );
  const payload = JSON.stringify([...byTarget.keys()]);
  const rows = await db
    .select({
      targetId: auditLogs.target_id,
      context: auditLogs.context,
      afterJson: auditLogs.after_json,
      createdAt: auditLogs.created_at,
    })
    .from(auditLogs)
    .where(and(
      eq(auditLogs.table_name, "video_custom_answers"),
      sql`${auditLogs.target_id} IN (SELECT value FROM json_each(${payload}))`,
      sql`${auditLogs.created_at} = (
        SELECT MAX(latest.created_at)
        FROM audit_logs AS latest
        WHERE latest.table_name = 'video_custom_answers'
          AND latest.target_id = ${auditLogs.target_id}
      )`,
    ))
    .limit(currentRows.length * 2 + 1);
  const rowsByTarget = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = rowsByTarget.get(row.targetId) ?? [];
    group.push(row);
    rowsByTarget.set(row.targetId, group);
  }
  const found = new Set<string>();
  for (const [targetId, current] of byTarget) {
    const latestRows = rowsByTarget.get(targetId) ?? [];
    if (
      latestRows.length === 1 &&
      latestRows[0].context === LEGACY_CUSTOM_ANSWER_AUDIT_CONTEXT &&
      answerMatchesAuditSnapshot(current, latestRows[0].afterJson)
    ) {
      found.add(targetId);
    }
  }
  return found;
}

export async function preflightLegacyImportPlan(
  db: DB,
  plan: CanonicalLegacyPlan,
  strategy: LegacyImportStrategy,
): Promise<LegacyImportPreflightResult> {
  if (plan.errors.length > 0) {
    throw new Error(plan.errors.join("\n"));
  }

  const errors: string[] = [];
  const planEventIds = unique(plan.events.map((row) => row.id));
  const planVideoIds = unique(plan.videos.map((row) => row.id));
  if (planEventIds.length !== plan.events.length) errors.push("plan内でイベントIDが重複しています。");
  if (planVideoIds.length !== plan.videos.length) errors.push("plan内で作品IDが重複しています。");
  const mappedDecisionLabels = new Map(
    plan.videoFieldDecisions
      .filter((decision) => decision.action === "custom_question")
      .map((decision) => [decision.source_key, decision.question_label]),
  );
  const questionsById = new Map<string, PlannedQuestion>();
  const questionsByEventKey = new Map<string, PlannedQuestion>();
  const plannedQuestionCountByEvent = new Map<string, number>();
  for (const question of plan.eventCustomQuestions) {
    const byEventKey = eventQuestionKey(question.event_id, question.question_key);
    if (questionsById.has(question.id)) errors.push(`カスタム質問ID ${question.id} が重複しています。`);
    if (questionsByEventKey.has(byEventKey)) {
      errors.push(`イベント ${question.event_id} の質問識別子 ${question.question_key} が重複しています。`);
    }
    questionsById.set(question.id, question);
    questionsByEventKey.set(byEventKey, question);
    plannedQuestionCountByEvent.set(
      question.event_id,
      (plannedQuestionCountByEvent.get(question.event_id) ?? 0) + 1,
    );
    if (!question.question_key.startsWith("legacy_import_")) {
      errors.push(`カスタム質問 ${question.id} の識別子が旧形式インポート用ではありません。`);
    }
    if (mappedDecisionLabels.get(question.source_key) !== question.label) {
      errors.push(`カスタム質問 ${question.id} と動画項目の判断内容が一致しません。`);
    }
    if (
      question.type !== "textarea" ||
      question.required !== 0 ||
      question.options_json !== null ||
      question.placeholder !== null ||
      question.max_length !== 1000 ||
      question.is_active !== 1 ||
      question.visibility !== "review"
    ) {
      errors.push(`カスタム質問 ${question.id} の定義が旧形式インポート契約と一致しません。`);
    }
  }
  for (const [eventId, count] of plannedQuestionCountByEvent) {
    if (count > MAX_EVENT_CUSTOM_QUESTIONS) {
      errors.push(`イベント ${eventId} のカスタム質問が最大${MAX_EVENT_CUSTOM_QUESTIONS}件を超えています。`);
    }
  }

  const videoEventKeys = new Set(
    plan.videoEvents.map((relation) => `${relation.video_id}:${relation.event_id}`),
  );
  const answerKeys = new Set<string>();
  const answerCountByVideo = new Map<string, number>();
  for (const answer of plan.videoCustomAnswers) {
    const key = answerKey(answer.video_id, answer.event_id, answer.question_id);
    if (answerKeys.has(key)) errors.push(`カスタム質問回答 ${key} が重複しています。`);
    answerKeys.add(key);
    answerCountByVideo.set(answer.video_id, (answerCountByVideo.get(answer.video_id) ?? 0) + 1);
    const question = questionsById.get(answer.question_id);
    if (!question) {
      errors.push(`カスタム質問回答 ${key} の質問がplanにありません。`);
    } else if (
      question.event_id !== answer.event_id ||
      question.question_key !== answer.question_key
    ) {
      errors.push(`カスタム質問回答 ${key} と質問定義のevent/keyが一致しません。`);
    }
    if (!planVideoIds.includes(answer.video_id)) {
      errors.push(`カスタム質問回答 ${key} の作品がplanにありません。`);
    }
    if (!videoEventKeys.has(`${answer.video_id}:${answer.event_id}`)) {
      errors.push(`カスタム質問回答 ${key} のイベントが作品へ関連付けられていません。`);
    }
    if (!answer.answer_text.trim() || answer.answer_text.length > 1000 || answer.answer_json !== null) {
      errors.push(`カスタム質問回答 ${key} の値が不正です。`);
    }
  }
  for (const [videoId, count] of answerCountByVideo) {
    if (count > MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO) {
      errors.push(
        `作品 ${videoId} のカスタム質問回答が最大${MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO}件を超えています。`,
      );
    }
  }

  for (const event of plan.events) {
    const ownerCount = plan.eventStaff.filter(
      (staff) => staff.event_id === event.id && staff.permission_preset === "owner",
    ).length;
    if (ownerCount < 1) errors.push(`イベント ${event.id} にownerがありません。`);
  }

  const [existingEvents, existingVideos] = await Promise.all([
    existingEventIds(db, planEventIds),
    existingVideoRows(db, planVideoIds),
  ]);

  if (strategy === "create_only") {
    existingEvents.forEach((id) => errors.push(`イベント ${id} は既に存在します。`));
    existingVideos.forEach((_, id) => errors.push(`作品 ${id} は既に存在します。`));
  }

  if (strategy === "replace_imported") {
    const importedEvents = await importedEventIds(db, [...existingEvents]);
    existingEvents.forEach((id) => {
      if (!importedEvents.has(id)) {
        errors.push(`イベント ${id} は旧形式インポート由来ではないため置換できません。`);
      }
    });
    existingVideos.forEach((row, id) => {
      if (row.submittedBy !== LEGACY_IMPORT_SYSTEM_USER_ID) {
        errors.push(`作品 ${id} は旧形式インポート由来ではないため置換できません。`);
      }
    });
  }

  const effectiveAnswers = plan.videoCustomAnswers.filter(
    (answer) => !(strategy === "skip_existing" && existingVideos.has(answer.video_id)),
  );
  const effectiveQuestionIds = new Set(effectiveAnswers.map((answer) => answer.question_id));
  const effectiveQuestions = plan.eventCustomQuestions.filter((question) =>
    effectiveQuestionIds.has(question.id),
  );
  const existingQuestions = await existingCustomQuestionRows(
    db,
    unique(effectiveQuestions.map((question) => question.event_id)),
    unique(effectiveQuestions.map((question) => question.id)),
  );
  const existingQuestionsById = new Map(existingQuestions.map((row) => [row.id, row]));
  const existingQuestionsByEventKey = new Map(
    existingQuestions.map((row) => [eventQuestionKey(row.event_id, row.question_key), row]),
  );
  const existingQuestionCountByEvent = new Map<string, number>();
  existingQuestions.forEach((row) => {
    existingQuestionCountByEvent.set(
      row.event_id,
      (existingQuestionCountByEvent.get(row.event_id) ?? 0) + 1,
    );
  });
  const newQuestionCountByEvent = new Map<string, number>();
  for (const question of effectiveQuestions) {
    const existingByKey = existingQuestionsByEventKey.get(
      eventQuestionKey(question.event_id, question.question_key),
    );
    const existingById = existingQuestionsById.get(question.id);
    if (existingByKey) {
      if (existingByKey.id !== question.id || !sameQuestionDefinition(existingByKey, question)) {
        errors.push(
          `イベント ${question.event_id} の質問 ${question.question_key} は既存定義と一致しません。`,
        );
      }
      continue;
    }
    if (existingById) {
      errors.push(`カスタム質問ID ${question.id} は別のイベントまたは質問で使用されています。`);
      continue;
    }
    newQuestionCountByEvent.set(
      question.event_id,
      (newQuestionCountByEvent.get(question.event_id) ?? 0) + 1,
    );
  }
  for (const eventId of unique([
    ...existingQuestionCountByEvent.keys(),
    ...newQuestionCountByEvent.keys(),
  ])) {
    const total =
      (existingQuestionCountByEvent.get(eventId) ?? 0) +
      (newQuestionCountByEvent.get(eventId) ?? 0);
    if (total > MAX_EVENT_CUSTOM_QUESTIONS) {
      errors.push(`イベント ${eventId} のカスタム質問が既存分を含めて最大${MAX_EVENT_CUSTOM_QUESTIONS}件を超えます。`);
    }
  }

  const mutableVideoIds = planVideoIds.filter(
    (videoId) => !(strategy === "skip_existing" && existingVideos.has(videoId)),
  );
  const existingAnswers = await existingAnswersForVideos(db, mutableVideoIds);
  const existingAnswersByVideo = new Map<string, ExistingAnswer[]>();
  for (const answer of existingAnswers) {
    const rows = existingAnswersByVideo.get(answer.video_id) ?? [];
    rows.push(answer);
    existingAnswersByVideo.set(answer.video_id, rows);
  }
  const changedAnswers: ExistingAnswer[] = [];
  for (const videoId of mutableVideoIds) {
    const currentRows = existingAnswersByVideo.get(videoId) ?? [];
    if (currentRows.length > MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO) {
      errors.push(
        `作品 ${videoId} の既存カスタム質問回答が最大${MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO}件を超えています。`,
      );
    }
    if (!existingVideos.has(videoId) && currentRows.length > 0) {
      errors.push(`未作成の作品 ${videoId} にカスタム質問回答が存在します。`);
    }

    const nextRows = new Map(
      currentRows.map((answer) => [
        answerKey(answer.video_id, answer.event_id, answer.question_id),
        {
          event_id: answer.event_id,
          question_id: answer.question_id,
          answer_text: answer.answer_text,
          answer_json: answer.answer_json,
        },
      ]),
    );
    for (const planned of effectiveAnswers.filter((answer) => answer.video_id === videoId)) {
      const key = answerKey(planned.video_id, planned.event_id, planned.question_id);
      const current = currentRows.find(
        (answer) => answerKey(answer.video_id, answer.event_id, answer.question_id) === key,
      );
      if (current && (!existingVideos.has(videoId) || strategy !== "replace_imported")) {
        errors.push(`カスタム質問回答 ${key} は既に存在するため作成できません。`);
      } else if (
        current &&
        (current.answer_text !== planned.answer_text || current.answer_json !== planned.answer_json)
      ) {
        changedAnswers.push(current);
      }
      nextRows.set(key, planned);
    }

    if (nextRows.size > MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO) {
      errors.push(
        `作品 ${videoId} の既存分を含むカスタム質問回答が最大${MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO}件を超えます。`,
      );
    }
    const nextEventIds = new Set(
      plan.videoEvents
        .filter((relation) => relation.video_id === videoId)
        .map((relation) => relation.event_id),
    );
    for (const next of nextRows.values()) {
      if (!nextEventIds.has(next.event_id)) {
        errors.push(
          `作品 ${videoId} のカスタム質問回答 ${next.question_id} は適用後のイベント関連に含まれません。`,
        );
      }
    }
  }
  const importedAnswerTargets = await latestImportedCustomAnswerTargets(db, changedAnswers);
  changedAnswers.forEach((current) => {
    const targetId = compositeAuditTargetId(
      current.video_id,
      current.event_id,
      current.question_id,
    );
    if (!importedAnswerTargets.has(targetId)) {
      errors.push(
        `カスタム質問回答 ${targetId} の最新状態を旧形式インポート由来と確認できないため置換できません。`,
      );
    }
  });

  const referencedEventIds = unique([
    ...plan.videos.map((row) => row.primary_event_id),
    ...plan.videoEvents.map((row) => row.event_id),
    ...plan.eventCustomQuestions.map((row) => row.event_id),
  ]);
  const externalEventIds = referencedEventIds.filter((id) => !planEventIds.includes(id));
  const existingExternalEvents = await existingEventIds(db, externalEventIds);
  externalEventIds.forEach((id) => {
    if (!existingExternalEvents.has(id)) {
      errors.push(`作品の所属イベント ${id} が存在せず、同じplanにも含まれていません。`);
    }
  });

  const incomingYoutubeIds = new Map<string, string>();
  for (const video of plan.videos) {
    if (!video.youtube_video_id) continue;
    if (strategy === "skip_existing" && existingVideos.has(video.id)) continue;
    const previous = incomingYoutubeIds.get(video.youtube_video_id);
    if (previous && previous !== video.id) {
      errors.push(
        `YouTube動画ID ${video.youtube_video_id} が作品 ${previous} と ${video.id} で重複しています。`,
      );
    } else {
      incomingYoutubeIds.set(video.youtube_video_id, video.id);
    }
  }

  const existingYoutubeOwners = await youtubeOwners(db, [...incomingYoutubeIds.keys()]);
  for (const row of existingYoutubeOwners) {
    if (!row.youtubeVideoId) continue;
    const incomingVideoId = incomingYoutubeIds.get(row.youtubeVideoId);
    if (incomingVideoId && incomingVideoId !== row.id) {
      errors.push(
        `YouTube動画ID ${row.youtubeVideoId} は既存作品 ${row.id} が使用しているため、作品 ${incomingVideoId} へ保存できません。`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return {
    existingEventIds: [...existingEvents].sort(),
    existingVideoIds: [...existingVideos.keys()].sort(),
  };
}
