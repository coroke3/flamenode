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

// Keep event-id IN predicates below D1's 100-bind ceiling while preserving
// the batch read used by the entry and dashboard forms.
const D1_STAGE_EVENT_ID_CHUNK_SIZE = 80;

function chunkIds(ids: readonly string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

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

export async function loadStagePermissionFormSettingsJson(
  db: DB,
  eventId: string,
): Promise<string | null> {
  const rows = await db
    .select({
      question_key: eventCustomQuestions.question_key,
      label: eventCustomQuestions.label,
      description: eventCustomQuestions.description,
      placeholder: eventCustomQuestions.placeholder,
      required: eventCustomQuestions.required,
      is_active: eventCustomQuestions.is_active,
      sort_order: eventCustomQuestions.sort_order,
    })
    .from(eventCustomQuestions)
    .where(
      and(
        eq(eventCustomQuestions.event_id, eventId),
        stagePermissionQuestionKeyCondition(),
      )!,
    )
    .orderBy(eventCustomQuestions.sort_order);

  if (rows.length === 0) return null;
  return JSON.stringify({
    stage_permissions: rows.map((row) => ({
      id: row.question_key,
      enabled: row.is_active === 1,
      required: row.required === 1,
      label: row.label,
      description: row.description ?? "",
      placeholder: row.placeholder ?? "",
    })),
  });
}

export async function loadStagePermissionFormSettingsJsonByEvents(
  db: DB,
  eventIds: readonly string[],
): Promise<Map<string, string | null>> {
  const ids = Array.from(new Set(eventIds.filter(Boolean)));
  const out = new Map<string, string | null>();
  if (ids.length === 0) return out;

  const rows: Array<{
    event_id: string;
    question_key: string;
    label: string;
    description: string | null;
    placeholder: string | null;
    required: number;
    is_active: number;
    sort_order: number;
  }> = [];
  for (const chunk of chunkIds(ids, D1_STAGE_EVENT_ID_CHUNK_SIZE)) {
    const chunkRows = await db
      .select({
        event_id: eventCustomQuestions.event_id,
        question_key: eventCustomQuestions.question_key,
        label: eventCustomQuestions.label,
        description: eventCustomQuestions.description,
        placeholder: eventCustomQuestions.placeholder,
        required: eventCustomQuestions.required,
        is_active: eventCustomQuestions.is_active,
        sort_order: eventCustomQuestions.sort_order,
      })
      .from(eventCustomQuestions)
      .where(
        and(
          inArray(eventCustomQuestions.event_id, chunk),
          stagePermissionQuestionKeyCondition(),
        )!,
      )
      .orderBy(eventCustomQuestions.event_id, eventCustomQuestions.sort_order);
    rows.push(...chunkRows);
  }

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = grouped.get(row.event_id) ?? [];
    list.push(row);
    grouped.set(row.event_id, list);
  }

  for (const eventId of ids) {
    const eventRows = grouped.get(eventId) ?? [];
    if (eventRows.length === 0) {
      out.set(eventId, null);
      continue;
    }
    out.set(
      eventId,
      JSON.stringify({
        stage_permissions: eventRows.map((row) => ({
          id: row.question_key,
          enabled: row.is_active === 1,
          required: row.required === 1,
          label: row.label,
          description: row.description ?? "",
          placeholder: row.placeholder ?? "",
        })),
      }),
    );
  }
  return out;
}
