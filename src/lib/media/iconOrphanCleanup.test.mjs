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

  async function withPoisonedDiagnosticSink(run) {
    const prior = console.error;
    const logs = [];
    console.error = (...args) => {
      logs.push(args);
      throw new Error("SEC774_LOGGER_FAILURE");
    };
    try {
      await run(logs);
    } finally {
      console.error = prior;
    }
  }

  function providerError() {
    const error = new Error("SEC774_PRIVATE_PROVIDER_PAYLOAD");
    Object.defineProperty(error, "name", {
      get() { throw new Error("SEC774_POISONED_ERROR_NAME"); },
    });
    return error;
  }

  test("SEC-774 D1 reference errors and throwing logger never delete the old icon", async () => {
    const deleted = [];
    const bucket = { delete: async (key) => deleted.push(key) };
    for (const failMode of ["sync", "async"]) {
      await withPoisonedDiagnosticSink(async (logs) => {
        const db = failMode === "sync"
          ? { prepare() { throw providerError(); } }
          : { prepare: () => ({ bind: () => ({ first: async () => { throw providerError(); } }) }) };
        await assert.doesNotReject(() => tryDeleteUnreferencedIcon(
          db, bucket, "/api/media/xicons/u/old.webp", "/api/media/xicons/u/new.webp",
        ));
        assert.deepEqual(logs, [["[icon-orphan-cleanup] reference check failed"]]);
      });
    }
    assert.deepEqual(deleted, [], "unknown reference state must fail closed");
  });

  test("SEC-774 failed R2 orphan deletion never exposes provider errors or throws from diagnostic sink", async () => {
    const db = { prepare: () => ({ bind: () => ({ first: async () => null }) }) };
    for (const [key, tag] of [
      ["xicons/u/old.webp", "x_icon_orphan_cleanup_failed"],
      ["video-icons/u/old.webp", "video_icon_orphan_cleanup_failed"],
    ]) {
      for (const failMode of ["sync", "async", "getter"]) {
        const attempts = [];
        const bucket = {
          delete(objectKey) {
            attempts.push(objectKey);
            if (failMode === "sync") throw providerError();
            return Promise.reject(providerError());
          },
        };
        if (failMode === "getter") {
          Object.defineProperty(bucket, "delete", {
            get() { throw providerError(); },
          });
        }
        await withPoisonedDiagnosticSink(async (logs) => {
          await assert.doesNotReject(() => tryDeleteUnreferencedIcon(
            db, bucket, "/api/media/" + key, "/api/media/" + key.replace("old", "new"),
          ));
          assert.deepEqual(logs, [[tag]], "fixed diagnostic code only, no provider Error");
        });
        assert.deepEqual(attempts, failMode === "getter" ? [] : [key]);
      }
    }
  });

  test("SEC-774 healthy orphan deletion still removes only the unreferenced object without warning", async () => {
    const deleted = [];
    const db = { prepare: () => ({ bind: () => ({ first: async () => null }) }) };
    const bucket = { delete: async (key) => { deleted.push(key); } };
    await withPoisonedDiagnosticSink(async (logs) => {
      await tryDeleteUnreferencedIcon(
        db, bucket, "/api/media/video-icons/a/old.webp", "/api/media/video-icons/a/new.webp",
      );
      assert.deepEqual(logs, []);
    });
    assert.deepEqual(deleted, ["video-icons/a/old.webp"]);
  });

}
