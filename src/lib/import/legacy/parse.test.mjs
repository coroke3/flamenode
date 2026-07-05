import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseLegacyImportText, parseCsv } from "./parse.ts";

describe("parseLegacyImportText", () => {
  it("parses JSON array", () => {
    const result = parseLegacyImportText("data.json", '[{"eventid":"ev1","eventname":"Test"}]');
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);
    assert.equal(result[0].eventid, "ev1");
  });

  it("parses wrapped JSON with events key", () => {
    const result = parseLegacyImportText(
      "data.json",
      JSON.stringify({ events: [{ eventid: "ev1", eventname: "Test" }], videos: [] }),
    );
    assert.ok(result && typeof result === "object" && "events" in result);
  });

  it("parses CSV by extension", () => {
    const csv = "eventid,eventname\nev1,Test Event\nev2,Another";
    const result = parseLegacyImportText("data.csv", csv);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 2);
    assert.equal(result[0].eventid, "ev1");
  });

  it("strips BOM from JSON", () => {
    const result = parseLegacyImportText("data.json", '\uFEFF{"eventid":"ev1"}');
    assert.ok(result && typeof result === "object");
  });

  it("throws on unparseable content", () => {
    assert.throws(() => parseLegacyImportText("data.json", "not json at all !!!"), /not-json/);
  });
});

describe("parseCsv", () => {
  it("parses TSV by detected delimiter", () => {
    const csv = "eventid\teventname\nev1\tTest";
    const result = parseCsv(csv);
    assert.equal(result.length, 1);
    assert.equal(result[0].eventid, "ev1");
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(parseCsv(""), []);
  });

  it("returns empty array for header only", () => {
    assert.deepEqual(parseCsv("eventid,eventname"), []);
  });
});
