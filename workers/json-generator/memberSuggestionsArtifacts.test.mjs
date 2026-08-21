import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
  memberSuggestionsIndexObjectKey,
  parseMemberSuggestionsManifest,
} from "../../src/lib/video/memberSuggestionsCore.ts";
import { staticArtifactContentHash } from "./r2Dedup.ts";
import { rebuildMemberSuggestions } from "./memberSuggestionsArtifacts.ts";

/** 最小限のD1 fake。member suggestions generatorが使うprepare().bind()...のみ。 */
function createFakeDb(options = {}) {
  const statements = [];
  let trackingRunCount = 0;
  const xUsersRows = options.xUsersRows ?? [];
  const aliasRows = options.aliasRows ?? [];
  const creatorRows = options.creatorRows ?? [];
  const memberRows = options.memberRows ?? [];
  const failTrackingAt = options.failTrackingAt ?? null;
  // object_key → 既存content_hash（dedup検証用）。
  const knownHashes = options.knownHashes ?? {};
  return {
    statements,
    prepare(sqlText) {
      return {
        sqlText,
        bind(...args) {
          const run = async () => {
            statements.push({ sql: sqlText, args });
            if (/INSERT INTO static_artifacts/i.test(sqlText)) {
              trackingRunCount += 1;
              if (failTrackingAt === trackingRunCount) {
                throw new Error("tracking_failed");
              }
            }
            return { meta: { changes: 1 } };
          };
          return {
            run,
            first: async () => {
              statements.push({ sql: sqlText, args });
              if (/content_hash/.test(sqlText)) {
                const key = args[0];
                return key != null && key in knownHashes
                  ? { content_hash: knownHashes[key] }
                  : null;
              }
              return null;
            },
            all: async () => {
              statements.push({ sql: sqlText, args });
              // 呼び出し順: x_users → aliases → creators → members → tracking/reconcile。
              if (/FROM x_users/i.test(sqlText)) return { results: xUsersRows };
              if (/FROM x_user_aliases/i.test(sqlText)) return { results: aliasRows };
              if (/FROM videos/i.test(sqlText)) return { results: creatorRows };
              if (/FROM video_members/i.test(sqlText)) return { results: memberRows };
              // static_artifacts SELECT（reconcile）は空を返す。
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

function createFakeR2() {
  const objects = new Map();
  const puts = [];
  const heads = [];
  const deletes = [];
  return {
    objects,
    puts,
    heads,
    deletes,
    async put(key, value) {
      puts.push({ key, value });
      objects.set(key, value);
      return { key };
    },
  async get(key) {
      const value = objects.get(key);
      if (value == null) return null;
      return {
        key,
        json: async () => JSON.parse(value),
        text: async () => value,
      };
    },
    async head(key) {
      heads.push(key);
      return objects.has(key) ? { key } : null;
    },
    async delete(keys) {
      const normalized = Array.isArray(keys) ? keys : [keys];
      deletes.push([...normalized]);
      for (const key of normalized) objects.delete(key);
    },
  };
}

function createEnv(source = {}) {
  const db = createFakeDb(source);
  const r2 = createFakeR2();
  return { db, r2, DB: db, R2: r2 };
}

const BASIC_SOURCE = {
  xUsersRows: [
    { id: "Mochi", x_name: "Mochi", approval_status: "approved" },
    { id: "temp", x_name: "Temp", approval_status: "pending" },
  ],
  aliasRows: [{ x_user_id: "mochi", alias_x_id: "OldMochi" }],
  creatorRows: [
    {
      creator_x_user_id: "mochi",
      creator_display_name: "Mochi Creator",
      updated_at: 200,
    },
  ],
  memberRows: [
    { x_user_id: "MOCHI", name: "Member Name", updated_at: 300 },
  ],
};

test("worker rebuildがmanifest-lastでartifactを公開する", async () => {
  const env = createEnv(BASIC_SOURCE);
  const result = await rebuildMemberSuggestions(env);
  // x_usersに存在する mochi / temp の2件。
  assert.equal(result.itemCount, 2);
  assert.equal(result.liveKeys.length, 2);

  const manifest = JSON.parse(env.r2.objects.get(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.total, 2);
  assert.ok(parseMemberSuggestionsManifest(manifest));

  // manifestは必ず最後に書かれる。
  assert.equal(env.r2.puts.at(-1)?.key, MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY);
  // generation objectはmanifestより先に書かれている。
  assert.ok(env.r2.puts.findIndex((p) => p.key === manifest.object_key) >= 0);

  const index = JSON.parse(env.r2.objects.get(manifest.object_key));
  assert.equal(index.generation, manifest.generation);
  assert.equal(index.items.length, 2);
  const item = index.items.find((entry) => entry.x_user_id === "mochi");
  assert.ok(item);
  // プロフィール名が正本。履歴名はnameAliasesへ。
  assert.equal(item.name, "Mochi");
  assert.deepEqual([...item.nameAliases].sort(), ["Member Name", "Mochi Creator"]);
  assert.deepEqual(item.xAliases, ["oldmochi"]);
  assert.equal(item.approvalStatus, "approved");
  assert.equal(item.occurrenceCount, 2);
  assert.equal(item.lastSeenAt, 300);
});

test("内容が変わらない限りgenerationは不変", async () => {
  const first = createEnv(BASIC_SOURCE);
  const result1 = await rebuildMemberSuggestions(first);
  const second = createEnv(BASIC_SOURCE);
  const result2 = await rebuildMemberSuggestions(second);
  assert.equal(result1.generation, result2.generation);
  assert.equal(
    memberSuggestionsIndexObjectKey(result1.generation),
    memberSuggestionsIndexObjectKey(result2.generation),
  );
  assert.notEqual(
    result1.generation,
    (await rebuildMemberSuggestions(createEnv({
      ...BASIC_SOURCE,
      xUsersRows: [...BASIC_SOURCE.xUsersRows, { id: "extra", x_name: "Extra" }],
    }))).generation,
    "内容が変わればgenerationも変わる",
  );
});

test("同一内容の再buildはR2 PUT dedupで省略される", async () => {
  // 先行buildでtracking済みの状態を作る。
  const initial = createEnv(BASIC_SOURCE);
  const built = await rebuildMemberSuggestions(initial);

  // static_artifactsに既存content_hashが記録されている状態を再現する。
  // bodyはrun1の実物を使い、hash計算も実装と同じ経路（generated_at除外）で行う。
  const idxKey = built.liveKeys[0];
  const storedIndexBody = initial.r2.objects.get(idxKey);
  const storedManifestBody = initial.r2.objects.get(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY);
  const knownHashes = {
    [idxKey]: await staticArtifactContentHash(storedIndexBody),
    [MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY]: await staticArtifactContentHash(storedManifestBody),
  };

  const dedupDb = createFakeDb({ ...BASIC_SOURCE, knownHashes });
  const dedupR2 = createFakeR2();
  dedupR2.objects.set(idxKey, storedIndexBody);
  dedupR2.objects.set(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY, storedManifestBody);

  await rebuildMemberSuggestions({ DB: dedupDb, R2: dedupR2 });
  // 同一内容ならPUTは一切発生しない（head確認のみ）。
  assert.equal(dedupR2.puts.length, 0);
});

test("static_artifacts tracking failure removes newly written suggestions artifacts", async () => {
  const env = createEnv({ ...BASIC_SOURCE, failTrackingAt: 2 });
  await assert.rejects(() => rebuildMemberSuggestions(env), /tracking_failed/);
  assert.equal(env.r2.objects.size, 0);
  assert.equal(env.r2.deletes.length, 1);
  assert.equal(env.r2.deletes[0].length, 2);
});

test("manifest tracking failure restores the previous manifest", async () => {
  const env = createEnv({ ...BASIC_SOURCE, failTrackingAt: 2 });
  const previousManifest = JSON.stringify({
    schema_version: 1,
    generation: "previous",
    generated_at: 1,
    total: 0,
    object_key: memberSuggestionsIndexObjectKey("previous"),
  });
  env.r2.objects.set(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY, previousManifest);

  await assert.rejects(() => rebuildMemberSuggestions(env), /tracking_failed/);
  assert.equal(
    env.r2.objects.get(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY),
    previousManifest,
  );
});

test("size guard超過で旧manifestを壊さず失敗する", async () => {
  const env = createEnv({
    xUsersRows: [
      {
        id: "big",
        x_name: "X".repeat(9_000_000),
        approval_status: "approved",
      },
    ],
  });
  await assert.rejects(() => rebuildMemberSuggestions(env), /size limit/);
  // manifestは書かれていない＝旧世代が維持される。
  assert.equal(env.r2.objects.get(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY), undefined);
});

test("row guard超過でbuildが失敗しpartial indexを出さない", async () => {
  const rows = [];
  for (let i = 0; i < 20001; i += 1) {
    rows.push({ id: `u${String(i).padStart(5, "0")}`, x_name: `U${i}` });
  }
  const env = createEnv({ xUsersRows: rows });
  await assert.rejects(() => rebuildMemberSuggestions(env), /limit_exceeded/);
  assert.equal(env.r2.objects.get(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY), undefined);
});
