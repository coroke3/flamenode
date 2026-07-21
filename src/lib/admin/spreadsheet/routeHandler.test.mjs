import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = await readFile(
  new URL("./routeHandler.ts", import.meta.url),
  "utf8",
);
const readerStart = source.indexOf(
  "export const SPREADSHEET_JSON_BODY_MAX_BYTES",
);
assert.notEqual(readerStart, -1, "bounded JSON reader source must exist");
const readerModule = await import(
  `data:text/javascript;base64,${Buffer.from(
    stripTypeScriptTypes(source.slice(readerStart), { mode: "transform" }),
  ).toString("base64")}`
);

const {
  SPREADSHEET_JSON_BODY_MAX_BYTES,
  readSpreadsheetJsonBody,
} = readerModule;

function jsonRequest(body, headers = {}) {
  return new Request("https://example.test/api/admin/spreadsheet/data", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

test("valid JSONをcharset付きContent-Typeで読む", async () => {
  const payload = { table: "events", value: "日本語" };
  const request = jsonRequest(JSON.stringify(payload), {
    "content-type": "application/json; charset=UTF-8",
  });
  assert.deepEqual(await readSpreadsheetJsonBody(request), payload);
});

test("application/json以外のContent-Typeをbody読取前に拒否する", async () => {
  let readerRequested = false;
  const request = {
    headers: new Headers({ "content-type": "text/plain" }),
    body: {
      getReader() {
        readerRequested = true;
        throw new Error("body must not be read");
      },
    },
  };
  await assert.rejects(() => readSpreadsheetJsonBody(request), /invalid_json/);
  assert.equal(readerRequested, false);
});

test("Content-Length超過をstream読取前に拒否する", async () => {
  let readerRequested = false;
  const request = {
    headers: new Headers({
      "content-type": "application/json",
      "content-length": String(SPREADSHEET_JSON_BODY_MAX_BYTES + 1),
    }),
    body: {
      getReader() {
        readerRequested = true;
        throw new Error("body must not be read");
      },
    },
  };
  await assert.rejects(
    () => readSpreadsheetJsonBody(request),
    /payload_too_large/,
  );
  assert.equal(readerRequested, false);
});

test("Content-Lengthが小さくても実測UTF-8 byte超過を拒否する", async () => {
  const oversized = `"${"あ".repeat(
    Math.ceil(SPREADSHEET_JSON_BODY_MAX_BYTES / 3),
  )}"`;
  const request = jsonRequest(oversized, { "content-length": "1" });
  await assert.rejects(
    () => readSpreadsheetJsonBody(request),
    /payload_too_large/,
  );
});

test("空bodyと不正JSONをinvalid_jsonに正規化する", async () => {
  await assert.rejects(
    () => readSpreadsheetJsonBody(jsonRequest("")),
    /invalid_json/,
  );
  await assert.rejects(
    () => readSpreadsheetJsonBody(jsonRequest('{"table":')),
    /invalid_json/,
  );
});
