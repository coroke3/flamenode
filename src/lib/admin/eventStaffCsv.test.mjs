import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildEventStaffCsvPreview,
  EVENT_STAFF_CSV_SAMPLE,
} from "./eventStaffCsv.ts";

test("buildEventStaffCsvPreview parses canonical 5-column format", () => {
  const preview = buildEventStaffCsvPreview({
    text: EVENT_STAFF_CSV_SAMPLE,
    existingSubjects: [{ x_user_id: "yamada" }],
    isSiteAdmin: false,
  });

  assert.equal(preview.hasErrors, false);
  assert.equal(preview.counts.update, 1);
  assert.equal(preview.counts.create, 2);
  assert.equal(preview.rows[0].permission_preset, "slot_manager");
  assert.equal(preview.rows[0].is_public_staff, "1");
  assert.equal(preview.rows[0].action, "update");
});

test("buildEventStaffCsvPreview rejects obsolete 6-column rows", () => {
  const preview = buildEventStaffCsvPreview({
    text: "表示名,X ID,ユーザー ID,担当プリセット,公開フラグ,公開ラベル\n進行担当,yamada,,slot_manager,1,進行",
    existingSubjects: [],
    isSiteAdmin: false,
  });

  assert.equal(preview.hasErrors, true);
  assert.match(preview.rows[0].errors.join(" / "), /5列/);
});

test("buildEventStaffCsvPreview blocks site-admin-only preset for manage users", () => {
  const preview = buildEventStaffCsvPreview({
    text: "表示名,X ID,担当プリセット,公開フラグ,公開ラベル\n確認担当,sato,xid_reviewer,0,",
    existingSubjects: [],
    isSiteAdmin: false,
  });

  assert.equal(preview.hasErrors, true);
  assert.equal(preview.counts.error, 1);
  assert.match(preview.rows[0].errors.join(" / "), /site admin/);
});

test("buildEventStaffCsvPreview accepts quoted cells", () => {
  const preview = buildEventStaffCsvPreview({
    text: '表示名,X ID,担当プリセット,公開フラグ,公開ラベル\n"進行,配信",streamer,slot_manager,1,"進行,配信"',
    existingSubjects: [],
    isSiteAdmin: false,
  });

  assert.equal(preview.hasErrors, false);
  assert.equal(preview.rows[0].display_name, "進行,配信");
  assert.equal(preview.rows[0].public_role_label, "進行,配信");
});

test("buildEventStaffCsvPreview rejects owner changes", () => {
  const preview = buildEventStaffCsvPreview({
    text: "表示名,X ID,担当プリセット,公開フラグ,公開ラベル\n代表者,owner,owner,1,代表",
    existingSubjects: [],
    isSiteAdmin: true,
  });

  assert.equal(preview.hasErrors, true);
  assert.match(preview.rows[0].errors.join(" / "), /代表者/);
});
