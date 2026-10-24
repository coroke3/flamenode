// MIG-0603 U02b parity: the REAL CURRENT Server Actions (src/lib/actions/chapter.ts:
// createChapter / updateChapter / deleteChapter / createChaptersBulk, with the real
// mutateWithAudit, buildStaticRebuildQueueBatch, canEditVideo, expectedRowCondition and
// parseChapterBulkCsv) run on one seeded real-schema database; the Hono endpoints run on
// an identical copy. Result, video_chapters, static_rebuild_queue and audit_logs must match
// byte for byte. Only the framework edges are stubbed: next/cache, next/navigation, the
// writeGuard result (guard parity has its own tests) and the Queue wake host (recorded).
import assert from "node:assert/strict";
import { test } from "node:test";
import { runUnderRootTsx, createSqlite } from "./support/personalHarness.mjs";
import { ACTIVE, atomicD1, chapterApp, seedChapterWorld } from "./support/chapterSeed.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  const stubs = {
    "server-only": "export {}",
    "next/cache": "export function revalidatePath() {}",
    "next/navigation":
      "export function unstable_rethrow() {} export function redirect() {} export function notFound() {}",
    "@/lib/auth/writeGuard": "export async function writeGuard(o) { return globalThis.__chapterGuard(o); }",
    "@/lib/serverCore/nextPorts":
      "export const nextQueueWakeHost = { readEnv: () => globalThis.__wakeEnv(), readWaitUntil: () => null, readKv: () => null };",
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier in stubs) {
        return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/d1");
  const { getTableColumns } = await import("drizzle-orm");
  const { SQLiteSyncDialect } = await import("drizzle-orm/sqlite-core");
  const S = await import("../../../src/lib/db/schema.ts");
  const actions = await import("../../../src/lib/actions/chapter.ts");
  const currentLimits = await import("../../../src/lib/actions/chapterLimits.ts");
  const currentEnqueue = await import("../../../src/lib/staticRebuild/enqueue.ts");
  const { QUEUE_BINDING_NAMES, QUEUE_FEATURE_FLAG_NAMES } = await import("../../../packages/server-core/src/queues/wakeBudget.ts");
  const { parseChapterBulkCsv } = await import("../src/routes/videos/chapterCsv.ts");
  const { CHAPTER_COLUMNS } = await import("../src/routes/videos/chapters.ts");
  const queueMine = await import("../src/audit/staticRebuildQueue.ts");

  const NOW_MS = 1_800_000_000_000;
  function freeze() {
    let n = 0;
    const originalNow = Date.now;
    const originalUuid = globalThis.crypto.randomUUID;
    Date.now = () => NOW_MS;
    globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    return () => {
      Date.now = originalNow;
      globalThis.crypto.randomUUID = originalUuid;
    };
  }

  function world() {
    const sqlite = createSqlite();
    seedChapterWorld(sqlite);
    return { sqlite, d1: atomicD1(sqlite) };
  }

  const approvedOf = (sqlite, userId) =>
    sqlite
      .prepare(
        `SELECT DISTINCT l.x_user_id AS id FROM x_user_account_links l
         JOIN x_users x ON x.id = l.x_user_id
         WHERE l.auth_user_id = ? AND x.approval_status = 'approved'`,
      )
      .all(userId)
      .map((row) => row.id);

  /** CURRENT: the real Server Action with a stubbed (successful) writeGuard for `as`. */
  async function runCurrent(w, as, action, fields) {
    const row = w.sqlite.prepare('SELECT id, name, role, active_x_user_id FROM "user" WHERE id = ?').get(as);
    const wakes = [];
    globalThis.__wakeEnv = () => ({
      [QUEUE_FEATURE_FLAG_NAMES.dispatch]: "1",
      [QUEUE_BINDING_NAMES.staticRebuildWake]: { send: async (message) => void wakes.push(message) },
    });
    globalThis.__chapterGuard = async (options) => {
      assert.equal(options.feature, "chapter_comment");
      assert.equal(options.requireApprovedActiveXId, true);
      return {
        ok: true,
        db: drizzle(w.d1),
        user: { id: row.id, name: row.name, role: row.role, active_x_user_id: row.active_x_user_id },
        activeXId: row.active_x_user_id,
        approvedXIds: approvedOf(w.sqlite, as),
        hasPendingXRequest: false,
      };
    };
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    // flow_trace / enqueue diagnostics of CURRENT go to console.log / warn.
    const { log, info, warn } = console;
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};
    try {
      return { result: JSON.parse(JSON.stringify(await actions[action](form))), wakes: wakes.length };
    } finally {
      console.log = log;
      console.info = info;
      console.warn = warn;
    }
  }

  const state = (w) => ({
    chapters: w.sqlite.prepare("SELECT * FROM video_chapters ORDER BY id").all().map((r) => ({ ...r })),
    queue: w.sqlite.prepare("SELECT * FROM static_rebuild_queue ORDER BY id").all().map((r) => ({ ...r })),
    audits: w.sqlite.prepare("SELECT * FROM audit_logs ORDER BY id").all().map((r) => ({ ...r })),
  });

  /** Hono: the same input through the endpoint; returns the JSON body normalised like the CURRENT result. */
  async function runMine(w, as, call) {
    const res = await chapterApp(w.d1, as)(call.method, call.path, call.body);
    return { status: res.status, result: await res.json() };
  }

  const USERS = ["u_admin", "u_owner", "u_staff", "u_other", "u_mod", "u_multi"];
  const SNAPSHOT = (as) => ACTIVE[as];

  async function compare(label, as, action, fields, call, { expectStatus } = {}) {
    const a = world();
    const b = world();
    const restore = freeze();
    let current;
    try {
      current = await runCurrent(a, as, action, fields);
    } finally {
      restore();
    }
    const restoreMine = freeze();
    const log = console.error;
    console.error = () => {};
    let mine;
    try {
      mine = await runMine(b, as, call);
    } finally {
      console.error = log;
      restoreMine();
    }
    // CURRENT's pendingPublicReflection / message / counters equal the endpoint body.
    assert.deepEqual(mine.result, current.result, `${label}: result`);
    assert.deepEqual(state(b), state(a), `${label}: database state`);
    if (expectStatus !== undefined) assert.equal(mine.status, expectStatus, `${label}: status`);
    return { current, mine, state: state(a) };
  }

  const CH = ["ch_owner", "ch_other", "ch_null", "ch_two", "ghost"];

  test("update: every user x chapter matches the real updateChapter (result, rows, queue, audit)", async () => {
    let allowed = 0;
    let denied = 0;
    for (const as of USERS) {
      for (const chapter of CH) {
        const fields = { video_id: "v_pub", chapter_id: chapter, chapter_time: "20", chapter_label: " Edited ", note: " n ", visibility: "private" };
        const { mine, current } = await compare(
          `update ${as} ${chapter}`, as, "updateChapter", fields,
          { method: "PUT", path: `/api/videos/chapters/${chapter}`, body: { chapter_time: "20", chapter_label: " Edited ", note: " n ", visibility: "private" } },
        );
        if (current.result.ok) allowed += 1;
        else denied += 1;
        assert.equal(mine.status, current.result.ok ? 200 : [403, 404].includes(mine.status) ? mine.status : -1);
      }
    }
    assert.deepEqual([allowed, denied], [14, 16], "the matrix covers both outcomes");
  });

  test("delete: every user x chapter matches the real deleteChapter (result, rows, queue, audit)", async () => {
    for (const as of USERS) {
      for (const chapter of CH) {
        await compare(
          `delete ${as} ${chapter}`, as, "deleteChapter", { chapter_id: chapter },
          { method: "DELETE", path: `/api/videos/chapters/${chapter}` },
        );
      }
    }
  });

  test("update: validation and the time rules match (empty/over-long/invalid/negative time, bad visibility)", async () => {
    const bodies = [
      { chapter_time: "20", chapter_label: "" },
      { chapter_time: "", chapter_label: "L" },
      { chapter_time: "9".repeat(33), chapter_label: "L" },
      { chapter_time: "abc", chapter_label: "L" },
      { chapter_time: "-5", chapter_label: "L" },
      { chapter_time: "90000", chapter_label: "L" },
      { chapter_time: "1:2:3:4", chapter_label: "L" },
      { chapter_time: "5", chapter_label: "L".repeat(121) },
      { chapter_time: "5", chapter_label: "L", note: "n".repeat(1001) },
      { chapter_time: "5", chapter_label: "L", visibility: "secret" },
      { chapter_time: "0:05", chapter_label: "ok" },
    ];
    for (const body of bodies) {
      await compare(
        `update ${JSON.stringify(body).slice(0, 40)}`, "u_owner", "updateChapter",
        { video_id: "v_pub", chapter_id: "ch_owner", ...body },
        { method: "PUT", path: "/api/videos/chapters/ch_owner", body },
      );
    }
  });

  test("create: every user x video x time matches the real createChapter (public only, duration cap, snapshot)", async () => {
    let created = 0;
    for (const as of USERS) {
      for (const [video, time] of [["v_pub", "1:30"], ["v_priv", "5"], ["v_dur", "120"], ["v_dur", "121"], ["ghost", "5"], ["v_pub", "x"]]) {
        const body = { chapter_time: time, chapter_label: "Intro", note: "hi", visibility: "public" };
        const { current } = await compare(
          `create ${as} ${video} ${time}`, as, "createChapter",
          { video_id: video, ...body, active_x_snapshot: SNAPSHOT(as) },
          { method: "POST", path: `/api/videos/${video}/chapters`, body: { ...body, active_x_snapshot: SNAPSHOT(as) } },
        );
        if (current.result.ok) created += 1;
      }
    }
    assert.equal(created, 12, "v_pub and v_dur@120s succeed for each of the 6 users");
    // stale / missing snapshot
    for (const snapshot of ["x_other", "", undefined]) {
      const body = { chapter_time: "5", chapter_label: "L", ...(snapshot === undefined ? {} : { active_x_snapshot: snapshot }) };
      await compare(
        `create snapshot ${snapshot}`, "u_owner", "createChapter", { video_id: "v_pub", ...body },
        { method: "POST", path: "/api/videos/v_pub/chapters", body },
      );
    }
  });

  const CSVS = [
    "time,label,note,visibility\n0:10,Intro,first,public\n1:00,Verse,,private\n,,,\n2:00,Chorus,third",
    "5,A\n6,B,note,PRIVATE\n7,C,,secret\nabc,D\n8,,,\n9," + "x".repeat(121),
    '1:00,"Quoted, label","multi\nline",public\r\n2:00,"He said ""hi""",,',
    "﻿time,label\n3,Bom",
    "label,time\n4,Swapped",
    Array.from({ length: 8 }, (_, i) => `${i + 1},L${i + 1}`).join("\n"),
    Array.from({ length: 9 }, (_, i) => `${i + 1},L${i + 1}`).join("\n"),
    "time,label",
    "\n\n",
    "99999,Too late\n121,Beyond",
  ];

  test("bulk: every user x CSV matches the real createChaptersBulk (permission, limits, row errors, audit)", async () => {
    let inserted = 0;
    const cases = [];
    for (const as of USERS) for (const csv of CSVS.slice(0, 3)) cases.push([as, csv, "v_pub"]);
    for (const csv of CSVS) for (const video of ["v_pub", "v_dur"]) cases.push(["u_admin", csv, video]);
    for (const [as, csv, video] of cases) {
      const { current } = await compare(
        `bulk ${as} ${video} ${csv.slice(0, 20)}`, as, "createChaptersBulk",
        { video_id: video, csv, active_x_snapshot: SNAPSHOT(as) },
        { method: "POST", path: `/api/videos/${video}/chapters/bulk`, body: { csv, active_x_snapshot: SNAPSHOT(as) } },
      );
      inserted += current.result.inserted ?? 0;
    }
    assert.ok(inserted > 30, `bulk inserted ${inserted}`);
    for (const [as, video] of [["u_admin", "v_priv"], ["u_admin", "ghost"], ["u_owner", "v_pub"]]) {
      await compare(
        `bulk ${as} ${video}`, as, "createChaptersBulk",
        { video_id: video, csv: "5,A", active_x_snapshot: SNAPSHOT(as) },
        { method: "POST", path: `/api/videos/${video}/chapters/bulk`, body: { csv: "5,A", active_x_snapshot: SNAPSHOT(as) } },
      );
    }
  });

  test("DOCUMENTED DIFFERENCE D-0603-1: CURRENT sends one static rebuild wake after commit, the endpoint sends none", async () => {
    const w = world();
    const restore = freeze();
    try {
      const { result, wakes } = await runCurrent(w, "u_owner", "createChapter", {
        video_id: "v_pub", chapter_time: "5", chapter_label: "L", active_x_snapshot: "x_owner",
      });
      assert.equal(result.ok, true);
      assert.equal(wakes, 1);
    } finally {
      restore();
    }
    const denied = world();
    const none = await runCurrent(denied, "u_other", "updateChapter", {
      video_id: "v_pub", chapter_id: "ch_owner", chapter_time: "5", chapter_label: "L",
    });
    assert.equal(none.wakes, 0, "no queue write, no wake");
  });

  // ---------- building blocks pinned against CURRENT ----------

  test("the chapter column order equals the CURRENT drizzle schema (audit JSON bytes)", () => {
    assert.deepEqual([...CHAPTER_COLUMNS], Object.keys(getTableColumns(S.videoChapters)));
  });

  test("the video queue statement equals CURRENT buildStaticRebuildQueueBatch for target video", async () => {
    const dialect = new SQLiteSyncDialect();
    const captured = [];
    const db = { run: (query) => (captured.push(dialect.sqlToQuery(query.getSQL ? query.getSQL() : query)), { kind: "run" }) };
    const restore = freeze();
    try {
      await currentEnqueue.buildStaticRebuildQueueBatch(db, [
        { targetType: "video", targetId: "v_pub", reason: "chapter_update", requestedByUserId: "u_owner" },
      ]);
    } finally {
      restore();
    }
    const restoreMine = freeze();
    let actual;
    try {
      actual = queueMine.buildStaticRebuildQueueStatement({
        targetType: "video", targetId: "v_pub", reason: "chapter_update", requestedByUserId: "u_owner",
      });
    } finally {
      restoreMine();
    }
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    assert.equal(norm(actual.statement.sql), norm(captured[0].sql));
    assert.deepEqual([...actual.statement.params], captured[0].params);
    assert.equal(actual.expectedChanges, 1);
  });

  test("parseChapterBulkCsv equals the real parser on fixtures and 3000 random inputs", () => {
    for (const csv of [...CSVS, "", "a", '"unterminated', 'a,"b""c",d\r\n\r\ne', ",,,", "time\r\n1,x", "\n1,x\n"]) {
      assert.deepEqual(parseChapterBulkCsv(csv), currentLimits.parseChapterBulkCsv(csv), JSON.stringify(csv));
    }
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    const alphabet = ['"', ",", "\n", "\r", "a", "time", "label", "visibility", " ", "1", "﻿", ":", "\t"];
    for (let i = 0; i < 3000; i += 1) {
      const length = next() % 24;
      let csv = "";
      for (let j = 0; j < length; j += 1) csv += alphabet[next() % alphabet.length];
      assert.deepEqual(parseChapterBulkCsv(csv), currentLimits.parseChapterBulkCsv(csv), JSON.stringify(csv));
    }
  });
} else {
  test("videoChapters parity (tsx child process)", () => {});
}
