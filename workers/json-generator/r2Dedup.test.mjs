import assert from "node:assert/strict";
import { test } from "node:test";
import {
  staticArtifactContentHash,
  staticArtifactCustomMetadata,
  resolveIdenticalJsonArtifactPut,
  ArtifactHashCache,
  serializeJsonArtifact,
  putJsonArtifact,
} from "./r2Dedup.ts";
import { assertNoForbiddenPublicKeys } from "./sanitize.ts";

async function hash(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Buffer.from(digest).toString("hex");
}

function createEnv({ storedHash, metadataHash, hasObject = true }) {
  const calls = { head: 0, select: 0 };
  const object = {
    key: "top.json",
    etag: "etag",
    version: "v1",
    size: 1,
    ...(metadataHash ? { customMetadata: { content_hash: metadataHash } } : {}),
  };
  const R2 = {
    async head() {
      calls.head += 1;
      return hasObject ? object : null;
    },
  };
  const DB = {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              calls.select += 1;
              return storedHash ? { content_hash: storedHash } : null;
            },
          };
        },
      };
    },
  };
  return { env: { DB, R2 }, calls, object };
}

test("R2 content_hashが一致する場合はD1を読まずPUTを省略する", async () => {
  const body = JSON.stringify({ ok: true });
  const contentHash = await staticArtifactContentHash(body);
  const fixture = createEnv({ storedHash: await hash(body), metadataHash: contentHash });
  const result = await resolveIdenticalJsonArtifactPut(fixture.env, "top.json", body, contentHash);
  assert.ok(result);
  assert.equal(result.skipPut, true);
  assert.equal(result.object, fixture.object);
  assert.equal(fixture.calls.head, 1);
  assert.equal(fixture.calls.select, 0);
});

test("legacy R2 object uses one D1 fallback and is rewritten with metadata", async () => {
  const body = JSON.stringify({ schema_version: 4, generation: "gen-a", ok: true });
  const contentHash = await staticArtifactContentHash(body);
  const fixture = createEnv({ storedHash: contentHash });
  const result = await resolveIdenticalJsonArtifactPut(fixture.env, "top.json", body, contentHash);
  assert.ok(result);
  assert.equal(result.skipPut, false);
  assert.equal(fixture.calls.head, 1);
  assert.equal(fixture.calls.select, 1);
  assert.deepEqual(staticArtifactCustomMetadata(body, contentHash), {
    content_hash: contentHash,
    schema_version: "4",
    source_generation: "gen-a",
  });
});

test("DB hashが一致してもR2実体が欠落していればPUTへフォールバックする", async () => {
  const body = JSON.stringify({ ok: true });
  const fixture = createEnv({
    storedHash: await hash(body),
    hasObject: false,
  });
  const result = await resolveIdenticalJsonArtifactPut(
    fixture.env,
    "top.json",
    body,
    await staticArtifactContentHash(body),
  );
  assert.equal(result, null);
  assert.equal(fixture.calls.head, 1);
  assert.equal(fixture.calls.select, 0);
});

test("generated_atだけが変わったJSONでも同一hash metadataならR2 PUTを省略する", async () => {
  const previous = JSON.stringify({ generated_at: 100, items: [{ id: "v1" }] });
  const next = JSON.stringify({ generated_at: 200, items: [{ id: "v1" }] });
  const contentHash = await staticArtifactContentHash(previous);
  const fixture = createEnv({
    storedHash: contentHash,
    metadataHash: contentHash,
  });
  const result = await resolveIdenticalJsonArtifactPut(
    fixture.env,
    "top.json",
    next,
    await staticArtifactContentHash(next),
  );
  assert.ok(result);
  assert.equal(result.skipPut, true);
  assert.equal(fixture.calls.head, 1);
  assert.equal(fixture.calls.select, 0);
});

test("意味内容が変わったJSONはR2 PUTする", async () => {
  const previous = JSON.stringify({ generated_at: 100, items: [{ id: "v1" }] });
  const next = JSON.stringify({ generated_at: 200, items: [{ id: "v2" }] });
  const fixture = createEnv({
    storedHash: await staticArtifactContentHash(previous),
    metadataHash: await staticArtifactContentHash(previous),
  });
  const result = await resolveIdenticalJsonArtifactPut(
    fixture.env,
    "top.json",
    next,
    await staticArtifactContentHash(next),
  );
  assert.equal(result, null);
  assert.equal(fixture.calls.head, 1);
});

