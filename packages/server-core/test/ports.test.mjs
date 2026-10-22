import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as serverCore from "@flamenode/server-core";
import * as ports from "@flamenode/server-core/ports";

test("package entry and ports resolve and carry no runtime values", () => {
  assert.deepEqual(Object.keys(serverCore), []);
  assert.deepEqual(Object.keys(ports), []);
});

test("package.json depends on no framework or host package", () => {
  const manifest = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  const forbidden = names.filter(
    (name) =>
      name === "next" ||
      name === "react" ||
      name === "hono" ||
      name === "astro" ||
      name === "server-only" ||
      name.startsWith("@opennextjs/") ||
      name === "@flamenode/domain",
  );
  assert.deepEqual(forbidden, []);
});
