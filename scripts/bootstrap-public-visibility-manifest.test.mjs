import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { bootstrapPublicVisibilityManifest } from "./bootstrap-public-visibility-manifest.mjs";

test("package bootstrap command enables Node TypeScript stripping", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.match(
    packageJson.scripts["cf:bootstrap-visibility"],
    /^node --experimental-strip-types scripts\/bootstrap-public-visibility-manifest\.mjs$/,
  );
});

test("visibility bootstrap creates only when the object is missing", () => {
  let writes = 0;
  const result = bootstrapPublicVisibilityManifest({
    nowSec: 100,
    read: () => ({ found: false }),
    put: (body) => {
      writes += 1;
      const parsed = JSON.parse(body);
      assert.deepEqual(parsed, {
        schema_version: 1,
        revision: 0,
        generated_at: 100,
        entities: [],
      });
    },
  });
  assert.equal(result.action, "created");
  assert.equal(writes, 1);
});

test("visibility bootstrap is idempotent for an existing valid manifest", () => {
  let writes = 0;
  const result = bootstrapPublicVisibilityManifest({
    read: () => ({
      found: true,
      body: JSON.stringify({
        schema_version: 1,
        revision: 4,
        generated_at: 100,
        entities: [],
      }),
    }),
    put: () => {
      writes += 1;
    },
  });
  assert.equal(result.action, "already_exists");
  assert.equal(writes, 0);
});

test("visibility bootstrap refuses to overwrite a malformed manifest", () => {
  let writes = 0;
  assert.throws(
    () =>
      bootstrapPublicVisibilityManifest({
        read: () => ({
          found: true,
          body: JSON.stringify({ schema_version: 99, entities: [] }),
        }),
        put: () => {
          writes += 1;
        },
      }),
    /refusing overwrite/,
  );
  assert.equal(writes, 0);
});
