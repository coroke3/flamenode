import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { snapshotAccessFromEnv } from "./snapshotEnv.ts";

function fixture(run) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-snapshot-root-"));
  const root = path.join(temp, "public");
  const manifestFile = path.join(temp, "manifest.json");
  fs.mkdirSync(path.join(root, "snapshot", "video"), { recursive: true });
  fs.writeFileSync(path.join(root, "snapshot", "video", "public.json"), '{"ok":true}');
  fs.writeFileSync(path.join(temp, "secret.json"), '{"private":true}');
  fs.writeFileSync(manifestFile, '{"schemaVersion":1,"generation":"generation-1","allowedKeys":[],"blockedKeys":[]}');
  const access = snapshotAccessFromEnv({
    FLAMENODE_SNAPSHOT_DIR: root,
    FLAMENODE_SNAPSHOT_MANIFEST_FILE: manifestFile,
    FLAMENODE_SNAPSHOT_GENERATION: "generation-1",
  });
  assert.ok(access);
  return Promise.resolve().then(() => run({ temp, root, access })).finally(() => {
    fs.rmSync(temp, { recursive: true, force: true });
  });
}

test("unset snapshot config remains disabled, partially configured builds fail closed", () => {
  assert.equal(snapshotAccessFromEnv({}), null);
  assert.throws(
    () => snapshotAccessFromEnv({ FLAMENODE_SNAPSHOT_DIR: "/tmp/fixture" }),
    /Snapshot env incomplete/,
  );
});

test("snapshot adapter reads ordinary nested keys without changing manifest or bytes", () =>
  fixture(async ({ access }) => {
    assert.deepEqual(access.options.manifest, {
      schemaVersion: 1, generation: "generation-1", allowedKeys: [], blockedKeys: [],
    });
    const bytes = await access.source.read("snapshot/video/public.json");
    assert.equal(new TextDecoder().decode(bytes), '{"ok":true}');
    assert.equal(await access.source.read("snapshot/video/missing.json"), null);
  }));

test("snapshot adapter rejects lexical traversal, sibling prefix and absolute paths", () =>
  fixture(async ({ temp, access }) => {
    for (const key of [
      "../secret.json", "snapshot/../../secret.json", "snapshot/video/../../../secret.json",
      path.join(temp, "secret.json"), "snapshot\\..\\..\\secret.json",
      ".", "", "snapshot/video/../../../../", "snapshot/video/\0private.json",
    ]) {
      assert.equal(await access.source.read(key), null, `must reject: ${JSON.stringify(key)}`);
    }
  }));

test("snapshot adapter rejects symlinked files/directories that point outside root", () =>
  fixture(async ({ temp, root, access }) => {
    fs.symlinkSync(path.join(temp, "secret.json"), path.join(root, "snapshot", "video", "external.json"));
    fs.symlinkSync(temp, path.join(root, "snapshot", "outsider"), "dir");
    assert.equal(await access.source.read("snapshot/video/external.json"), null);
    assert.equal(await access.source.read("snapshot/outsider/secret.json"), null);

    // Symlinks that resolve inside the configured root remain valid snapshots.
    fs.symlinkSync(
      path.join(root, "snapshot", "video", "public.json"),
      path.join(root, "snapshot", "video", "alias.json"),
    );
    const bytes = await access.source.read("snapshot/video/alias.json");
    assert.equal(new TextDecoder().decode(bytes), '{"ok":true}');
  }));
