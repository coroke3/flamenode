// MIG-0730 U01a: prevent silent divergence while Personal still imports its original pure helpers.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

for (const helper of ["delimited", "memberSuggestionRank", "clipboard"]) {
  test(`MIG-0730 U01a: shared ${helper} remains byte-identical to Personal until import switch`, async () => {
    const [personal, shared] = await Promise.all([
      readFile(new URL(`../../../apps/app/src/lib/${helper}.ts`, import.meta.url)),
      readFile(new URL(`../src/forms/videoMembers/${helper}.ts`, import.meta.url)),
    ]);
    assert.ok(personal.equals(shared),
      "do not change public member helper behavior during U01; complete the shared rewire explicitly");
  });
}
