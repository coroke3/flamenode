import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  SPREADSHEET_JSON_BODY_MAX_BYTES,
  readSpreadsheetJsonBody,
} from "../src/routes/admin/spreadsheet/writeBody.ts";

const current = await readFile(new URL("../../../src/lib/admin/spreadsheet/routeHandler.ts", import.meta.url), "utf8");
const target = await readFile(new URL("../src/routes/admin/spreadsheet/writeBody.ts", import.meta.url), "utf8");
const marker = "export const SPREADSHEET_JSON_BODY_MAX_BYTES";
function request(body, headers = {}) {
  return new Request("https://example.test/api/admin/spreadsheet/data", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

test("U01b body reader matches CURRENT byte-for-byte after provenance header", () => {
  assert.ok(current.includes(marker));
  assert.ok(target.includes(marker));
  assert.equal(target.slice(target.indexOf(marker)).trimEnd(), current.slice(current.indexOf(marker)).trimEnd());
});

test("accepts valid UTF-8 JSON with CURRENT supported charset", async () => {
  const data = { table: "events", title: "日本語" };
  assert.deepEqual(await readSpreadsheetJsonBody(request(JSON.stringify(data), {
    "content-type": "application/json; charset=UTF-8",
  })), data);
});

test("rejects bad media type and charset before accessing body", async () => {
  for (const contentType of ["text/plain", "application/json; charset=shift_jis", "application/json; q=1", "application/json; charset=UTF-8; x=1"]) {
    let accessed = false;
    const fake = {
      headers: new Headers({ "content-type": contentType }),
      body: { getReader() { accessed = true; throw new Error("must not read"); } },
    };
    await assert.rejects(() => readSpreadsheetJsonBody(fake), /invalid_json/);
    assert.equal(accessed, false);
  }
});

test("rejects Content-Length overflow and malformed length before body read", async () => {
  for (const length of [String(SPREADSHEET_JSON_BODY_MAX_BYTES + 1), "NaN", "-1", "1.5"]) {
    let accessed = false;
    const fake = {
      headers: new Headers({ "content-type": "application/json", "content-length": length }),
      body: { getReader() { accessed = true; throw new Error("must not read"); } },
    };
    await assert.rejects(() => readSpreadsheetJsonBody(fake),
      new RegExp(length === String(SPREADSHEET_JSON_BODY_MAX_BYTES + 1) ? "payload_too_large" : "invalid_json"));
    assert.equal(accessed, false);
  }
});

test("rejects streamed bytes exceeding the budget even with forged Content-Length", async () => {
  const huge = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(SPREADSHEET_JSON_BODY_MAX_BYTES + 1));
      controller.close();
    },
  });
  const fake = {
    headers: new Headers({ "content-type": "application/json", "content-length": "1" }),
    body: huge,
  };
  await assert.rejects(() => readSpreadsheetJsonBody(fake), /payload_too_large/);
});

test("normalizes empty, malformed JSON and invalid UTF-8 to invalid_json", async () => {
  for (const body of ["", '{"table":', new Uint8Array([0x22, 0xc3, 0x28, 0x22])]) {
    await assert.rejects(() => readSpreadsheetJsonBody(request(body)), /invalid_json/);
  }
});
