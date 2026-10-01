import assert from "node:assert/strict";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      }
      if (specifier === "@opennextjs/cloudflare") {
        return {
          url: `data:text/javascript,${encodeURIComponent(`
            export async function getCloudflareContext() {
              return { env: globalThis.__xidMergePreflightEnv };
            }
          `)}`,
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  const { executeApprovedXIdMergeRequest } = await import("./merge.ts");

  const tableName = (value) =>
    value?.[Symbol.for("drizzle:Name")] ?? "";

  function makeXUser(id, profileText = null) {
    return {
      id,
      x_name: `@${id}`,
      icon_url: null,
      profile_text: profileText,
      portfolio_contact: null,
      youtube_channel_url: null,
      other_social_links: null,
      creative_start_date: null,
      approval_status: "approved",
    };
  }

  function makeDb({ countOverrides = {}, sourceProfileText = null, videos = [] } = {}) {
    const counts = {
      active_users: 0,
      account_links: 0,
      videos: 0,
      video_chapters: 0,
      video_members: 0,
      slots: 0,
      slot_reservation_groups: 0,
      video_moderation_cases: 0,
      video_interactions: 0,
      event_staff: 0,
      aliases: 0,
      video_event_links: 0,
      ...countOverrides,
    };
    const rowsByTable = {
      x_users: [makeXUser("source", sourceProfileText), makeXUser("target")],
      videos,
      user: [],
      x_user_account_links: [],
      video_chapters: [],
      video_members: [],
      slots: [],
      slot_reservation_groups: [],
      video_moderation_cases: [],
      video_interactions: [],
      event_staff: [],
      x_user_aliases: [],
      video_events: [],
      public_visibility_fences: [],
    };
    const state = { batches: 0 };
    const chain = (rows) => {
      const result = Promise.resolve(rows);
      const api = {
        from(table) {
          return chain(rowsByTable[tableName(table)] ?? rows);
        },
        where() { return api; },
        leftJoin() { return api; },
        orderBy() { return api; },
        limit() { return result; },
        then(resolve, reject) { return result.then(resolve, reject); },
      };
      return api;
    };
    return {
      state,
      db: {
        select(selection) {
          return {
            from(table) {
              if (selection && Object.hasOwn(selection, "active_users")) {
                return chain([counts]);
              }
              return chain(rowsByTable[tableName(table)] ?? []);
            },
          };
        },
        insert() {
          return {
            values() {
              return { onConflictDoUpdate: () => ({}) };
            },
          };
        },
        run() { return {}; },
        async batch() {
          state.batches += 1;
          return [];
        },
      },
    };
  }

  const request = {
    id: "merge-1",
    request_type: "merge",
    status: "approved",
    source_x_user_id: "source",
    target_x_user_id: "target",
    updated_at: 10,
  };

  async function expectPreflightFailure(input, expected) {
    let r2Puts = 0;
    globalThis.__xidMergePreflightEnv = {
      BUCKET: {
        async get() { return null; },
        async put() { r2Puts += 1; },
      },
    };
    await assert.rejects(
      executeApprovedXIdMergeRequest(input.db, {
        request,
        actorAuthUserId: "admin-1",
      }),
      expected,
    );
    assert.equal(r2Puts, 0, "deterministic preflight must not PUT the R2 manifest");
    assert.equal(input.state.batches, 0, "deterministic preflight must not execute D1 writes");
  }

  test("snapshot row cap rejects before the R2 visibility precommit or D1 batch", async () => {
    await expectPreflightFailure(
      makeDb({ countOverrides: { videos: 501 } }),
      /x_id_merge_snapshot_row_limit_exceeded:videos/,
    );
  });

  test("snapshot UTF-8 byte cap rejects before the R2 visibility precommit or D1 batch", async () => {
    await expectPreflightFailure(
      makeDb({ sourceProfileText: "あ".repeat(400_000) }),
      /x_id_merge_snapshot_byte_limit_exceeded/,
    );
  });

  test("static rebuild target cap rejects before the R2 visibility precommit or D1 batch", async () => {
    const videos = Array.from({ length: 101 }, (_, index) => ({
      id: `video-${index}`,
      creator_x_user_id: "source",
      primary_event_id: null,
    }));
    await expectPreflightFailure(
      makeDb({ countOverrides: { videos: videos.length }, videos }),
      /x_id_merge_static_rebuild_target_limit_exceeded/,
    );
  });
}
