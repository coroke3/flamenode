import assert from "node:assert/strict";
import { test } from "node:test";
import { cookie, createD1, createSqlite, insert, runUnderRootTsx } from "./support/personalHarness.mjs";
import { seed } from "./support/adminReadSeed.mjs";

// MIG-0635 parity test: Admin read APIs part C (videos/[id], members, users/[id]/edit).
// Compares /api/admin-read endpoints with CURRENT loaders (fetchVideoReviewDetail, getLinkedXUserIdsForAuthUser,
// and the drizzle queries from app/(admin)/admin/**/page.tsx).
if (runUnderRootTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { and, desc, eq } = await import("drizzle-orm");
  const S = await import("../../../src/lib/db/schema.ts");
  const { app } = await import("../src/app.ts");
  const { fetchVideoReviewDetail } = await import("../../../src/lib/admin/videoReviewDetail.ts");
  const { getLinkedXUserIdsForAuthUser } = await import("../../../src/lib/auth/xIdentity.ts");
  const { formatMemberChapterTime } = await import("../../../src/lib/video/memberInput.ts");
  const { extractVideoMemberIdFromChapterId } = await import("../../../src/lib/video/memberChapterProjection.ts");
  const {
    AdminVideoDetailResponseSchema,
    AdminVideoMembersResponseSchema,
    AdminUserEditResponseSchema,
  } = await import("../../../packages/contracts/src/adminRead.ts");

  const sqlite = createSqlite();
  seed(sqlite);
  const T0 = 1_700_000_000;
  insert(sqlite, "software_catalog", { id: "sw-1", name: "Blender", normalized_name: "blender", created_at: T0, updated_at: T0 });
  insert(sqlite, "video_softwares", { video_id: "av-pending-1", software_id: "sw-1", raw_label: "Blender 4.0" });
  const refDb = drizzle(async (text, params, method) => {
    const statement = sqlite.prepare(text);
    if (method === "run") {
      statement.run(...params);
      return { rows: [] };
    }
    const rows = statement.all(...params).map((row) => Object.values(row));
    return { rows: method === "get" ? rows[0] : rows };
  });

  const SECRET = "test-secret-mig-0625";
  const canon = (value) => JSON.parse(JSON.stringify(value ?? null));

  const parseBody = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  async function call(path, token, options = {}) {
    const d1 = options.d1 ?? createD1(sqlite);
    const headers = token ? cookie(token) : {};
    const res = await app.request(
      `/api/admin-read${path}`,
      { method: options.method ?? "GET", headers },
      { DB: d1, AUTH_SECRET: SECRET },
    );
    return {
      status: res.status,
      headers: res.headers,
      body: parseBody(await res.text()),
      stats: d1.stats,
    };
  }

  function instrumentedD1() {
    const log = [];
    const base = createD1(sqlite);
    return {
      log,
      prepare(query) {
        return {
          bind(...params) {
            log.push({ query, params });
            const stmt = base.prepare(query).bind(...params);
            return {
              first: () => stmt.first(),
              all: () => stmt.all(),
              run: () => stmt.run(),
            };
          },
        };
      },
    };
  }

  test("T01 videos/[id]: equals CURRENT fetchVideoReviewDetail and moderation cases", async () => {
    const videoId = "av-pending-1";
    const res = await call(`/videos/${videoId}?event=a-open`, "tok-root");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, no-store");

    const validated = AdminVideoDetailResponseSchema.parse(res.body);
    assert.equal(validated.event, "a-open");
    assert.equal(validated.truncated, false);

    // Parity with CURRENT fetchVideoReviewDetail
    const currentDetail = await fetchVideoReviewDetail(refDb, videoId);
    assert.ok(currentDetail);

    assert.equal(validated.video.id, currentDetail.id);
    assert.equal(validated.video.title, currentDetail.title);
    assert.equal(validated.video.creator_name, currentDetail.creator_name);
    assert.equal(validated.video.creator_x_user_id, currentDetail.creator_x_user_id);
    assert.equal(validated.video.created_at, currentDetail.created_at);
    assert.equal(validated.video.source_type, currentDetail.source_type);
    assert.equal(validated.video.youtube_video_id, currentDetail.youtube_video_id);
    assert.equal(validated.video.visibility_status, currentDetail.visibility_status);
    assert.equal(validated.video.software_label, currentDetail.software_label);
    assert.deepEqual(validated.video.event_ids.sort(), currentDetail.event_ids.sort());
    assert.deepEqual(validated.video.customAnswers, canon(currentDetail.customAnswers));
    assert.deepEqual(validated.video.members, canon(currentDetail.members));
    assert.equal(validated.video.stagePermission, currentDetail.stagePermission);

    // Parity with CURRENT moderation cases query
    const currentCases = await refDb
      .select({
        id: S.videoModerationCases.id,
        case_type: S.videoModerationCases.case_type,
        status: S.videoModerationCases.status,
        public_reason: S.videoModerationCases.public_reason,
        private_note: S.videoModerationCases.private_note,
        due_at: S.videoModerationCases.due_at,
        related_x_user_id: S.videoModerationCases.related_x_user_id,
        created_at: S.videoModerationCases.created_at,
        resolved_at: S.videoModerationCases.resolved_at,
      })
      .from(S.videoModerationCases)
      .where(eq(S.videoModerationCases.video_id, videoId))
      .orderBy(desc(S.videoModerationCases.created_at))
      .limit(20);

    assert.deepEqual(validated.moderationCases, canon(currentCases));
    const openCount = currentCases.filter((c) => c.status === "open").length;
    assert.equal(validated.openCaseCount, openCount);
    assert.equal(validated.openVoidCaseId, currentCases.find((c) => c.status === "open")?.id ?? null);
  });

  test("T01 videos/[id]/members: equals CURRENT AdminVideoMembersPage logic", async () => {
    const videoId = "av-pending-1";
    const res = await call(`/videos/${videoId}/members`, "tok-root");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, no-store");

    const validated = AdminVideoMembersResponseSchema.parse(res.body);

    // Parity with CURRENT page query
    const currentVideo = (
      await refDb
        .select({
          id: S.videos.id,
          title: S.videos.title,
          youtube_video_id: S.videos.youtube_video_id,
          collaboration_type: S.videos.collaboration_type,
        })
        .from(S.videos)
        .where(eq(S.videos.id, videoId))
        .limit(1)
    )[0];
    assert.deepEqual(validated.video, canon(currentVideo));

    const currentMemberRows = await refDb
      .select()
      .from(S.videoMembers)
      .where(
        and(
          eq(S.videoMembers.video_id, videoId),
          eq(S.videoMembers.is_public_member, 1),
        ),
      )
      .orderBy(S.videoMembers.order_index, S.videoMembers.id)
      .limit(101);

    const memberIds = currentMemberRows.map((m) => m.id);
    const chapterRows = await refDb
      .select()
      .from(S.videoChapters)
      .where(eq(S.videoChapters.video_id, videoId))
      .orderBy(S.videoChapters.chapter_time, S.videoChapters.id);

    const chaptersByMemberId = new Map();
    for (const ch of chapterRows) {
      const memberId = extractVideoMemberIdFromChapterId(ch.id);
      if (!memberId || !memberIds.includes(memberId)) continue;
      const list = chaptersByMemberId.get(memberId) ?? [];
      list.push(ch);
      chaptersByMemberId.set(memberId, list);
    }

    const expectedMembers = currentMemberRows.map((m) => ({
      name: m.name,
      x_user_id: m.x_user_id ?? "",
      role: m.role ?? "",
      comment: m.comment ?? "",
      order_index: m.order_index,
      can_edit: m.can_edit,
      is_public_member: m.is_public_member,
      chapters: (chaptersByMemberId.get(m.id) ?? []).map((ch) => ({
        time: formatMemberChapterTime(ch.chapter_time),
        label: ch.chapter_label,
        note: ch.note ?? "",
      })),
    }));

    assert.deepEqual(validated.initialMembers, expectedMembers);
    assert.equal(validated.initialMembers.length, 2);
    // Hidden member vm-hidden must be excluded
    assert.ok(!validated.initialMembers.some((m) => m.name === "Hidden Member"));
  });

  test("T01 users/[id]/edit: equals CURRENT AdminUserEditPage logic", async () => {
    const userId = "u_alice";
    const res = await call(`/users/${userId}/edit`, "tok-root");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, no-store");

    const validated = AdminUserEditResponseSchema.parse(res.body);

    const currentUser = (
      await refDb.select().from(S.users).where(eq(S.users.id, userId)).limit(1)
    )[0];
    const currentXIds = await getLinkedXUserIdsForAuthUser(refDb, userId);

    assert.equal(validated.user.id, currentUser.id);
    assert.equal(validated.user.name, currentUser.name);
    assert.equal(validated.user.role, currentUser.role ?? "user");
    assert.equal(validated.user.is_banned, currentUser.is_banned ?? 0);
    assert.equal(validated.user.can_create_events, currentUser.can_create_events ?? 0);
    assert.equal(validated.user.is_notification_enabled, currentUser.is_notification_enabled ?? 1);
    assert.deepEqual(validated.xUserIds.sort(), currentXIds.sort());

    // Also verify moderator user u_bob
    const resBob = await call(`/users/u_bob/edit`, "tok-root");
    assert.equal(resBob.status, 200);
    const validatedBob = AdminUserEditResponseSchema.parse(resBob.body);
    assert.equal(validatedBob.user.role, "moderator");
    assert.equal(validatedBob.user.can_create_events, 1);
    assert.equal(validatedBob.user.is_notification_enabled, 0);
  });

  test("T02 404 on missing resource or member overflow (> 100 members)", async () => {
    const resVideo404 = await call("/videos/non-existent-video", "tok-root");
    assert.equal(resVideo404.status, 404);
    assert.deepEqual(resVideo404.body, { error: "Not Found" });

    const resMembers404 = await call("/videos/non-existent-video/members", "tok-root");
    assert.equal(resMembers404.status, 404);
    assert.deepEqual(resMembers404.body, { error: "Not Found" });

    const resUser404 = await call("/users/non-existent-user/edit", "tok-root");
    assert.equal(resUser404.status, 404);
    assert.deepEqual(resUser404.body, { error: "Not Found" });

    // av-overflow has 101 members -> 404 per CURRENT
    const resOverflow = await call("/videos/av-overflow/members", "tok-root");
    assert.equal(resOverflow.status, 404);
    assert.deepEqual(resOverflow.body, { error: "Not Found" });
  });

  test("T03 Auth & role guards: guest 401, regular user / moderator / banned admin 403, admin 200", async () => {
    const paths = [
      "/videos/av-pending-1",
      "/videos/av-pending-1/members",
      "/users/u_alice/edit",
    ];

    for (const p of paths) {
      // Guest
      const guestRes = await call(p, null);
      assert.equal(guestRes.status, 401, `${p} guest`);
      assert.deepEqual(guestRes.body, { error: "Unauthorized" });

      // Regular user
      const userRes = await call(p, "tok-alice");
      assert.equal(userRes.status, 403, `${p} regular user`);
      assert.deepEqual(userRes.body, { error: "Forbidden", redirect: "/dashboard" });

      // Moderator
      const modRes = await call(p, "tok-bob");
      assert.equal(modRes.status, 403, `${p} moderator`);
      assert.deepEqual(modRes.body, { error: "Forbidden", redirect: "/dashboard" });

      // Banned admin
      const badminRes = await call(p, "tok-badmin");
      assert.equal(badminRes.status, 403, `${p} banned admin`);
      assert.deepEqual(badminRes.body, { error: "Forbidden", message: "User is banned" });

      // Clean admin
      const adminRes = await call(p, "tok-root");
      assert.equal(adminRes.status, 200, `${p} admin`);
    }
  });

  test("T04 D1 statement count and bind budgets (S2 <= 3 statements incl session, binds <= 100)", async () => {
    // 1. /videos/:id: 1 session + 1 review detail + 1 moderation cases = 3 statements
    const d1Video = instrumentedD1();
    await call("/videos/av-pending-1", "tok-root", { d1: d1Video });
    assert.ok(d1Video.log.length <= 3, `videoDetail statements: ${d1Video.log.length}`);
    for (const entry of d1Video.log) {
      assert.ok(entry.params.length <= 100, `bind count ${entry.params.length} > 100 in ${entry.query}`);
    }

    // 2. /videos/:id/members: 1 session + 1 video + 1 members/chapters = 3 statements
    const d1Members = instrumentedD1();
    await call("/videos/av-pending-1/members", "tok-root", { d1: d1Members });
    assert.ok(d1Members.log.length <= 3, `videoMembers statements: ${d1Members.log.length}`);
    for (const entry of d1Members.log) {
      assert.ok(entry.params.length <= 100, `bind count ${entry.params.length} > 100 in ${entry.query}`);
    }

    // 3. /users/:id/edit: 1 session + 1 user/xids = 2 statements
    const d1User = instrumentedD1();
    await call("/users/u_alice/edit", "tok-root", { d1: d1User });
    assert.ok(d1User.log.length <= 2, `userEdit statements: ${d1User.log.length}`);
    for (const entry of d1User.log) {
      assert.ok(entry.params.length <= 100, `bind count ${entry.params.length} > 100 in ${entry.query}`);
    }
  });

  test("T05 D1 failure returns 503 {error: 'unavailable'}", async () => {
    const failingD1 = () => {
      const base = createD1(sqlite);
      const origPrepare = base.prepare;
      base.prepare = (text) => {
        if (/FROM\s+(?:videos|"user")/i.test(text)) {
          throw new Error("D1 connection lost");
        }
        return origPrepare(text);
      };
      return base;
    };

    for (const path of ["/videos/av-pending-1", "/videos/av-pending-1/members", "/users/u_alice/edit"]) {
      const res = await call(path, "tok-root", { d1: failingD1() });
      assert.equal(res.status, 503, path);
      assert.deepEqual(res.body, { error: "unavailable" }, path);
    }
  });
}
