import { test } from "node:test";
import assert from "node:assert/strict";
import { cn } from "./cn.ts";

test("cn: truthy のみスペース連結", () => {
  assert.equal(cn("a", "b", "c"), "a b c");
});

test("cn: undefined / null / false / 空文字を除外", () => {
  assert.equal(cn("a", undefined, "b", null, false, "", "c"), "a b c");
});

test("cn: 全部 falsy なら空文字", () => {
  assert.equal(cn(undefined, null, false, ""), "");
});

test("cn: 単一引数", () => {
  assert.equal(cn("only"), "only");
});

test("cn: 引数なし", () => {
  assert.equal(cn(), "");
});
