import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { createSqlite, runUnderRootTsx } from "./support/personalHarness.mjs";
import { createVideoStatusD1 } from "./support/videoStatusD1.mjs";

if (runUnderRootTsx(import.meta.url)) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      }
      if (specifier === "@opennextjs/cloudflare") {
        return {
          url: "data:text/javascript," + encodeURIComponent(
            "export function getCloudflareContext() { return globalThis.__visibilityGoldenContext; }",
          ),
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  process.env.NEXT_PUBLIC_SITE_URL = "https://flamenode.example.test";
  const { drizzle } = await import("drizzle-orm/d1");
  const { eq } = await import("drizzle-orm");
  const schema = await import("@flamenode/db/schema");
  const { planVideoVisibilityTransition: planCurrent } = await import(
    "../../../src/lib/video/videoVisibilityTransition.ts"
  );
  const { createVideoVisibilityTransitionHost } = await import(
    "../src/visibility/videoTransitionHost.ts"
  );
  const { planVideoVisibilityTransition: planShared } = await import(
    "@flamenode/server-core/visibility/videoTransition"
  );

  function seed(sqlite) {
    sqlite.exec(`
      INSERT INTO "user" (
        id, name, email, role, is_banned, discord_id, active_x_user_id,
        is_notification_enabled
      ) VALUES
        ('u-recipient', 'Recipient', 'r@example.test', 'user', 0, 'discord-r', NULL, 1),
        ('u-actor', 'Actor', 'a@example.test', 'admin', 0, 'discord-a', 'x_actor', 1);
      INSERT INTO x_users (id, x_name, approval_status)
        VALUES ('x_actor', 'Actor X', 'approved');
      INSERT INTO x_users (id, x_name, approval_status)
        VALUES ('x_creator', 'Creator X', 'approved');
      INSERT INTO events (id, title, visibility_status, created_at, updated_at)
        VALUES ('evt-1', 'Event One', 'public', 1000, 1000);
      INSERT INTO videos (
        id, primary_event_id, creator_x_user_id, submitted_by_user_id,
        creator_display_name, title, youtube_video_id, visibility_status,
        created_at, updated_at
      ) VALUES (
        'vid-1', 'evt-1', 'x_creator', 'u-recipient',
        'Creator', 'Video One', 'yt123', 'public', 1000, 1000
      );
    `);
  }

  // Execute the planned D1 writes against the migrated SQLite schema.
  // This tests persistence, not the full audit/R2 action adapter.
  function applyMutationPlan(sqlite, plan) {
    assert.equal(plan.mutationStatements.length, plan.expectedMutationChanges.length);
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (const [index, statement] of plan.mutationStatements.entries()) {
        const { sql, params } = statement;
        const result = sqlite.prepare(sql).run(...params);
        const expected = plan.expectedMutationChanges[index];
        if (expected !== null) {
          assert.equal(result.changes, expected, `mutation ${index + 1} changed rows`);
        }
      }
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
    return {
      video: sqlite.prepare("SELECT id, visibility_status, updated_at FROM videos WHERE id = ?").get("vid-1"),
      fences: sqlite.prepare("SELECT entity_type, entity_id, fence_token, state, blocked_at FROM public_visibility_fences ORDER BY entity_type, entity_id").all(),
      staticRebuildQueue: sqlite.prepare("SELECT * FROM static_rebuild_queue ORDER BY id").all(),
    };
  }

  function queryOf(statement) {
    const query = typeof statement.getQuery === "function"
      ? statement.getQuery()
      : statement.toSQL();
    return { sql: query.sql, params: query.params };
  }

  function snapshot(plan) {
    return {
      mutationStatements: plan.mutationStatements.map(queryOf),
      expectedMutationChanges: plan.expectedMutationChanges,
      audits: plan.audits,
      notificationBatch: {
        statements: plan.notificationBatch.statements.map(queryOf),
        expectedChanges: plan.notificationBatch.expectedChanges,
      },
      queueBatch: {
        statements: plan.queueBatch.statements.map(queryOf),
        expectedChanges: plan.queueBatch.expectedChanges,
        acceptedTargetCount: plan.queueBatch.acceptedTargetCount,
      },
      visibilityChanged: plan.visibilityChanged,
      fenceToken: plan.fenceToken,
      depublicizedFromPublic: plan.depublicizedFromPublic,
      publicCacheKeys: plan.publicCacheKeys,
      exportEventIds: plan.exportEventIds,
      validationError: plan.validationError,
    };
  }

  async function makePlan(nextStatus, useCurrent) {
    const sqlite = createSqlite();
    seed(sqlite);
    try {
      const d1 = createVideoStatusD1(sqlite);
      const db = drizzle(d1, { schema });
      const video = (
        await db.select().from(schema.videos)
          .where(eq(schema.videos.id, "vid-1")).limit(1)
      )[0];
      assert.ok(video);
      const bucket = { async get() { return null; }, async put() { return {}; } };
      globalThis.__visibilityGoldenContext = {
        env: { DB: d1, BUCKET: bucket, NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL },
        ctx: { waitUntil() {} },
      };
      const honoHost = createVideoVisibilityTransitionHost({
        env: { BUCKET: bucket, NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL },
      });
      let uuid = 0;
      const realRandomUUID = globalThis.crypto.randomUUID;
      const realNow = Date.now;
      globalThis.crypto.randomUUID = () =>
        `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`;
      Date.now = () => 1_760_000_000_000;
      try {
        const input = {
          video, nextStatus, actorUserId: "u-actor",
          context: "admin_video_status", reason: "differential fixture",
          eventIds: ["evt-1"], notificationEventId: "evt-1",
          now: 1_760_000_000,
        };
        const plan = useCurrent
          ? await planCurrent(db, input)
          : await planShared(db, input, honoHost);
        const planned = snapshot(plan);
        return { planned, persisted: applyMutationPlan(sqlite, planned) };
      } finally {
        Date.now = realNow;
        globalThis.crypto.randomUUID = realRandomUUID;
      }
    } finally {
      sqlite.close();
    }
  }

  for (const nextStatus of ["private", "voided"]) {
    test(`CURRENT and Hono transition planners match SQLite mutation/audit/outbox plans for ${nextStatus}`, async () => {
      const current = await makePlan(nextStatus, true);
      const hono = await makePlan(nextStatus, false);
      assert.deepEqual(hono, current);
      assert.equal(current.persisted.video.visibility_status, nextStatus);
      assert.equal(current.persisted.fences.length, 1);
      assert.equal(current.persisted.fences[0].state, "blocked");
      assert.ok(current.planned.mutationStatements.length > 0);
      assert.ok(current.planned.queueBatch.statements.length > 0);
      if (nextStatus === "voided") assert.equal(current.planned.notificationBatch.statements.length, 1);
      if (nextStatus === "private") {
        assert.equal(current.planned.notificationBatch.statements.length, 0);
        assert.equal(current.planned.depublicizedFromPublic, true);
        assert.ok(current.planned.fenceToken);
      }
    });
  }
}
