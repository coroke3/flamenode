import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STATIC_ARTIFACT_REFRESH_AFTER_SEC,
  putJsonArtifact,
  resolveIdenticalJsonArtifactPut,
  staticArtifactContentHash,
} from "./r2Dedup.ts";

const DAY_MS = 24 * 3600 * 1000;

async function fixture(ageDays, payload) {
  const hash = await staticArtifactContentHash(JSON.stringify(payload));
  const puts = [];
  const object = {
    key: "rules/current.json",
    uploaded: new Date(Date.now() - ageDays * DAY_MS),
    customMetadata: { content_hash: hash },
  };
  const env = {
    DB: {},
    R2: {
      async head() {
        return object;
      },
      async put(key, value) {
        puts.push({ key, value });
      },
    },
  };
  return { env, puts, hash };
}

test("REFRESH_AFTER は SLO 90日より短い", () => {
  assert.ok(STATIC_ARTIFACT_REFRESH_AFTER_SEC < 90 * 24 * 3600);
  assert.equal(STATIC_ARTIFACT_REFRESH_AFTER_SEC, 60 * 24 * 3600);
});

test("同一hashでも最終PUTが60日超なら書き直し、以内なら省略する", async () => {
  const payload = { generated_at: 100, rules: ["a"] };
  const text = JSON.stringify(payload);
  const fresh = await fixture(59, payload);
  assert.equal(
    (await resolveIdenticalJsonArtifactPut(fresh.env, "rules/current.json", text, fresh.hash))?.skipPut,
    true,
  );
  const stale = await fixture(61, payload);
  assert.equal(
    (await resolveIdenticalJsonArtifactPut(stale.env, "rules/current.json", text, stale.hash))?.skipPut,
    false,
  );
});

test("putJsonArtifact は古い同一内容を新しい generated_at で再PUTする", async () => {
  const stale = await fixture(61, { generated_at: 100, rules: ["a"] });
  const result = await putJsonArtifact(
    stale.env,
    "rules/current.json",
    { generated_at: 200, rules: ["a"] },
    { cacheControl: "public", deduplicate: true },
  );
  assert.equal(result.wrote, true);
  assert.equal(stale.puts.length, 1);
  assert.equal(JSON.parse(stale.puts[0].value).generated_at, 200);

  const fresh = await fixture(1, { generated_at: 100, rules: ["a"] });
  const skipped = await putJsonArtifact(
    fresh.env,
    "rules/current.json",
    { generated_at: 200, rules: ["a"] },
    { cacheControl: "public", deduplicate: true },
  );
  assert.equal(skipped.wrote, false);
  assert.equal(fresh.puts.length, 0);
});