test("artifactHashCache を preload したlegacy fallbackはhash照会を省きmetadata付きで更新する", async () => {
  const body = JSON.stringify({ ok: true });
  const storedHash = await hash(body);
  let selectCount = 0;
  const cache = new ArtifactHashCache();
  const DB = {
    prepare(query) {
      return {
        bind() {
          return {
            async all() {
              if (query.includes("target_type")) {
                return {
                  results: [{ object_key: "top.json", content_hash: storedHash }],
                };
              }
              return { results: [] };
            },
            async first() {
              selectCount += 1;
              return { content_hash: storedHash };
            },
          };
        },
      };
    },
  };
  const R2 = {
    async head() {
      return { key: "top.json" };
    },
  };
  await cache.preload(DB, "top", "global");
  const result = await resolveIdenticalJsonArtifactPut(
    { DB, R2, artifactHashCache: cache },
    "top.json",
    body,
    await staticArtifactContentHash(body),
  );
  assert.ok(result);
  assert.equal(result.skipPut, false);
  assert.equal(selectCount, 0);
});

test("resolveIdenticalJsonArtifactPut はR2 metadata一致ならhash付きheadを返す", async () => {
  const body = JSON.stringify({ generated_at: 100, items: [{ id: "v1" }] });
  const storedHash = await staticArtifactContentHash(body);
  const fixture = createEnv({ storedHash, metadataHash: storedHash });
  const result = await resolveIdenticalJsonArtifactPut(
    fixture.env,
    "top.json",
    body,
  );
  assert.ok(result);
  assert.equal(result.skipPut, true);
  assert.equal(result.object, fixture.object);
  assert.equal(fixture.calls.head, 1);
  assert.equal(fixture.calls.select, 0);
});

test("metadata builder records hash, schema, and a bounded generation", async () => {
  assert.deepEqual(
    staticArtifactCustomMetadata(
      JSON.stringify({ schema_version: 2, generation_key: "g-2" }),
      "abc",
      1,
    ),
    { content_hash: "abc", schema_version: "2", source_generation: "g-2" },
  );
});

// 変更前の staticArtifactContentHash / staticArtifactCustomMetadata をそのまま写した同値性oracle。
async function legacyContentHash(value) {
  let text = value;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const { generated_at: _g, ...meaningful } = parsed;
      text = JSON.stringify(meaningful);
    }
  } catch {}
  return hash(text);
}

function legacyMetadata(serialized, contentHash, defaultSchemaVersion = 1) {
  let schemaVersion = String(defaultSchemaVersion);
  let sourceGeneration = contentHash;
  try {
    const row = JSON.parse(serialized);
    if (row && typeof row === "object" && !Array.isArray(row)) {
      const rawSchema = row.schema_version;
      if ((typeof rawSchema === "string" || typeof rawSchema === "number") && String(rawSchema).trim()) {
        schemaVersion = String(rawSchema).trim().slice(0, 32);
      }
      const rawGeneration = row.source_generation ?? row.generation ?? row.generation_key;
      if ((typeof rawGeneration === "string" || typeof rawGeneration === "number") && String(rawGeneration).trim()) {
        const normalized = String(rawGeneration).trim();
        if (normalized.length <= 128) sourceGeneration = normalized;
      }
    }
  } catch {}
  return { content_hash: contentHash, schema_version: schemaVersion, source_generation: sourceGeneration };
}

test("serializeJsonArtifact は変更前の再parse方式と同じ serialized / hash / metadata を返す", async () => {
  const nullProto = Object.assign(Object.create(null), { generated_at: 1, a: 1 });
  const bodies = [
    { generated_at: 100, items: [{ id: "v1" }], schema_version: 3 },
    { items: [], generation: " gen-a ", generation_key: "ignored" },
    { generated_at: 5, 2: "b", 1: "a", z: undefined, f: () => 1, n: Number.NaN },
    { source_generation: null, generation: "fallback", schema_version: "  " },
    { source_generation: Number.POSITIVE_INFINITY, generation: "after-null" },
    { source_generation: undefined, generation: () => "x", generation_key: "k" },
    { schema_version: "x".repeat(40), generation: "g".repeat(129) },
    { generated_at: { toJSON: () => "d" }, schema_version: new Date(0) },
    { toJSON: () => ({ generated_at: 1, generation: "from-toJSON" }) },
    nullProto,
    [{ generated_at: 1 }],
    "plain-string",
    42,
    null,
  ];
  for (const body of bodies) {
    for (const schema of [1, 2]) {
      const serialized = JSON.stringify(body);
      const expectedHash = await legacyContentHash(serialized);
      const result = await serializeJsonArtifact(body, schema);
      assert.equal(result.serialized, serialized);
      assert.equal(result.contentHash, expectedHash);
      assert.equal(await staticArtifactContentHash(serialized), expectedHash);
      assert.deepEqual(result.customMetadata, legacyMetadata(serialized, expectedHash, schema));
      assert.deepEqual(
        staticArtifactCustomMetadata(serialized, expectedHash, schema),
        legacyMetadata(serialized, expectedHash, schema),
      );
    }
  }
});

