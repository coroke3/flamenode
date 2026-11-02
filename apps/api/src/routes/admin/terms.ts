/**
 * MIG-0642 U02 (SA-051..055): terms version admin writes on Hono.
 * CURRENT: src/lib/actions/rules.ts.
 *   SA-051 POST   /            admin_terms_create     (no queue)
 *   SA-052 PATCH  /:id         admin_terms_update     (no queue)
 *   SA-053 POST   /:id/publish admin_terms_publish    (rules/global rebuild row in the same batch)
 *   SA-054 POST   /:id/reaccept-broadcast admin_terms_broadcast (no DM, no outbox, no queue)
 *   SA-055 POST   /:id/archive admin_terms_archive    (rebuild row only if it was published)
 * Every write is full-row CAS + strict `long_audit` in one D1 batch. D-0603-1:
 * CURRENT wakes the static-rebuild Queue after publish / archive; this Worker
 * never wakes (DOCUMENTED DIFFERENCE: the Cron drains the rows, wake CURRENT n -> Hono 0).
 * Next revalidatePath has no Hono equivalent. The path id is authoritative.
 */
import {
  decideTermsPublish,
  nextTermsPublishedAt,
  parseTermsDraftInput,
  parseTermsReacceptBroadcastInput,
} from "@flamenode/domain/admin";
import {
  AdminTermsDraftBodySchema,
  AdminTermsReacceptBroadcastBodySchema,
  type AdminTermsNotificationsResult,
} from "@flamenode/contracts";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import type { WriteAuditLogInput } from "@flamenode/server-core/audit/types";
import { generateId } from "@flamenode/server-core/id";
import { sql } from "@flamenode/server-core/sql";
import { buildStaticRebuildQueueBatch } from "@flamenode/server-core/staticRebuild/enqueue";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../env.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "./body.ts";

export const TERMS_CONFLICT_MESSAGE =
  "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。";
export const TERMS_REACCEPT_BATCH_SIZE = 30;

// Drizzle column order of packages/db schema `terms_versions` (audit JSON key order).
export const TERMS_COLUMNS = [
  "id",
  "version_label",
  "body_markdown",
  "status",
  "severity",
  "published_at",
  "created_by_user_id",
  "created_at",
  "updated_at",
] as const;
const COLUMN_LIST = TERMS_COLUMNS.map((column) => `"${column}"`).join(", ");

type TermsRow = Record<(typeof TERMS_COLUMNS)[number], unknown> & {
  id: string;
  status: string | null;
  published_at: number | null;
};

type Status = 200 | 400 | 404 | 409 | 413;
const respond = (c: Context<AppEnv>, status: Status, body: AdminTermsNotificationsResult) =>
  c.json(body, status);

function setClause(values: Record<string, unknown>) {
  return sql.join(
    Object.entries(values).map(
      ([key, value]) => sql`${sql.raw('"' + key.replaceAll('"', '""') + '"')} = ${value}`,
    ),
    sql`, `,
  );
}

