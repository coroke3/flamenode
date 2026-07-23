/**
 * operation_mode 別の公開 JSON ローダー挙動。
 *
 * Usage: node --test src/lib/publicData/loader.test.mjs
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canFallbackToDatabase,
  isMaintenanceStrategy,
  shouldUseStaticCollection,
} from "./loaderPolicy.ts";

const loaderSource = await readFile(new URL("./loader.ts", import.meta.url), "utf8");

test("canFallbackToDatabase: overlay のみ DB fallback 可", () => {
  assert.equal(canFallbackToDatabase("static_json_with_live_overlay"), true);
  assert.equal(canFallbackToDatabase("static_json_only"), false);
  assert.equal(canFallbackToDatabase("maintenance"), false);
});

test("isMaintenanceStrategy", () => {
  assert.equal(isMaintenanceStrategy("maintenance"), true);
  assert.equal(isMaintenanceStrategy("static_json_only"), false);
});

test("overlay treats an empty static collection as a DB fallback miss", () => {
  assert.equal(
    shouldUseStaticCollection("static_json_with_live_overlay", 0),
    false,
  );
  assert.equal(
    shouldUseStaticCollection("static_json_with_live_overlay", 1),
    true,
  );
  assert.equal(shouldUseStaticCollection("static_json_only", 0), true);
  assert.equal(shouldUseStaticCollection("maintenance", 0), true);
});

test("loader exposes paginated user profile loaders", () => {
  assert.match(loaderSource, /loadStaticUserWorksPage/);
  assert.match(loaderSource, /loadStaticUserCollabsPage/);
  assert.match(loaderSource, /users\/\$\{params\.userId\}\/works\//);
});

test("loader は R2 を先に読み、ヒット時は allowD1:false で mode 解決する", () => {
  const loadPublicJsonFn = loaderSource.slice(
    loaderSource.indexOf("export async function loadPublicJson"),
  );
  const r2Index = loadPublicJsonFn.indexOf("readStaticJson");
  const hitIndex = loadPublicJsonFn.indexOf("if (payload !== null)");
  const hitModeIndex = loadPublicJsonFn.indexOf(
    "resolvePublicOperationMode({ allowD1: false",
  );
  assert.ok(r2Index >= 0 && hitIndex > r2Index, "R2 read precedes hit branch");
  assert.ok(hitModeIndex > hitIndex, "hit path resolves mode without D1");
  assert.match(loaderSource, /async function resolvePublicJsonMiss/);
  assert.match(
    loaderSource,
    /resolvePublicOperationMode\(\{ allowD1: true/,
  );
  assert.doesNotMatch(loaderSource, /getOperationMode/);
  assert.doesNotMatch(loaderSource, /return "normal"/);
});

test("loader の R2 ヒット分岐は getDatabase を呼ばない", () => {
  const hitIndex = loaderSource.indexOf("if (payload !== null)");
  const loadPublicJsonFn = loaderSource.slice(
    loaderSource.indexOf("export async function loadPublicJson"),
  );
  const hitBranch = loadPublicJsonFn.slice(
    loadPublicJsonFn.indexOf("if (payload !== null)"),
    loadPublicJsonFn.indexOf("return resolvePublicJsonMiss"),
  );
  assert.ok(hitIndex >= 0);
  assert.doesNotMatch(hitBranch, /getDatabase\(/);
  assert.doesNotMatch(hitBranch, /systemSettings/);
  assert.doesNotMatch(hitBranch, /enqueueStaticRebuild/);
});

test("loader records public request metrics hooks", () => {
  assert.match(loaderSource, /recordPublicStaticHit/);
  assert.match(loaderSource, /recordPublicStaticMiss/);
  assert.match(loaderSource, /recordPublicR2Get/);
  assert.match(loaderSource, /recordPublicD1Query/);
});

test("createPublicJsonLoader treats normalize failure as semantic miss", () => {
  assert.match(loaderSource, /async function resolvePublicJsonMiss/);
  assert.match(
    loaderSource,
    /const normalized = normalize\(result\.data\);[\s\S]*return resolvePublicJsonMiss\(options\)/,
  );
});
