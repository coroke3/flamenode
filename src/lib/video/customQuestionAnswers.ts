import { and, asc, eq, inArray, not, or } from "drizzle-orm";
import type { getDatabase } from "@/lib/cloudflare";
import {
  eventCustomQuestions,
  videoCustomAnswers,
} from "@/lib/db/schema";
import {
  type CustomAnswerDraft,
  type CustomQuestion,
  type CustomQuestionRow,
  rowToQuestion,
} from "./customQuestions";
import { customQuestionToDraft, type EventGeneralCustomQuestionDraft } from "@/lib/event/generalCustomQuestionDraft";
import { stagePermissionQuestionKeyCondition } from "./stagePermissionAnswers";
import {
  compositeAuditTargetId,
  emptyVideoAtomicWritePlan,
  type VideoAtomicWritePlan,
} from "@/lib/video/atomicWritePlan";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS } from "@/lib/video/atomicLimits";
/** イベントごとの業務上限。複数イベントをまとめて読むためグローバル上限にしない。 */
export const MAX_VIDEO_CUSTOM_QUESTIONS_READ = 18;

export function maxQuestionsForEvents(eventIds: readonly string[]): number {
  return Math.max(1, new Set(eventIds.filter(Boolean)).size) *
    MAX_VIDEO_CUSTOM_QUESTIONS_READ;
}

const D1_CUSTOM_QUESTION_EVENT_ID_CHUNK_SIZE = 80;

function chunkEventIds(ids: readonly string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

function assertQuestionRowsWithinPerEventLimit(
  rows: readonly Pick<CustomQuestionRow, "event_id">[],
): void {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const count = (counts.get(row.event_id) ?? 0) + 1;
    if (count > MAX_VIDEO_CUSTOM_QUESTIONS_READ) {
      throw new Error("video_custom_question_read_limit_exceeded");
    }
    counts.set(row.event_id, count);
  }
}

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

  const maxQuestions = maxQuestionsForEvents(eventIds);
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
    .orderBy(
      asc(eventCustomQuestions.event_id),
      asc(eventCustomQuestions.sort_order),
      asc(eventCustomQuestions.id),
    )
    .limit(maxQuestions + 1);
  if (questions.length > maxQuestions) {
    throw new Error("video_custom_question_read_limit_exceeded");
  }
  assertQuestionRowsWithinPerEventLimit(questions);

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

  const rows: CustomQuestionRow[] = [];
  for (const chunk of chunkEventIds(ids, D1_CUSTOM_QUESTION_EVENT_ID_CHUNK_SIZE)) {
    const maxQuestions = maxQuestionsForEvents(chunk);
    const chunkRows = await db
      .select()
      .from(eventCustomQuestions)
      .where(
        and(
          inArray(eventCustomQuestions.event_id, chunk),
          eq(eventCustomQuestions.is_active, 1),
          not(stagePermissionQuestionKeyCondition()),
        )!,
      )
      .orderBy(
        asc(eventCustomQuestions.event_id),
        asc(eventCustomQuestions.sort_order),
        asc(eventCustomQuestions.id),
      )
      .limit(maxQuestions + 1);
    if (chunkRows.length > maxQuestions) {
      throw new Error("video_custom_question_read_limit_exceeded");
    }
    assertQuestionRowsWithinPerEventLimit(chunkRows);
    rows.push(...chunkRows);
  }

  for (const row of rows) {
    const list = out.get(row.event_id) ?? [];
    list.push(rowToQuestion(row));
    out.set(row.event_id, list);
  }
  return out;
}

export async function loadGeneralCustomQuestionsForEvent(
  db: DB,
  eventId: string,
): Promise<EventGeneralCustomQuestionDraft[]> {
  const rows = await db
    .select()
    .from(eventCustomQuestions)
    .where(
      and(
        eq(eventCustomQuestions.event_id, eventId),
        not(stagePermissionQuestionKeyCondition()),
      )!,
    )
    .orderBy(
      asc(eventCustomQuestions.sort_order),
      asc(eventCustomQuestions.id),
    )
    .limit(MAX_VIDEO_CUSTOM_QUESTIONS_READ + 1);
  if (rows.length > MAX_VIDEO_CUSTOM_QUESTIONS_READ) {
    throw new Error("video_custom_question_read_limit_exceeded");
  }
  return rows.map((row) => customQuestionToDraft(rowToQuestion(row)));
}