async function loadTerms(c: Context<AppEnv>, id: string): Promise<TermsRow | null> {
  return c.env.DB
    .prepare(`SELECT ${COLUMN_LIST} FROM terms_versions WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<TermsRow>();
}

/** Bounded JSON read (413) + shape check (400). Value rules stay in the domain validators. */
async function readBody(
  c: Context<AppEnv>,
  schema: { safeParse: (value: unknown) => { success: boolean } },
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; res: Response }> {
  const read = await readAdminJsonBody(c.req.raw);
  if (read.kind === "too_large") {
    return { ok: false, res: respond(c, 413, { ok: false, message: BODY_TOO_LARGE_MESSAGE }) };
  }
  if (read.kind !== "ok" || !schema.safeParse(read.value).success) {
    return { ok: false, res: respond(c, 400, { ok: false, message: "入力エラー" }) };
  }
  return { ok: true, body: read.value };
}

function termsAudit(
  c: Context<AppEnv>,
  before: TermsRow,
  after: Record<string, unknown>,
  context: string,
  reason?: string,
): WriteAuditLogInput {
  return {
    table_name: "terms_versions",
    target_id: before.id,
    operation: "UPDATE",
    before: { ...before },
    after,
    actor_user_id: c.get("user")!.id,
    retention_class: "long_audit",
    context,
    ...(reason === undefined ? {} : { reason }),
    strict: true,
  };
}

function casUpdate(c: Context<AppEnv>, before: TermsRow, patch: Record<string, unknown>) {
  return c.get("db").run(sql`
    UPDATE terms_versions SET ${setClause(patch)}
    WHERE id = ${before.id} AND ${expectedRowCondition({ expectedCurrent: { ...before } })}
  `);
}

async function commit(
  c: Context<AppEnv>,
  input: {
    statements: ReturnType<typeof casUpdate>[];
    expected: number[];
    audits: WriteAuditLogInput[];
  },
): Promise<boolean> {
  try {
    await mutateWithAudit(c.get("db"), {
      mutationStatements: input.statements,
      expectedMutationChanges: input.expected,
      preloaded: auditPreloaded(c),
      audits: input.audits,
    });
    return true;
  } catch {
    // Do not log provider exception text (may carry SQL or secrets).
    console.error("[rules] atomic mutation failed");
    return false;
  }
}

export const adminTermsRoutes = new Hono<AppEnv>();

// Never let a failed preflight D1 read or a late binding getter throw into Hono's
// default error handler. Keep the provider error out of logs and responses.
adminTermsRoutes.onError((_error, c) => {
  c.header("Cache-Control", "private, no-store");
  return c.json<AdminTermsNotificationsResult>(
    { ok: false, message: "管理操作を処理できませんでした。再度お試しください。" },
    503,
  );
});
adminTermsRoutes.use("/:id/publish", onlyMutating(costGuardMiddleware("admin_terms_publish")));
adminTermsRoutes.use("/:id/reaccept-broadcast", onlyMutating(costGuardMiddleware("admin_terms_broadcast")));
adminTermsRoutes.use("/:id/archive", onlyMutating(costGuardMiddleware("admin_terms_archive")));
adminTermsRoutes.use("/", onlyMutating(costGuardMiddleware("admin_terms_create")));
adminTermsRoutes.use("/:id", onlyMutating(costGuardMiddleware("admin_terms_update")));

// SA-051 createTermsVersion
adminTermsRoutes.post("/", async (c) => {
  const req = await readBody(c, AdminTermsDraftBodySchema);
  if (!req.ok) return req.res;
  const parsed = parseTermsDraftInput(req.body);
  if (!parsed.ok) return respond(c, 400, parsed);
  const d = parsed.draft;
  const id = d.id?.trim() || generateId("tv");
  const userId = c.get("user")!.id;
  const now = Math.floor(Date.now() / 1000);
  const after = {
    id,
    version_label: d.version_label,
    body_markdown: d.body_markdown,
    status: "draft",
    severity: d.severity,
    published_at: null,
    created_by_user_id: userId,
    created_at: now,
    updated_at: now,
  };
  const db = c.get("db");
  try {
    await mutateWithAudit(db, {
      mutationStatements: [
        db.run(sql`
          INSERT INTO terms_versions (${sql.raw(COLUMN_LIST)})
          VALUES (${sql.join(TERMS_COLUMNS.map((column) => sql`${after[column]}`), sql`, `)})
        `),
      ],
      expectedMutationChanges: 1,
      preloaded: auditPreloaded(c),
      audits: [
        {
          table_name: "terms_versions",
          target_id: id,
          operation: "CREATE",
          after: { ...after },
          actor_user_id: userId,
          retention_class: "long_audit",
          context: "admin_terms_create",
          strict: true,
        },
      ],
    });
  } catch {
    console.error("[rules] atomic mutation failed");
    return respond(c, 409, { ok: false, message: TERMS_CONFLICT_MESSAGE });
  }
  return respond(c, 200, { ok: true, id });
});

// SA-052 updateTermsVersion
adminTermsRoutes.patch("/:id", async (c) => {
  const req = await readBody(c, AdminTermsDraftBodySchema);
  if (!req.ok) return req.res;
  const parsed = parseTermsDraftInput({ ...req.body, id: c.req.param("id") });
  if (!parsed.ok) return respond(c, 400, parsed);
  const d = parsed.draft;
  if (!d.id) return respond(c, 400, { ok: false, message: "id が必要です。" });
  const before = await loadTerms(c, d.id);
  if (!before) return respond(c, 404, { ok: false, message: "対象が見つかりません。" });
  if (before.status !== "draft") {
    return respond(c, 409, { ok: false, message: "下書き状態のバージョンのみ編集できます。" });
  }
  const patch = {
    version_label: d.version_label,
    body_markdown: d.body_markdown,
    severity: d.severity,
    updated_at: Math.floor(Date.now() / 1000),
  };
  const ok = await commit(c, {
    statements: [casUpdate(c, before, patch)],
    expected: [1],
    audits: [termsAudit(c, before, { ...before, ...patch }, "admin_terms_update")],
  });
  if (!ok) return respond(c, 409, { ok: false, message: TERMS_CONFLICT_MESSAGE });
  return respond(c, 200, { ok: true, id: d.id });
});

// SA-053 publishTermsVersion
adminTermsRoutes.post("/:id/publish", async (c) => {
  const id = c.req.param("id").trim();
  if (!id) return respond(c, 400, { ok: false, message: "id が必要です。" });
  // target + up to 2 published rows in one D1 read (CURRENT: two reads).
  const { results } = await c.env.DB
    .prepare(
      `SELECT * FROM (SELECT 'target' AS _kind, ${COLUMN_LIST} FROM terms_versions WHERE id = ? LIMIT 1)
       UNION ALL
       SELECT * FROM (SELECT 'published' AS _kind, ${COLUMN_LIST} FROM terms_versions WHERE status = 'published' LIMIT 2)`,
    )
    .bind(id)
    .all<TermsRow & { _kind: "target" | "published" }>();
  const strip = ({ _kind, ...row }: TermsRow & { _kind: string }): TermsRow => row as TermsRow;
  const target = (results ?? []).filter((r) => r._kind === "target").map(strip)[0];
  if (!target) return respond(c, 404, { ok: false, message: "対象が見つかりません。" });
  const decision = decideTermsPublish(target.status);
  if (decision.kind === "rejected") return respond(c, 409, { ok: false, message: decision.message });
  if (decision.kind === "already_published") return respond(c, 200, { ok: true, id });
  const published = (results ?? []).filter((r) => r._kind === "published").map(strip);
  if (published.length > 1) {
    return respond(c, 409, { ok: false, message: "公開中の規約が複数存在するため処理を停止しました。" });
  }
  const current = published[0];
  const now = nextTermsPublishedAt(Math.floor(Date.now() / 1000), current?.published_at);
  const statements: ReturnType<typeof casUpdate>[] = [];
  const expected: number[] = [];
  const audits: WriteAuditLogInput[] = [];
  if (current) {
    const patch = { status: "archived", updated_at: now };
    statements.push(casUpdate(c, current, patch));
    expected.push(1);
    audits.push(
      termsAudit(c, current, { ...current, ...patch }, "admin_terms_publish", "新しい規約公開に伴う旧版アーカイブ"),
    );
  }
  const patch = { status: "published", published_at: now, updated_at: now };
  statements.push(casUpdate(c, target, patch));
  expected.push(1);
  audits.push(termsAudit(c, target, { ...target, ...patch }, "admin_terms_publish", "規約版の公開"));
  let ok = false;
  try {
    const queue = await buildStaticRebuildQueueBatch(c.get("db"), [
      {
        targetType: "rules",
        targetId: "global",
        reason: "admin_terms_publish",
        priority: "high",
        requestedByUserId: c.get("user")!.id,
      },
    ]);
    ok = await commit(c, {
      statements: [...statements, ...(queue.statements as typeof statements)],
      expected: [...expected, ...queue.expectedChanges],
      audits,
    });
  } catch {
    console.error("[rules] atomic mutation failed");
  }
  if (!ok) return respond(c, 409, { ok: false, message: TERMS_CONFLICT_MESSAGE });
  return respond(c, 200, { ok: true, id, pendingPublicReflection: true });
});

// SA-054 broadcastTermsReaccept (no Discord DM, no outbox row, no queue)
adminTermsRoutes.post("/:id/reaccept-broadcast", async (c) => {
  const req = await readBody(c, AdminTermsReacceptBroadcastBodySchema);
  if (!req.ok) return req.res;
  const input = parseTermsReacceptBroadcastInput({
    termsId: c.req.param("id"),
    confirm: req.body.confirm,
    cursor: req.body.cursor,
    content: req.body.content,
  });
  if (!input.ok) return respond(c, 400, input);
  const { termsId, cursor, content } = input;

  // target + latest published major (CURRENT getLatestPublishedMajorTerms) in one read.
  const found = await c.env.DB
    .prepare(
      `SELECT ${COLUMN_LIST},
         (SELECT id FROM terms_versions WHERE severity = 'major' AND published_at IS NOT NULL
            ORDER BY published_at DESC, updated_at DESC LIMIT 1) AS _major_id,
         (SELECT published_at FROM terms_versions WHERE severity = 'major' AND published_at IS NOT NULL
            ORDER BY published_at DESC, updated_at DESC LIMIT 1) AS _major_published_at
       FROM terms_versions WHERE id = ? LIMIT 1`,
    )
    .bind(termsId)
    .first<TermsRow & { _major_id: string | null; _major_published_at: number | null }>();
  if (!found) return respond(c, 404, { ok: false, message: "公開中の規約だけ通知できます。" });
  const { _major_id, _major_published_at, ...target } = found;
  if (target.status !== "published") {
    return respond(c, 409, { ok: false, message: "公開中の規約だけ通知できます。" });
  }
  if (!_major_id) {
    return respond(c, 200, { ok: true, message: "再同意が必要なmajor規約はありません。", enqueued: 0, cursor });
  }

  // termsReacceptRequiredCondition: published_at 0/null matches no one (CURRENT `0 = 1`).
  let userIds: string[] = [];
  if (_major_published_at) {
    const { results } = await c.env.DB
      .prepare(
        `SELECT u.id AS user_id FROM "user" u
         WHERE u.is_tos_accepted = 1
           AND NOT (
             EXISTS (
               SELECT 1 FROM terms_versions accepted_terms
               WHERE accepted_terms.id = u.accepted_terms_version_id
                 AND accepted_terms.published_at IS NOT NULL
                 AND (accepted_terms.id = ? OR accepted_terms.published_at > ?)
             )
             OR EXISTS (
               SELECT 1 FROM user_tos_consents consent
               INNER JOIN terms_versions consent_terms ON consent_terms.id = consent.terms_version_id
               WHERE consent.user_id = u.id
                 AND consent_terms.published_at IS NOT NULL
                 AND (consent_terms.id = ? OR consent_terms.published_at > ?)
             )
           )
           AND u.is_notification_enabled = 1
           ${cursor ? "AND u.id > ?" : ""}
         ORDER BY u.id LIMIT ?`,
      )
      .bind(
        _major_id,
        _major_published_at,
        _major_id,
        _major_published_at,
        ...(cursor ? [cursor] : []),
        TERMS_REACCEPT_BATCH_SIZE + 1,
      )
      .all<{ user_id: string }>();
    userIds = (results ?? []).map((r) => r.user_id);
  }
  const targets = userIds.slice(0, TERMS_REACCEPT_BATCH_SIZE);
  if (targets.length === 0) {
    return respond(c, 200, { ok: true, message: "対象がありません。", enqueued: 0, cursor });
  }

  // No Discord DM terms_reaccept_required; the on-site re-accept notice stays.
  const now = Math.floor(Date.now() / 1000);
  const noteSuffix = content ? ` note=${content.slice(0, 80)}` : "";
  const patch = { updated_at: now };
  const ok = await commit(c, {
    statements: [casUpdate(c, target, patch)],
    expected: [1],
    audits: [
      termsAudit(
        c,
        target,
        { ...target, ...patch },
        "admin_terms_broadcast",
        `再同意案内（DMなし） batch cursor=${cursor} targets=${targets.length}${noteSuffix}`,
      ),
    ],
  });
  if (!ok) return respond(c, 409, { ok: false, message: TERMS_CONFLICT_MESSAGE });
  return respond(c, 200, {
    ok: true,
    message: "Discord DM は送信しません。対象ユーザーにはサイト上の再同意案内が表示されます。",
    enqueued: 0,
    cursor: targets.at(-1) ?? cursor,
  });
});

// SA-055 archiveTermsVersion
adminTermsRoutes.post("/:id/archive", async (c) => {
  const id = c.req.param("id").trim();
  if (!id) return respond(c, 400, { ok: false, message: "id が必要です。" });
  const before = await loadTerms(c, id);
  if (!before) return respond(c, 404, { ok: false, message: "対象が見つかりません。" });
  const wasPublished = before.status === "published";
  const patch = { status: "archived", updated_at: Math.floor(Date.now() / 1000) };
  let ok = false;
  try {
    const queue = wasPublished
      ? await buildStaticRebuildQueueBatch(c.get("db"), [
          {
            targetType: "rules",
            targetId: "global",
            reason: "admin_terms_archive",
            priority: "high",
            requestedByUserId: c.get("user")!.id,
          },
        ])
      : null;
    ok = await commit(c, {
      statements: [casUpdate(c, before, patch), ...((queue?.statements ?? []) as ReturnType<typeof casUpdate>[])],
      expected: [1, ...(queue?.expectedChanges ?? [])],
      audits: [termsAudit(c, before, { ...before, ...patch }, "admin_terms_archive", "規約版のアーカイブ")],
    });
  } catch {
    console.error("[rules] atomic mutation failed");
  }
  if (!ok) return respond(c, 409, { ok: false, message: TERMS_CONFLICT_MESSAGE });
  return respond(c, 200, wasPublished ? { ok: true, id, pendingPublicReflection: true } : { ok: true, id });
});
