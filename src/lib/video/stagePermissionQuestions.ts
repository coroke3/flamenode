import { and, eq, inArray } from "drizzle-orm";
import type { getDatabase } from "../cloudflare.ts";
import {
  eventCustomQuestions,
  videoCustomAnswers,
} from "../db/schema.ts";
import { generateId } from "../utils/id.ts";
import { resolveStagePermissionFieldsFromJson } from "./formSettings.ts";
import { stagePermissionQuestionKeyCondition } from "./stagePermissionAnswers.ts";

type DB = NonNullable<ReturnType<typeof getDatabase>>;

export async function syncStagePermissionCustomQuestions(
  db: DB,
  eventId: string,
  videoFormSettingsJson: string,
  now: number,
): Promise<void> {
  const fields = resolveStagePermissionFieldsFromJson([videoFormSettingsJson]);
  const existingQuestions = await db
    .select({
      id: eventCustomQuestions.id,
      question_key: eventCustomQuestions.question_key,
    })
    .from(eventCustomQuestions)
    .where(
      and(
        eq(eventCustomQuestions.event_id, eventId),
        stagePermissionQuestionKeyCondition(),
      )!,
    );

  const nextKeys = new Set(fields.map((field) => field.id));
  const staleQuestionIds = existingQuestions
    .filter((question) => !nextKeys.has(question.question_key))
    .map((question) => question.id);

  if (staleQuestionIds.length > 0) {
    await db
      .delete(videoCustomAnswers)
      .where(
        and(
          eq(videoCustomAnswers.event_id, eventId),
          inArray(videoCustomAnswers.question_id, staleQuestionIds),
        )!,
      );
    await db
      .delete(eventCustomQuestions)
      .where(
        and(
          eq(eventCustomQuestions.event_id, eventId),
          inArray(eventCustomQuestions.id, staleQuestionIds),
        )!,
      );
  }

  const existingByKey = new Map(
    existingQuestions.map((question) => [question.question_key, question]),
  );

  for (const [index, field] of fields.entries()) {
    const values = {
      event_id: eventId,
      question_key: field.id,
      label: field.label,
      description: field.description || null,
      type: "textarea" as const,
      required: field.required ? 1 : 0,
      options_json: null,
      placeholder: field.placeholder || null,
      max_length: 1000,
      sort_order: index,
      is_active: 1,
      visibility: "review" as const,
      updated_at: now,
    };
    const existing = existingByKey.get(field.id);
    if (existing) {
      await db
        .update(eventCustomQuestions)
        .set(values)
        .where(eq(eventCustomQuestions.id, existing.id));
      continue;
    }

    await db
      .insert(eventCustomQuestions)
      .values({
        id: generateId("ecq"),
        ...values,
        created_at: now,
      })
      .onConflictDoNothing();
  }
}
