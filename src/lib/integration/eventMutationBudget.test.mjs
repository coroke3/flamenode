import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  AUDIT_INSERT_CHUNK_SIZE,
  D1_MAX_BATCH_QUERIES,
  D1_RESERVED_CALLER_QUERIES,
  planD1AuditMutationBudget,
} from "../audit/mutateBudget.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("共通plannerはaudit chunk、前処理、post-audit、caller予約を実数算定する", () => {
  assert.equal(AUDIT_INSERT_CHUNK_SIZE, 4);
  assert.equal(D1_RESERVED_CALLER_QUERIES, 10);
  assert.equal(D1_MAX_BATCH_QUERIES, 50);

  const createMax = planD1AuditMutationBudget({
    mutationStatementCount: 7,
    mutationAssertionCount: 7,
    auditEntryCount: 19,
    postAuditStatementCount: 0,
    distinctActorCount: 1,
  });
  assert.equal(createMax.auditChunkCount, 5);
  assert.equal(createMax.preparationQueryCount, 2);
  assert.equal(createMax.totalQueryCount, 36);
  assert.equal(createMax.withinLimit, true);

  const maxQuestions = 18;
  const updateWorstMutationCount = 1 + maxQuestions + 3;
  const updateWorstAuditCount = 1 + maxQuestions;
  const updateWorst = planD1AuditMutationBudget({
    mutationStatementCount: updateWorstMutationCount,
    mutationAssertionCount: updateWorstMutationCount,
    auditEntryCount: updateWorstAuditCount,
    postAuditStatementCount: 0,
    distinctActorCount: 1,
  });
  assert.equal(updateWorst.totalQueryCount, 66);
  assert.equal(updateWorst.withinLimit, false);

  const withPostAudit = planD1AuditMutationBudget({
    mutationStatementCount: 10,
    mutationAssertionCount: 10,
    auditEntryCount: 4,
    postAuditStatementCount: 7,
    distinctActorCount: 1,
  });
  assert.equal(withPostAudit.postAuditStatementCount, 7);
  assert.equal(withPostAudit.totalQueryCount, 41);
});

test("event question同期はbounded read、完全per-row snapshot、CASを持つ", () => {
  const source = read("src/lib/actions/event-admin.ts");

  assert.match(source, /MAX_EVENT_CUSTOM_QUESTIONS\s*=\s*18/);
  assert.match(source, /MAX_EVENT_CUSTOM_ANSWER_DELETE_ROWS\s*=\s*20/);
  assert.match(source, /MAX_QUESTIONS_PER_INSERT\s*=\s*6/);
  assert.match(source, /\.limit\(MAX_EVENT_CUSTOM_QUESTIONS \+ 1\)/);
  assert.match(
    source,
    /\.limit\(MAX_EVENT_CUSTOM_ANSWER_DELETE_ROWS \+ 1\)/,
  );
  assert.match(source, /questionInsertChunks\(questions\)/);
  assert.match(source, /questionInsertChunks\(insertedQuestions\)/);
  assert.match(
    source,
    /eq\(eventCustomQuestions\.updated_at, row\.updated_at\)/,
  );
  assert.match(
    source,
    /eq\(videoCustomAnswers\.updated_at, answer\.updated_at\)/,
  );
  assert.match(
    source,
    /operation:\s*"DELETE" as const,[\s\S]*before:\s*answer,[\s\S]*after:\s*null/,
  );
  assert.doesNotMatch(source, /before:\s*\{\s*rows:/);
  assert.doesNotMatch(source, /const answerCount = \(await db\.select/);
  assert.match(
    source,
    /fitsD1AtomicBatchBudget\(mutationStatements\.length, audits\.length\)/,
  );
});

test("manage statusは共通queue lease semanticsとcaller予約内のbounded readを使う", () => {
  const action = read("src/lib/actions/manage-video.ts");
  const hooks = read("src/lib/staticRebuild/hooks.ts");
  const enqueue = read("src/lib/staticRebuild/enqueue.ts");

  assert.match(action, /eq\(videos\.updated_at, target\.updated_at\)/);
  assert.match(action, /before:\s*\{ \.\.\.target \}, after:\s*\{ \.\.\.after \}/);
  assert.match(action, /planD1AuditMutationBudget/);
  assert.match(
    action,
    /\.limit\(MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS \+ 1\)/,
  );

  assert.match(hooks, /MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS\s*=\s*8/);
  assert.match(hooks, /return buildStaticRebuildQueueBatch\(db, items\)/);
  assert.doesNotMatch(hooks, /activeByEventId|lease_token:\s*null/);

  assert.match(enqueue, /MAX_STATIC_REBUILD_BATCH_TARGETS\s*=\s*16/);
  assert.match(enqueue, /STATIC_REBUILD_BATCH_PREFETCH_QUERY_COUNT\s*=\s*2/);
  assert.match(enqueue, /const \[activeRows, latestRows\] = await Promise\.all\(/);
  assert.equal(
    (enqueue.match(/\.limit\(MAX_STATIC_REBUILD_BATCH_TARGETS \+ 1\)/g) ?? [])
      .length,
    2,
  );
  assert.doesNotMatch(enqueue, /lease_token:\s*null/);
  assert.match(
    enqueue,
    /eq\([\s\S]*?staticRebuildQueue\.lease_token,[\s\S]*?item\.row\.lease_token/,
  );
  assert.match(enqueue, /isNull\(staticRebuildQueue\.lease_token\)/);

  const ownActionReads = 3;
  const permissionReads = 2;
  const notificationReads = 2;
  const queueReads = 2;
  assert.equal(
    ownActionReads + permissionReads + notificationReads + queueReads,
    9,
  );
  assert.ok(9 <= D1_RESERVED_CALLER_QUERIES);
});
