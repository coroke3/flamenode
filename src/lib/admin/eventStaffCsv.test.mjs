import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildEventStaffCsvPreview,
  EVENT_STAFF_CSV_SAMPLE,
} from "./eventStaffCsv.ts";

test("buildEventStaffCsvPreview parses current 6-column format", () => {
  const preview = buildEventStaffCsvPreview({
    text: EVENT_STAFF_CSV_SAMPLE,
    existingSubjects: [{ x_user_id: "yamada", discord_user_id: null }],
    isSiteAdmin: false,
  });

  assert.equal(preview.hasErrors, false);
  assert.equal(preview.counts.update, 1);
  assert.equal(preview.counts.create, 2);
  assert.equal(preview.counts.legacy, 0);
  assert.equal(preview.rows[0].permission_preset, "slot_manager");
  assert.equal(preview.rows[0].is_public_staff, "1");
  assert.equal(preview.rows[0].action, "update");
});

test("buildEventStaffCsvPreview keeps legacy 5-column rows read-compatible", () => {
  const preview = buildEventStaffCsvPreview({
    text: "表示名,X ID,担当プリセット,公開フラグ,公開ラベル\n進行担当,yamada,slot_manager,1,進行",
    existingSubjects: [],
    isSiteAdmin: false,
  });

  assert.equal(preview.hasErrors, false);
  assert.equal(preview.counts.legacy, 1);
  assert.equal(preview.rows[0].format, "legacy");
  assert.match(preview.rows[0].warnings.join(" / "), /旧形式/);
});

test("buildEventStaffCsvPreview blocks site-admin-only preset for manage users", () => {
  const preview = buildEventStaffCsvPreview({
    text: "表示名,X ID,Discord User ID,担当プリセット,公開フラグ,公開ラベル\n確認担当,sato,,xid_reviewer,0,",
    existingSubjects: [],
    isSiteAdmin: false,
  });

  assert.equal(preview.hasErrors, true);
  assert.equal(preview.counts.error, 1);
  assert.match(preview.rows[0].errors.join(" / "), /site admin/);
});

test("buildEventStaffCsvPreview accepts quoted cells", () => {
  const preview = buildEventStaffCsvPreview({
    text: '表示名,X ID,Discord User ID,担当プリセット,公開フラグ,公開ラベル\n"進行,配信",streamer,,slot_manager,1,"進行,配信"',
    existingSubjects: [],
    isSiteAdmin: false,
  });

  assert.equal(preview.hasErrors, false);
  assert.equal(preview.rows[0].display_name, "進行,配信");
  assert.equal(preview.rows[0].public_role_label, "進行,配信");
});
