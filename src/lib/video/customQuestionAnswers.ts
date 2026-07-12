import { and, eq, inArray, not, or } from "drizzle-orm";
import type { getDatabase } from "@/lib/cloudflare";
import {
  eventCustomQuestions,
  videoCustomAnswers,
} from "@/lib/db/schema";
import {
  type CustomAnswerDraft,
  type CustomQuestion,
  rowToQuestion,
} from "./customQuestions";
import { stagePermissionQuestionKeyCondition } from "./stagePermissionAnswers";
import {
  compositeAuditTargetId,
  emptyVideoAtomicWritePlan,
  type VideoAtomicWritePlan,
} from "@/lib/video/atomicWritePlan";
import { expectedRowCondition } from "@/lib/audit/adapters";

export const MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS = 4;
export const MAX_VIDEO_CUSTOM_QUESTIONS_READ = 18;

type DB = NonNullable<ReturnType<typeof getDatabase>>;

export async function buildReplaceGeneralCustomAnswersPlan(
  db: DB,
  args: {
    videoId: string;
    eventIds: readonly string[];
    drafts: CustomAnswerDraft[];
    now: number;
    actorUserId: string;
  },
): Promise<VideoAtomicWritePlan> {
  const eventIds = Array.from(new Set(args.eventIds.filter(Boolean)));
  if (eventIds.length === 0) return emptyVideoAtomicWritePlan();
  if (args.drafts.length > MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS) {
    throw new Error("video_custom_answer_atomic_limit_exceeded");
  }

  const questions = await db
    .select({
      id: eventCustomQuestions.id,
      event_id: eventCustomQuestions.event_id,
      question_key: eventCustomQuestions.question_key,
    })
    .from(eventCustomQuestions)
    .where(
      and(
        inArray(eventCustomQuestions.event_id, eventIds),
        eq(eventCustomQuestions.is_active, 1),
        not(stagePermissionQuestionKeyCondition()),
      )!,
    )
    .limit(MAX_VIDEO_CUSTOM_QUESTIONS_READ + 1);
  if (questions.length > MAX_VIDEO_CUSTOM_QUESTIONS_READ) {
    throw new Error("video_custom_question_read_limit_exceeded");
  }

  if (questions.length === 0) return emptyVideoAtomicWritePlan();

  const questionIds = questions.map((q) => q.id);
  const draftByQuestionId = new Map(
    args.drafts.map((draft) => [draft.question_id, draft]),
  );

  const existing = await db
    .select()
    .from(videoCustomAnswers)
    .where(and(
      eq(videoCustomAnswers.video_id, args.videoId),
      inArray(videoCustomAnswers.event_id, eventIds),
      inArray(videoCustomAnswers.question_id, questionIds),
    )!)
    .limit(MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS + 1);
  if (existing.length > MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS) {
    throw new Error("video_custom_answer_existing_atomic_limit_exceeded");
  }
  const next: (typeof videoCustomAnswers.$inferSelect)[] = [];
  for (const question of questions) {
    const draft = draftByQuestionId.get(question.id);
    if (!draft) continue;
    const hasText = Boolean(draft.answer_text?.trim());
    const hasJson = Boolean(draft.answer_json?.trim());
    if (!hasText && !hasJson) continue;

    next.push({
      video_id: args.videoId,
      event_id: question.event_id,
      question_id: question.id,
      answer_text: draft.answer_text,
      answer_json: draft.answer_json,
      created_at: args.now,
      updated_at: args.now,
    });
  }
  const plan = emptyVideoAtomicWritePlan();
  if (existing.length > 0) {
    plan.statements.push(db.delete(videoCustomAnswers).where(or(...existing.map((row) => and(
      eq(videoCustomAnswers.video_id, row.video_id),
      eq(videoCustomAnswers.event_id, row.event_id),
      eq(videoCustomAnswers.question_id, row.question_id),
      expectedRowCondition({ expectedCurrent: row }),
    )!))!));
    plan.expectedChanges.push(existing.length);
    plan.audits.push(...existing.map((row) => ({
      table_name: "video_custom_answers",
      target_id: compositeAuditTargetId(row.video_id, row.event_id, row.question_id),
      operation: "DELETE" as const,
      before: { ...row },
      after: null,
      actor_user_id: args.actorUserId,
      context: "video-save:custom-answers",
      retention_class: "normal" as const,
      strict: true,
    })));
  }
  if (next.length > 0) {
    plan.statements.push(db.insert(videoCustomAnswers).values(next));
    plan.expectedChanges.push(next.length);
    plan.audits.push(...next.map((row) => ({
      table_name: "video_custom_answers",
      target_id: compositeAuditTargetId(row.video_id, row.event_id, row.question_id),
      operation: "CREATE" as const,
      before: null,
      after: { ...row },
      actor_user_id: args.actorUserId,
      context: "video-save:custom-answers",
      retention_class: "normal" as const,
      strict: true,
    })));
  }
  return plan;
}

export async function fetchActiveCustomQuestionsForEvents(
  db: DB,
  eventIds: readonly string[],
): Promise<Map<string, CustomQuestion[]>> {
  const ids = Array.from(new Set(eventIds.filter(Boolean)));
  const out = new Map<string, CustomQuestion[]>();
  if (ids.length === 0) return out;

  const rows = await db
    .select()
    .from(eventCustomQuestions)
    .where(
      and(
        inArray(eventCustomQuestions.event_id, ids),
        eq(eventCustomQuestions.is_active, 1),
        not(stagePermissionQuestionKeyCondition()),
      )!,
    )
    .orderBy(eventCustomQuestions.sort_order)
    .limit(MAX_VIDEO_CUSTOM_QUESTIONS_READ + 1);
  if (rows.length > MAX_VIDEO_CUSTOM_QUESTIONS_READ) {
    throw new Error("video_custom_question_read_limit_exceeded");
  }

  for (const row of rows) {
    const list = out.get(row.event_id) ?? [];
    list.push(rowToQuestion(row));
    out.set(row.event_id, list);
  }
  return out;
}
