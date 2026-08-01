import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

if (process.env.FLAMENODE_ICON_ORPHAN_EXECUTION !== "1") {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", fileURLToPath(import.meta.url)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_ICON_ORPHAN_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return {
          url: "data:text/javascript,export%20{}",
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  const {
    extractPublicMediaKeyFromUrl,
    tryDeleteUnreferencedIcon,
  } = await import("./iconOrphanCleanup.ts");

  test("extractPublicMediaKeyFromUrl accepts only /api/media keys", () => {
    assert.equal(
      extractPublicMediaKeyFromUrl("/api/media/xicons/alice/abc.webp"),
      "xicons/alice/abc.webp",
    );
    assert.equal(extractPublicMediaKeyFromUrl("https://cdn.example/x.png"), null);
    assert.equal(extractPublicMediaKeyFromUrl("/api/media/../secret"), null);
    assert.equal(extractPublicMediaKeyFromUrl("/api/media/xicons\\evil"), null);
    assert.equal(extractPublicMediaKeyFromUrl("javascript:alert(1)"), null);
  });

  test("tryDeleteUnreferencedIcon skips staging, external, referenced, and check failures", async () => {
    const deleted = [];
    const bucket = {
      delete: async (key) => {
        deleted.push(key);
      },
    };

    await tryDeleteUnreferencedIcon(
      { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
      bucket,
      "https://example.com/icon.png",
      "/api/media/xicons/a/new.webp",
    );
    assert.deepEqual(deleted, []);

    await tryDeleteUnreferencedIcon(
      { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
      bucket,
      "/api/media/xicons/staging/u1/old.webp",
      "/api/media/xicons/a/new.webp",
    );
    assert.deepEqual(deleted, []);

    await tryDeleteUnreferencedIcon(
      {
        prepare: () => ({
          bind: () => ({ first: async () => ({ referenced: 1 }) }),
        }),
      },
      bucket,
      "/api/media/video-icons/a/old.webp",
      "/api/media/video-icons/a/new.webp",
    );
    assert.deepEqual(deleted, []);

    await tryDeleteUnreferencedIcon(
      {
        prepare: () => ({
          bind: () => ({
            first: async () => {
              throw new Error("d1 down");
            },
          }),
        }),
      },
      bucket,
      "/api/media/xicons/a/old.webp",
      "/api/media/xicons/a/new.webp",
    );
    assert.deepEqual(deleted, []);

    await tryDeleteUnreferencedIcon(
      { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
      bucket,
      "/api/media/xicons/a/old.webp",
      "/api/media/xicons/a/new.webp",
    );
    assert.deepEqual(deleted, ["xicons/a/old.webp"]);
  });
}
