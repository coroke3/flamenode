#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const migration = read("migrations/0052_video_interactions_auth_expand.sql");
const schema = read("src/lib/db/schema.canonical.ts");
const interaction = read("src/lib/actions/video/interaction.ts");
const library = read("app/(auth)/dashboard/library/page.tsx");
const pending = read("docs/database/pending/video-interactions-auth-contract.sql");

assert.match(migration, /CREATE TABLE video_interactions_auth/);
assert.match(migration, /INSERT OR IGNORE INTO video_interactions_auth/);
assert.match(migration, /_migration_0052_backfill_report/);
assert.match(migration, /HAVING COUNT\(\*\) = 1/);

assert.match(schema, /export const videoInteractionsAuth/);
assert.match(schema, /auth_user_id/);

assert.match(interaction, /videoInteractionsAuth/);
assert.match(interaction, /requireActiveXId: false/);
assert.doesNotMatch(interaction, /videoInteractions[^A]/);

assert.match(library, /videoInteractionsAuth/);
assert.match(library, /eq\(videosTable\.visibility_status, "public"\)/);
assert.doesNotMatch(library, /voided/);
assert.doesNotMatch(library, /activeX/);

assert.match(pending, /DROP TABLE video_interactions/);

console.log("check:video-interactions-auth OK");
