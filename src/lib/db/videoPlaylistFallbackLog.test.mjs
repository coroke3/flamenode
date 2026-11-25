import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { logEventPlaylistFallback } = await import("./videoPlaylistFallbackLog.ts");
  const source = readFileSync(new URL("./videoDetailQueries.ts", import.meta.url), "utf8");
  const entry = "export async function fetchEventPlaylistVideos(";
  assert.ok(source.includes(entry), "test must execute the real CURRENT playlist function");
  const output = ts.transpileModule(source.slice(source.indexOf(entry)), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const video = {
    id: "vid-public", title: "Public", youtube_video_id: "aaaaaaaaaaa",
    display_name: "Creator", scheduled_time: 100,
  };

  function fixture(r2, { mode = "off", blockedEvent = false, changedEtag = false,
    manifestMissing = false } = {}) {
    let queries = 0;
    let manifestReads = 0;
    const db = {
      select() {
        const step = ++queries;
        return {
          from() { return this; },
          where() { return this; },
          innerJoin() { return this; },
          orderBy() { return this; },
          limit() {
            return Promise.resolve(step === 1 ? [{ visibility_status: "public" }] : [video]);
          },
        };
      },
    };
    const exports = {};
    const schema = { id: "id", visibility_status: "status",
      title: "title", youtube_video_id: "youtube_video_id",
      scheduled_time: "scheduled_time" };
    const context = {
      exports,
      getEnv: () => ({ BUCKET: r2 }),
      resolvePublicVisibilityGuardModeFromEnv: () => mode,
      readPublicVisibilityBlockedEntitiesManifest: async () => {
        manifestReads++;
        if (manifestMissing) return { manifest: null, etag: null };
        return { manifest: { entities: [] }, etag: changedEtag && manifestReads > 1 ? "new" : "old" };
      },
      isEntityBlockedInManifest: (_m, kind) => blockedEvent && kind === "event",
      eventPlaylistObjectKey: id => `events/${id}/playlist.v1.json`,
      EVENT_PLAYLIST_MAX_OBJECT_BYTES: 1048576,
      normalizeStaticEventPlaylist: p => p && Array.isArray(p.items) && typeof p.complete === "boolean" ? p : null,
      logEventPlaylistFallback,
      cancelR2BodyBestEffort: async () => {},
      events: schema, videos: schema,
      storedCreatorNameExpr: "display_name",
      countablePublicVideoCondition: {},
      eventPublicVideoLinkCondition: () => ({}),
      eq: () => ({}), and: () => ({}),
      sql: () => ({}),
      uniqueBy: (rows, getKey) => Array.from(new Map(rows.map(row => [getKey(row), row])).values()),
    };
    vm.runInNewContext(output, context, { filename: "videoDetailQueries.ts.transpiled" });
    return {
      fetch: () => exports.fetchEventPlaylistVideos(db, "public-event", 50),
      get queries() { return queries; },
    };
  }

  async function withWarning(warn, run) {
    const descriptor = Object.getOwnPropertyDescriptor(console, "warn");
    Object.defineProperty(console, "warn", { configurable: true, value: warn, writable: true });
    try { return await run(); } finally {
      if (descriptor) Object.defineProperty(console, "warn", descriptor);
      else delete console.warn;
    }
  }

  test("SEC-810: warning payload preserves four fixed reasons and original event ID", async () => {
    const warnings = [];
    await withWarning(value => warnings.push(value), async () => {
      for (const reason of ["r2_missing", "r2_invalid", "r2_incomplete", "r2_error"]) {
        logEventPlaylistFallback("public-event", reason);
      }
    });
    assert.deepEqual(warnings.map(value => JSON.parse(value)), [
      "r2_missing", "r2_invalid", "r2_incomplete", "r2_error",
    ].map(reason => ({ event: "event_playlist_d1_fallback", reason, event_id: "public-event" })));
  });

  test("SEC-810: throwing diagnostic sink never prevents R2 miss, malformed or incomplete -> D1", async () => {
    await withWarning(() => { throw Error("logger unavailable"); }, async () => {
      for (const r2 of [
        { get: async () => null },
        { get: async () => ({ text: async () => "invalid JSON" }) },
        { get: async () => ({ text: async () => JSON.stringify({ items: [], complete: false }) }) },
        { get: async () => ({ size: 1048577, text: async () => "unreachable" }) },
      ]) {
        const f = fixture(r2);
        assert.deepEqual(JSON.parse(JSON.stringify(await f.fetch())), [video]);
        assert.equal(f.queries, 2, "the public D1 fallback must run after the diagnostic");
      }
    });
  });

  test("SEC-810: rejected R2 get/text and throwing warn property do not block public D1", async () => {
    const cases = [
      { get: async () => { throw Error("R2 get failed"); } },
      { get: async () => ({ text: async () => { throw Error("R2 body failed"); } }) },
    ];
    await withWarning(() => { throw Error("logger failed"); }, async () => {
      for (const r2 of cases) {
        const f = fixture(r2);
        assert.deepEqual(JSON.parse(JSON.stringify(await f.fetch())), [video]);
        assert.equal(f.queries, 2);
      }
    });

    const previous = Object.getOwnPropertyDescriptor(console, "warn");
    Object.defineProperty(console, "warn", {
      configurable: true,
      get() { throw Error("warn getter failed"); },
    });
    try {
      const f = fixture({ get: async () => null });
      assert.deepEqual(JSON.parse(JSON.stringify(await f.fetch())), [video]);
    } finally {
      if (previous) Object.defineProperty(console, "warn", previous);
      else delete console.warn;
    }
  });

  test("SEC-810: enforce mode continues to block missing manifest, revoked event and changed ETag", async () => {
    await withWarning(() => { throw Error("logger failed"); }, async () => {
      const r2 = { get: async () => null };
      for (const setup of [
        { mode: "enforce", manifestMissing: true },
        { mode: "enforce", blockedEvent: true },
        { mode: "enforce", changedEtag: true },
      ]) {
        const f = fixture(r2, setup);
        assert.deepEqual(JSON.parse(JSON.stringify(await f.fetch())), []);
        assert.equal(f.queries, setup.blockedEvent ? 1 : setup.manifestMissing ? 1 : 2);
      }
    });
  });
}
