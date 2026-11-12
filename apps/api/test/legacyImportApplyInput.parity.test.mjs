import assert from "node:assert/strict";
import { test } from "node:test";
import { legacyImportApplyCredential } from "../src/routes/admin/legacyImportApplyInput.ts";

test("RH-002 U02 apply: missing credential rejects without an R2 claim", () => {
  const form = new FormData();
  assert.deepEqual(legacyImportApplyCredential(form), {
    ok: false, status: 409, body: {
      ok: false, message: "先にプレビューを実行してください。",
      requires_repreview: true,
    },
  });
});

test("RH-002 U02 apply: missing hash or token and whitespace-only values fail closed", () => {
  const form = new FormData();
  form.set("preview_token", "  abc ");
  assert.equal(legacyImportApplyCredential(form).ok, false);
  form.set("plan_hash", "  ");
  assert.equal(legacyImportApplyCredential(form).ok, false);
  form.set("preview_token", "  ");
  form.set("plan_hash", "  hash ");
  assert.equal(legacyImportApplyCredential(form).ok, false);
});

test("RH-002 U02 apply: trim credential but leave syntax/owner checks to R2 claim", () => {
  const form = new FormData();
  form.set("preview_token", "  not-yet-validated  ");
  form.set("plan_hash", "  owner-hash  ");
  assert.deepEqual(legacyImportApplyCredential(form), {
    ok: true, previewToken: "not-yet-validated", planHash: "owner-hash",
  });
});

test("RH-002 U02 apply: FormData binary entries cannot become credentials", () => {
  const form = new FormData();
  form.set("preview_token", new Blob(["secret"]), "token.bin");
  form.set("plan_hash", "hash");
  assert.equal(legacyImportApplyCredential(form).ok, false);
});

test("RH-002 U02 apply: CURRENT input ordering and text remain contract source", async () => {
  const { readFile } = await import("node:fs/promises");
  const current = await readFile(new URL("../../../app/api/admin/import/legacy/route.ts", import.meta.url), "utf8");
  assert.ok(current.indexOf("const previewToken = stringField(formData,") <
    current.indexOf("claimed = await claimLegacyImportPreview("));
  assert.match(current, /先にプレビューを実行してください。/);
});
