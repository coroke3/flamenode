import assert from "node:assert/strict";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { maxQuestionsForEvents } = await import("./customQuestionAnswers.ts");
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./customQuestionAnswers.ts", import.meta.url), "utf8");

  test("複数イベントの質問読取上限はイベント単位で積算する", () => {
    assert.equal(maxQuestionsForEvents([]), 18);
    assert.equal(maxQuestionsForEvents(["event-a"]), 18);
    assert.equal(maxQuestionsForEvents(["event-a", "event-a", "event-b"]), 36);
  });

  test("質問読取は event ID を D1 bind 上限内へ分割する", () => {
    assert.match(source, /D1_CUSTOM_QUESTION_EVENT_ID_CHUNK_SIZE = 80/);
    assert.match(
      source,
      /for \(const chunk of chunkEventIds\(ids, D1_CUSTOM_QUESTION_EVENT_ID_CHUNK_SIZE\)\)/,
    );
  });
}
