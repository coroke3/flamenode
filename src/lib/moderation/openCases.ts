import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { ModerationCaseType } from "@/lib/admin/moderationCaseInput";
import { expectedRowCondition } from "@/lib/audit/adapters";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import type { DB } from "@/lib/db/client";
import { videoModerationCases } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";

export type ModerationCaseRow = typeof videoModerationCases.$inferSelect;

function snapshot(row: ModerationCaseRow): Record<string, unknown> {
  return { ...row };
}

export async function findOpenModerationCase(
  db: DB,
  videoId: string,
  caseType: ModerationCaseType,
): Promise<ModerationCaseRow | null> {
  const rows = await db
    .select()
    .from(videoModerationCases)
    .where(
      and(
        eq(videoModerationCases.video_id, videoId),
        eq(videoModerationCases.case_type, caseType),
        eq(videoModerationCases.status, "open"),
      )!,
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findOpenModerationCaseById(
  db: DB,
  caseId: string,
): Promise<ModerationCaseRow | null> {
  const rows = await db
    .select()
    .from(videoModerationCases)
    .where(eq(videoModerationCases.id, caseId))
    .limit(1);
  const row = rows[0];
  if (!row || row.status !== "open") return null;
  return row;
}

export type VoidModerationCasePlan = {
  statements: BatchItem<"sqlite">[];
  expectedChanges: (number | null)[];
  audits: WriteAuditLogInput[];
};

/** voided 化: 同一 video/case type の open case があれば更新、なければ INSERT */
export async function planVoidModerationCaseOpen(
  db: DB,
  input: {
    videoId: string;
    caseType: ModerationCaseType;
    publicReason: string | null;
    privateNote: string | null;
    actorUserId: string;
    now: number;
    auditContext: string;
  },
): Promise<VoidModerationCasePlan> {
  const existing = await findOpenModerationCase(db, input.videoId, input.caseType);
  if (existing) {
    const after: ModerationCaseRow = {
      ...existing,
      public_reason: input.publicReason,
      private_note: input.privateNote ?? existing.private_note,
    };
    return {
      statements: [
        db
          .update(videoModerationCases)
          .set({
            public_reason: after.public_reason,
            private_note: after.private_note,
          })
          .where(
            and(
              eq(videoModerationCases.id, existing.id),
              expectedRowCondition({ expectedCurrent: snapshot(existing) }),
            )!,
          ),
      ],
      expectedChanges: [1],
      audits: [
        {
          table_name: "video_moderation_cases",
          target_id: existing.id,
          operation: "UPDATE",
          before: snapshot(existing),
          after: snapshot(after),
          actor_user_id: input.actorUserId,
          context: input.auditContext,
          reason: input.publicReason || "open case を再利用して void 化",
          retention_class: "long_audit",
          strict: true,
        },
      ],
    };
  }

  const id = generateId("vmc");
  const caseAfter: ModerationCaseRow = {
    id,
    video_id: input.videoId,
    case_type: input.caseType,
    status: "open",
    public_reason: input.publicReason,
    private_note: input.privateNote,
    due_at: null,
    locked_until: null,
    attempt_count: 0,
    related_x_user_id: null,
    created_by_user_id: input.actorUserId,
    resolved_by_user_id: null,
    created_at: input.now,
    resolved_at: null,
  };
  return {
    statements: [db.run(sql`
      INSERT INTO video_moderation_cases (
        id, video_id, case_type, status, public_reason, private_note,
        due_at, locked_until, attempt_count, related_x_user_id,
        created_by_user_id, resolved_by_user_id, created_at, resolved_at
      )
      SELECT
        ${caseAfter.id}, ${caseAfter.video_id}, ${caseAfter.case_type},
        ${caseAfter.status}, ${caseAfter.public_reason}, ${caseAfter.private_note},
        ${caseAfter.due_at}, ${caseAfter.locked_until}, ${caseAfter.attempt_count},
        ${caseAfter.related_x_user_id}, ${caseAfter.created_by_user_id},
        ${caseAfter.resolved_by_user_id}, ${caseAfter.created_at},
        ${caseAfter.resolved_at}
      WHERE NOT EXISTS (
        SELECT 1
        FROM video_moderation_cases
        WHERE video_id = ${input.videoId}
          AND case_type = ${input.caseType}
          AND status = 'open'
      )
    `)],
    expectedChanges: [1],
    audits: [
      {
        table_name: "video_moderation_cases",
        target_id: id,
        operation: "CREATE",
        after: snapshot(caseAfter),
        actor_user_id: input.actorUserId,
        context: input.auditContext,
        reason: input.publicReason || "void 化に伴う moderation case 作成",
        retention_class: "long_audit",
        strict: true,
      },
    ],
  };
}

/** voided 解除: 既存 open case を resolved へ CAS。新規 resolved case は作らない */
export function planVoidModerationCaseResolve(
  db: DB,
  current: ModerationCaseRow,
  input: {
    actorUserId: string;
    now: number;
    privateNote?: string | null;
    auditContext: string;
    reason?: string | null;
  },
): VoidModerationCasePlan {
  const after: ModerationCaseRow = {
    ...current,
    status: "resolved",
    private_note: input.privateNote ?? current.private_note ?? "restored",
    resolved_by_user_id: input.actorUserId,
    resolved_at: input.now,
  };
  return {
    statements: [
      db
        .update(videoModerationCases)
        .set({
          status: "resolved",
          private_note: after.private_note,
          resolved_by_user_id: input.actorUserId,
          resolved_at: input.now,
        })
        .where(
          and(
            eq(videoModerationCases.id, current.id),
            eq(videoModerationCases.status, "open"),
            expectedRowCondition({ expectedCurrent: snapshot(current) }),
          )!,
        ),
    ],
    expectedChanges: [1],
    audits: [
      {
        table_name: "video_moderation_cases",
        target_id: current.id,
        operation: "UPDATE",
        before: snapshot(current),
        after: snapshot(after),
        actor_user_id: input.actorUserId,
        context: input.auditContext,
        reason: input.reason || "void 解除に伴う case 解決",
        retention_class: "long_audit",
        strict: true,
      },
    ],
  };
}
