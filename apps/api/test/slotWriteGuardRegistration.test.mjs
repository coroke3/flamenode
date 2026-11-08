// MIG-0656 U02c-1b: D-15-10 scoped guard registration WITHOUT mounting slot writes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { manageRoutes } from "../src/routes/manage/index.ts";

const SITE = "https://app.flamenode.example";
const CANDIDATES = [
  ["POST", "/api/manage/events/ev-1/slots/batch-delete"],
  ["POST", "/api/manage/events/ev-1/slots/batch-release"],
  ["PATCH", "/api/manage/events/ev-1/slots/labels"],
  ["DELETE", "/api/manage/events/ev-1/slots/a"],
];

const content = readFileSync(new URL("../src/routes/manage/index.ts", import.meta.url), "utf8");
const make = () => {
  let dbPrepares = 0;
  const app = new Hono();
  app.route("/api/manage", manageRoutes);
  const perform = (method, path, origin, siteUrl = SITE) => app.request(
    SITE + path,
    {
      method, headers: origin === null ? {} : { Origin: origin },
      body: JSON.stringify({slot_ids:["a"],label:"ok"}),
    },
    {
      DB: {prepare() { dbPrepares++; throw new Error("DB must not be read before origin"); }},
      NEXT_PUBLIC_SITE_URL: siteUrl,
    },
  );
  return { perform, getDbPrepares: () => dbPrepares };
};

test("MIG-0656 U02c-1b: D-15-10 four slot write methods use Origin before any session/D1 lookup", async () => {
  const t = make();
  for (const [method,path] of CANDIDATES) {
    for (const origin of ["https://evil.example", null]) {
      const res = await t.perform(method,path,origin);
      assert.equal(res.status,403,method+" "+path);
      assert.equal((await res.json()).reason,"invalid_origin");
      assert.equal(res.headers.get("Cache-Control"),"private, no-store");
    }
  }
  assert.equal(t.getDbPrepares(),0);
});

test("MIG-0656 U02c-1b: missing site origin fails closed before D1", async () => {
  const t = make();
  for (const [method,path] of CANDIDATES) {
    const missing = await t.perform(method,path,SITE,"");
    assert.equal(missing.status,503);
    assert.equal((await missing.json()).reason,"origin_verification_unavailable");
  }
  assert.equal(t.getDbPrepares(),0);
});

test("MIG-0656 U02c-1b: candidate route implementation is still unmounted", () => {
  assert.match(content,/const slotWritePaths = \[/);
  assert.ok(content.includes("const singleSlotDeletePath = \"/events/:id/slots/:slotId\""));
  for (const suffix of ["/events/:id/slots/batch-delete","/events/:id/slots/batch-release","/events/:id/slots/labels"]) {
    assert.ok(content.includes(suffix));
  }
  assert.doesNotMatch(content,/import\s+.*slotBatch(?:AvailableDelete|LabelWrite|ReservedRelease)/);
  assert.doesNotMatch(content,/\.route\([^)]*slotBatch(?:AvailableDelete|LabelWrite|ReservedRelease)Routes/);
  assert.match(content,/const scopedWritePaths = \[\.\.\.playlistWritePaths, \.\.\.slotWritePaths\]/);
  assert.equal((content.match(/for \(const path of scopedWritePaths\)/g)||[]).length,2);
});
