import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const route = await readFile(
  new URL(
    "../../../app/api/public/events/[id]/staff/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("PVSF staff API is a strict R2-only path with no D1 fallback", () => {
  assert.match(route, /getCloudflareContext/);
  assert.match(route, /getCloudflareContext\(\)\.env\.BUCKET/);
  assert.match(route, /eventBaseObjectKey\(eventId\)/);
  assert.match(route, /parsePublicEventId/);
  assert.doesNotMatch(route, /\bgetEnv\b/);
  assert.doesNotMatch(route, /\bgetDatabase\b/);
  assert.doesNotMatch(route, /\bloadPublicJson\b/);
  assert.doesNotMatch(route, /\bloadStaticJsonFreshStaleUnavailable\b/);
  assert.doesNotMatch(route, /\bdirectEnqueueStaticRebuild\b/);
  assert.doesNotMatch(route, /\benqueueStaticRebuild/);
});

test("PVSF staff API enforces the visibility manifest around the artifact read", () => {
  assert.match(route, /readPublicVisibilityBlockedEntitiesManifest/);
  assert.match(route, /public_visibility_manifest_missing/);
  assert.match(
    route,
    /isEntityBlockedInManifest\(beforeManifest\.manifest, "event", eventId\)/,
  );
  assert.match(
    route,
    /isEntityBlockedInManifest\(afterManifest\.manifest, "event", eventId\)/,
  );
  assert.match(route, /afterManifest\.etag !== beforeManifest\.etag/);
  assert.match(route, /public_visibility_manifest_changed/);
});

test("PVSF staff API keeps DTO, ETag, cache, and CORS response boundaries", () => {
  assert.match(route, /normalizePublicEventStaffArtifact/);
  assert.match(route, /assertNoForbiddenKeys\(payload\)/);
  assert.match(route, /publicJsonResponse/);
  assert.match(route, /public, max-age=0, must-revalidate/);
  assert.match(route, /Cloudflare-CDN-Cache-Control", "no-store"/);
  assert.match(route, /Access-Control-Allow-Origin/);
  assert.match(route, /resolvePvsfPublicApiOrigin/);
  assert.match(route, /appendVary\(response\.headers, "Origin"\)/);
  assert.match(route, /Access-Control-Expose-Headers", "ETag, Retry-After"/);
  assert.match(route, /export async function OPTIONS/);
  assert.match(route, /Access-Control-Allow-Headers": "If-None-Match"/);
});

test("PVSF staff API never turns missing or malformed R2 data into an empty 200", () => {
  assert.match(route, /runtime_r2_binding_unavailable/);
  assert.match(route, /public_visibility_manifest_unavailable/);
  assert.match(route, /public_data_unavailable/);
  assert.match(route, /PUBLIC_EVENT_STAFF_OBJECT_MAX_BYTES/);
  assert.doesNotMatch(route, /staff\s*:\s*\[\s*\][\s\S]{0,120}status\s*:\s*200/);
});
