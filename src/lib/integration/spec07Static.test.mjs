import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");

test("旧形式インポートは管理者専用の入力アダプターとして提供する", () => {
  const surfaces = [
    "app/(admin)/admin/" + "import/page.tsx",
    "app/api/admin/" + "import/" + "legacy/route.ts",
    "src/lib/" + "import/" + "legacy",
  ];
  for (const relativePath of surfaces) {
    assert.equal(
      fs.existsSync(path.join(root, relativePath)),
      true,
      `${relativePath} must exist`,
    );
  }

  const navigation = fs.readFileSync(
    path.join(root, "src/lib/admin/adminNavGroups.tsx"),
    "utf8",
  );
  assert.match(navigation, /import/);
});

test("deprecated identifiers remain covered by the legacy static checker", () => {
  const checker = fs.readFileSync(path.join(root, "scripts/check-db-legacy.mjs"), "utf8");
  const identifiers = [
    "api" + "Endpoints",
    "api_" + "endpoints",
    "syncLegacy" + "EventVisibilityFlags",
    "computedEvent" + "LegacyFlags",
    "enrichEventRowFor" + "StaticJson",
    "src/lib/" + "import/" + "legacy",
    "/api/admin/" + "import/" + "legacy",
    "ENABLE_LEGACY_IMPORT_" + "TOOL",
    "LEGACY_IMPORT_PREVIEW_" + "SECRET",
  ];
  for (const identifier of identifiers) {
    assert.match(checker, new RegExp(identifier.replace(/[\\/]/g, "\\$&")));
  }
});

test("X ID profile updates use canonical columns without runtime schema fallback", () => {
  const xid = fs.readFileSync(path.join(root, "src/lib/actions/xid.ts"), "utf8");
  const checker = fs.readFileSync(path.join(root, "scripts/check-db-legacy.mjs"), "utf8");
  assert.doesNotMatch(xid, /addColumnIfMissing|PRAGMA\s+table_info|ensureXUserProfileColumns/);
  assert.doesNotMatch(xid, /ALTER\s+TABLE|CREATE\s+TABLE|backfill/i);
  assert.match(xid, /profile_text:\s*values\.profileText/);
  assert.match(xid, /portfolio_contact:\s*values\.portfolioContact/);
  assert.match(xid, /youtube_channel_url:\s*values\.youtubeChannelUrl/);
  assert.match(xid, /other_social_links:\s*values\.otherSocialLinks/);
  assert.match(checker, /runtime-schema-ddl/);
  assert.match(checker, /runtime-backfill/);
});

test("audit restore source contains payload, stale-snapshot, and atomic failure guards", () => {
  const capability = fs.readFileSync(path.join(root, "src/lib/audit/capability.ts"), "utf8");
  const restore = fs.readFileSync(path.join(root, "src/lib/audit/restore.ts"), "utf8");
  const mutate = fs.readFileSync(path.join(root, "src/lib/audit/mutate.ts"), "utf8");
  assert.match(capability, /payloadExceeded/);
  assert.match(capability, /snapshotRedacted/);
  assert.match(restore, /computeChangedKeys\(after, current\)/);
  assert.match(mutate, /changes\(\) =/);
  assert.match(mutate, /json_extract\('not-valid-json'/);
});

test("local development shares Wrangler bindings and persistence with migration commands", () => {
  const instrumentation = fs.readFileSync(path.join(root, "instrumentation.ts"), "utf8");
  const nextConfig = fs.readFileSync(path.join(root, "next.config.mjs"), "utf8");
  const grantAdmin = fs.readFileSync(path.join(root, "scripts/grant-admin.cjs"), "utf8");

  assert.match(nextConfig, /setupDevPlatform/);
  assert.match(nextConfig, /configPath:\s*"wrangler\.toml"/);
  assert.match(nextConfig, /persist:\s*\{\s*path:\s*"\.wrangler\/state\/v3"\s*\}/);
  assert.match(nextConfig, /remoteBindings:\s*false/);
  assert.match(nextConfig, /envFiles:\s*\[\]/);

  for (const source of [instrumentation, grantAdmin]) {
    assert.match(source, /getPlatformProxy/);
    assert.match(source, /configPath:\s*"wrangler\.toml"/);
    assert.match(source, /persist:\s*\{\s*path:\s*"\.wrangler\/state\/v3"\s*\}/);
    assert.match(source, /remoteBindings:\s*false/);
    assert.match(source, /envFiles:\s*\[\]/);
    assert.doesNotMatch(source, /d1Databases|DB:\s*"flamenode_db"/);
  }

  assert.match(instrumentation, /await assertLocalSchemaVersion\(DB\)/);
  assert.match(instrumentation, /__FLAMENODE_LOCAL_PLATFORM\s*=\s*platform/);
  assert.match(grantAdmin, /const db = platform\.env\.DB/);
  assert.match(grantAdmin, /finally\s*\{\s*await platform\.dispose\(\)/s);
});
