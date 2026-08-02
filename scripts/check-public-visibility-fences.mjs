#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

const migration = readFileSync(
  path.join(root, "migrations/0049_public_visibility_fences.sql"),
  "utf8",
);
assert.match(migration, /CREATE TABLE IF NOT EXISTS public_visibility_fences/);
assert.match(migration, /entity_type/);
assert.match(migration, /fence_token/);
assert.match(migration, /requirements_json/);

const schema = readFileSync(
  path.join(root, "src/lib/db/schema.base.ts"),
  "utf8",
);
assert.match(schema, /publicVisibilityFences/);
assert.match(schema, /public_visibility_fences/);

const manifestCore = readFileSync(
  path.join(root, "src/lib/publicData/publicVisibilityManifestCore.ts"),
  "utf8",
);
assert.match(manifestCore, /visibility\/blocked-entities\.v1\.json/);
assert.match(manifestCore, /PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES/);

const manifest = readFileSync(
  path.join(root, "src/lib/publicData/publicVisibilityManifest.ts"),
  "utf8",
);
assert.match(manifest, /MANIFEST_PUT_MAX_RETRIES = 3/);
assert.match(manifest, /cacheControl: "no-store"/);
assert.match(manifest, /resolvePublicVisibilityGuardModeFromEnv/);

console.log("check:public-visibility-fences OK");
