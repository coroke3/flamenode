import { and, eq, or } from "drizzle-orm";
import type { getDatabase } from "../cloudflare.ts";
import { videoCustomAnswers } from "../db/schema.ts";
import { expectedRowCondition } from "../audit/expectedRowCondition.ts";
import {
  compositeAuditTargetId,
  emptyVideoAtomicWritePlan,
  type VideoAtomicWritePlan,
} from "./atomicWritePlanCore.ts";

type DB = NonNullable<ReturnType<typeof getDatabase>>;
type VideoCustomAnswerRow = typeof videoCustomAnswers.$inferSelect;

/**
 * 作品の回答（一般の質問・ステージ許諾）を置き換える plan。
 * 既存行は読み取り時の全列を条件にした 1 文の DELETE で消し、新しい行は 1 文の
 * INSERT で入れる。どちらも件数を検査し、行ごとに audit を残す。
 */
export function buildVideoCustomAnswerReplacePlan(
  db: DB,
  input: {
    existing: readonly VideoCustomAnswerRow[];
    inserted: readonly VideoCustomAnswerRow[];
    actorUserId: string;
    context: string;
  },
): VideoAtomicWritePlan {
  const plan = emptyVideoAtomicWritePlan();
  const audit = (row: VideoCustomAnswerRow) => ({
    table_name: "video_custom_answers",
    target_id: compositeAuditTargetId(row.video_id, row.event_id, row.question_id),
    actor_user_id: input.actorUserId,
    context: input.context,
    retention_class: "normal" as const,
    strict: true,
  });
  if (input.existing.length > 0) {
    plan.statements.push(db.delete(videoCustomAnswers).where(or(...input.existing.map((row) => and(
      eq(videoCustomAnswers.video_id, row.video_id),
      eq(videoCustomAnswers.event_id, row.event_id),
      eq(videoCustomAnswers.question_id, row.question_id),
      expectedRowCondition({ expectedCurrent: row }),
    )!))!));
    plan.expectedChanges.push(input.existing.length);
    plan.audits.push(...input.existing.map((row) => ({
      ...audit(row),
      operation: "DELETE" as const,
      before: { ...row },
      after: null,
    })));
  }
  if (input.inserted.length > 0) {
    plan.statements.push(db.insert(videoCustomAnswers).values([...input.inserted]));
    plan.expectedChanges.push(input.inserted.length);
    plan.audits.push(...input.inserted.map((row) => ({
      ...audit(row),
      operation: "CREATE" as const,
      before: null,
      after: { ...row },
    })));
  }
  return plan;
}
