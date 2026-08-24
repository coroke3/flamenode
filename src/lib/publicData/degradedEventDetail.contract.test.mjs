import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./degradedQueries.ts", import.meta.url), "utf8");

test("degraded event detailはevent_baseと同じ公開集合を上映順で返す", () => {
  const start = source.indexOf("export async function fetchDegradedEventDetailPayload(");
  const end = source.indexOf("\nasync function resolveVideoByRawId", start);
  const detail = source.slice(start, end);

  assert.match(detail, /countablePublicVideoCondition/);
  assert.match(detail, /eventPublicVideoLinkCondition\(eventId\)/);
  assert.match(
    detail,
    /videos\.scheduled_time\} IS NULL ASC, \$\{videos\.scheduled_time\} ASC, \$\{videos\.id\} ASC/,
  );
  assert.doesNotMatch(detail, /innerJoin\(videoEvents/);
  assert.doesNotMatch(detail, /desc\(videos\.scheduled_time\)/);
});

test("degraded video detail includes a public primary event without a junction row", () => {
  const start = source.indexOf("export async function fetchDegradedVideoDetailPayload(");
  const end = source.indexOf("\nexport async function fetchDegradedUserProfilePayload", start);
  const detail = source.slice(start, end);

  assert.match(detail, /const linkedPublicEvent = exists\(/);
  assert.match(detail, /const primaryPublicEvent = video\.primary_event_id/);
  assert.match(detail, /or\(linkedPublicEvent, primaryPublicEvent\)/);
  assert.doesNotMatch(
    detail,
    /\.innerJoin\(videoEvents, eq\(videoEvents\.event_id, events\.id\)\)/,
  );
});
