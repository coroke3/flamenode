#!/usr/bin/env node
/**
 * D1へ接続しないCIでもowner保護の土台を検査する。
 * 実データのownerゼロ/重複は管理画面のintegrity checkで検出し、
 * 本番D1への検査・修復は運用者が実行する。
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const schema = fs.readFileSync(path.join(root, "src/lib/db/schema.ts"), "utf8");
const ownership = fs.readFileSync(path.join(root, "src/lib/event/eventOwnership.ts"), "utf8");
const required = [
  "event_staff_event_preset_idx",
  "event_staff_event_user_uniq",
  "assertEventWillRetainOwner",
  "transferEventOwnership",
  "permission_preset",
];
const missing = required.filter((value) => !schema.includes(value) && !ownership.includes(value));
if (missing.length > 0) {
  console.error(`[check:event-owners] missing: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("[check:event-owners] OK: owner schema and service invariants are present.");
