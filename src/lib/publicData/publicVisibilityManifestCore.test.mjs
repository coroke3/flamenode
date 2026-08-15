import assert from "node:assert/strict";
import test from "node:test";

const { normalizePublicVisibilityBlockedEntitiesManifest } = await import(
  "./publicVisibilityManifestCore.ts"
);

const validManifest = {
  schema_version: 1,
  revision: 0,
  generated_at: 100,
  entities: [],
};

test("visibility manifest normalizer accepts the canonical schema", () => {
  assert.deepEqual(
    normalizePublicVisibilityBlockedEntitiesManifest(validManifest),
    validManifest,
  );
});

test("visibility manifest normalizer rejects an unknown schema and invalid numbers", () => {
  for (const value of [
    { ...validManifest, schema_version: 2 },
    { ...validManifest, revision: 1.5 },
    { ...validManifest, generated_at: Number.NaN },
    { ...validManifest, generated_at: -1 },
  ]) {
    assert.equal(
      normalizePublicVisibilityBlockedEntitiesManifest(value),
      null,
    );
  }
});

test("visibility manifest normalizer rejects unusable entity rows", () => {
  for (const entity of [
    { entity_type: "video", entity_id: "", fence_token: "token", blocked_at: 1 },
    { entity_type: "video", entity_id: "v1", fence_token: "", blocked_at: 1 },
    { entity_type: "video", entity_id: "v1", fence_token: "token", blocked_at: -1 },
    { entity_type: "video", entity_id: "v1", fence_token: "token", blocked_at: 1, reason: 42 },
  ]) {
    assert.equal(
      normalizePublicVisibilityBlockedEntitiesManifest({
        ...validManifest,
        entities: [entity],
      }),
      null,
    );
  }
});