test("assertNoForbiddenPublicKeys は従来と同じpathで最初の禁止keyを報告する", () => {
  assert.doesNotThrow(() => assertNoForbiddenPublicKeys({ items: [{ id: 1 }, null, [2]] }));
  assert.throws(
    () => assertNoForbiddenPublicKeys({ items: [{ id: 1 }, { nested: { user_id: "u" } }] }),
    { message: "Forbidden key root.items[1].nested.user_id" },
  );
  assert.throws(
    () => assertNoForbiddenPublicKeys([{ ok: 1 }, { access_token: "t", user_id: "u" }]),
    { message: "Forbidden key root[1].access_token" },
  );
  assert.throws(
    () => assertNoForbiddenPublicKeys({ discord_id: { user_id: "u" } }, "payload"),
    { message: "Forbidden key payload.discord_id" },
  );
});

test("jsonContentHash / serializeJsonArtifact は再parseした従来のhashと一致する", async () => {
  const { jsonContentHash, serializeJsonArtifact, staticArtifactContentHash } =
    await import("./r2Dedup.ts");
  const rows = Array.from({ length: 50 }, (_, index) => ({
    id: `v${index}`,
    title: index % 7 === 0 ? "é 🔥 \"quoted\" \\  " : `作品${index}`,
    score: index % 3 === 0 ? -0 : index / 3,
    missing: undefined,
    when: new Date(Date.UTC(2026, 0, 1 + index)),
  }));
  const bodies = [
    { generated_at: 1791116000, items: rows, total: 50 },
    { generated_at: "2026-10-04", items: rows },
    { generated_at: 1791116000 },
    { generated_at: 1791116000, skipped: undefined },
    { items: rows, generated_at: 1791116000 },
    { 10: "integer key first", generated_at: 1, items: rows },
    { generated_at: Number.NaN, items: rows },
    { generated_at: null, items: rows },
    { generated_at: { nested: true }, items: rows },
    { schema_version: 2, generation: "g", rows },
    [rows[0], rows[1]],
    { toJSON: () => ({ generated_at: 5, items: [] }) },
    "plain string",
  ];
  for (const body of bodies) {
    const legacy = await staticArtifactContentHash(JSON.stringify(body));
    assert.equal(await jsonContentHash(body), legacy, JSON.stringify(body).slice(0, 60));
    assert.equal((await serializeJsonArtifact(body)).contentHash, legacy);
  }
  // generated_at differs, content equal → same hash (dedupe contract).
  assert.equal(
    await jsonContentHash({ generated_at: 1, items: rows }),
    await jsonContentHash({ generated_at: 2, items: rows }),
  );
});

test("putJsonArtifact は同一 hash なら PUT せず、それ以外は JSON の content type と hash metadata で PUT する", async () => {
  const body = { generated_at: 1, items: [1, 2] };
  const expected = await serializeJsonArtifact(body, 2);
  const fixture = createEnv({ metadataHash: expected.contentHash });
  const puts = [];
  fixture.env.R2.put = async (key, value, options) => {
    puts.push({ key, value, options });
  };

  const skipped = await putJsonArtifact(fixture.env, "a.json", body, {
    cacheControl: "public, max-age=60",
    schemaVersion: 2,
    deduplicate: true,
  });
  assert.equal(skipped.wrote, false);
  assert.equal(skipped.contentHash, expected.contentHash);
  assert.deepEqual(puts, []);

  const written = await putJsonArtifact(fixture.env, "a.json", body, {
    cacheControl: "public, max-age=60",
    schemaVersion: 2,
    customMetadata: { shard: "3", content_hash: "overridden" },
    deduplicate: false,
  });
  assert.equal(written.wrote, true);
  assert.equal(fixture.calls.head, 1, "deduplicate: false must not HEAD the object");
  assert.deepEqual(puts, [
    {
      key: "a.json",
      value: expected.serialized,
      options: {
        httpMetadata: {
          contentType: "application/json; charset=utf-8",
          cacheControl: "public, max-age=60",
        },
        customMetadata: { shard: "3", ...expected.customMetadata },
      },
    },
  ]);
});
