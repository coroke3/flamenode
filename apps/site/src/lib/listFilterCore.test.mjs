import assert from "node:assert/strict";
import { test } from "node:test";
import { decodePublicList, listQueryFromSearch, shouldSuppressListSearchKeydown } from "./listFilterCore.ts";

const dto = (id) => ({
  id, title: "公開作品", youtube_video_id: null, display_name: "作者",
  icon_url: null, primary_event_id: null, scheduled_time: null, status: "public",
});
const payload = (page, total, items) => ({
  page, total, items, limit: 24,
});

test("RH-032 public list rejects more returned items than reported total", () => {
  const query = listQueryFromSearch("");
  assert.equal(decodePublicList(payload(1, 0, [dto("one")]), query), null);
  assert.equal(decodePublicList(payload(1, 1, [dto("one"), dto("two")]), query), null);
  assert.equal(decodePublicList(payload(1, 1, [dto("one")]), query)?.videos.length, 1);
  assert.equal(decodePublicList(payload(1, 0, []), query)?.totalPages, 1);
});

test("RH-032 page offsets must fit in total when page has items", () => {
  const second = listQueryFromSearch("?page=2");
  assert.equal(decodePublicList(payload(2, 24, [dto("one")]), second), null);
  assert.equal(decodePublicList(payload(2, 25, [dto("one")]), second)?.totalPages, 2);
  assert.equal(decodePublicList(payload(2, 25, [dto("one"), dto("two")]), second), null);
  assert.equal(decodePublicList(payload(2, 100, []), second)?.videos.length, 0);
});

test("RH-032 last projected page boundary admits exactly the remaining items", () => {
  // CURRENT caps the 5,000-item projection at ceil(5000 / 24) = page 209.
  const last = listQueryFromSearch("?page=209");
  const eight = Array.from({ length: 8 }, (_, i) => dto(`last-${i}`));
  assert.equal(last.page, 209);
  assert.equal(decodePublicList(payload(209, 5000, eight), last)?.videos.length, 8);
  assert.equal(decodePublicList(payload(209, 5000, [...eight, dto("overflow")]), last), null);
  assert.equal(decodePublicList(payload(209, 4999, eight), last), null);
});

test("RH-032 still rejects non-public rows and mismatched page numbers", () => {
  const query = listQueryFromSearch("?page=2");
  assert.equal(decodePublicList(payload(1, 25, [dto("one")]), query), null);
  assert.equal(decodePublicList(payload(2, 25, [{ ...dto("one"), status: "private" }]), query), null);
});

test("RH-032 refuses duplicate public video IDs within the same result page", () => {
  const first = listQueryFromSearch("");
  assert.equal(decodePublicList(payload(1, 2, [dto("one"), dto("one")]), first), null);
  assert.equal(decodePublicList(payload(1, 2, [dto("one"), dto("two")]), first)?.videos.length, 2);
  const second = listQueryFromSearch("?page=2");
  assert.equal(decodePublicList(payload(2, 26, [dto("one"), dto("one")]), second), null);
});

test("list search suppresses composing Enter without breaking normal IME keystrokes", () => {
  for (const input of [
    { key: "Enter", isComposing: true, keyCode: 13 },
    { key: "Enter", isComposing: false, keyCode: 229 },
    { key: "Enter", isComposing: true, keyCode: 229 },
  ]) assert.equal(shouldSuppressListSearchKeydown(input), true, JSON.stringify(input));
  for (const input of [
    { key: "Enter", isComposing: false, keyCode: 13 },
    { key: "Process", isComposing: true, keyCode: 229 },
    { key: "Unidentified", isComposing: true, keyCode: 229 },
    { key: "a", isComposing: true, keyCode: 229 },
    { key: "a", isComposing: false, keyCode: 65 },
    { key: "Tab", isComposing: false, keyCode: 9 },
  ]) assert.equal(shouldSuppressListSearchKeydown(input), false, JSON.stringify(input));
});
