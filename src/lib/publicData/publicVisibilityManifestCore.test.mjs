import assert from "node:assert/strict";
import test from "node:test";
import {
  isEntityBlockedInManifest,
  normalizePublicVisibilityBlockedEntitiesManifest,
  releaseBlockedEntityInManifest,
  resolvePublicVisibilityGuardMode,
  upsertBlockedEntityInManifest,
} from "./publicVisibilityManifestCore.ts";

test("guard mode 既定は observe", () => {
  assert.equal(resolvePublicVisibilityGuardMode(undefined), "observe");
  assert.equal(resolvePublicVisibilityGuardMode(""), "observe");
  assert.equal(resolvePublicVisibilityGuardMode("enforce"), "enforce");
});

test("malformed manifest は null", () => {
  assert.equal(normalizePublicVisibilityBlockedEntitiesManifest(null), null);
  assert.equal(
    normalizePublicVisibilityBlockedEntitiesManifest({ revision: 1 }),
    null,
  );
});

test("manifest revision は単調増加し token 一致でのみ解除", () => {
  const base = normalizePublicVisibilityBlockedEntitiesManifest({
    schema_version: 1,
    revision: 3,
    generated_at: 100,
    entities: [
      {
        entity_type: "video",
        entity_id: "video-1",
        fence_token: "tok-a",
        blocked_at: 90,
      },
    ],
  });
  assert.ok(base);
  const blocked = upsertBlockedEntityInManifest(base, {
    entity_type: "video",
    entity_id: "video-2",
    fence_token: "tok-b",
    blocked_at: 95,
  }, 101);
  assert.equal(blocked.revision, 4);
  assert.equal(
    releaseBlockedEntityInManifest(blocked, "video", "video-1", "tok-wrong", 102),
    null,
  );
  const released = releaseBlockedEntityInManifest(
    blocked,
    "video",
    "video-1",
    "tok-a",
    102,
  );
  assert.ok(released);
  assert.equal(released.revision, 5);
  assert.equal(
    isEntityBlockedInManifest(released, "video", "video-1"),
    false,
  );
});
