import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deletePublicJsonCache,
  deletePublicJsonCaches,
  publicJsonCacheUrl,
} from "../src/publicCache/delete.ts";
import { deletePublicJsonCacheBestEffort } from "../src/publicCache/readWrite.ts";

const KEY = "public-event-export:9:event-1:v5:15";

async function withThrowingWarn(fn) {
  const previous = console.warn;
  const calls = [];
  console.warn = (...args) => {
    calls.push(args);
    throw new Error("SEC767_LOG_SINK_FAILURE");
  };
  try {
    await fn(calls);
  } finally {
    console.warn = previous;
  }
  return calls;
}

test("SEC-767 Hono cache delete failure and throwing logger never reject a fresh export", async () => {
  for (const mode of ["sync", "async", "getter"]) {
    const providerError = new Error("SEC767_PRIVATE_PROVIDER_DIAGNOSTIC");
    Object.defineProperty(providerError, "name", {
      get() { throw new Error("SEC767_POISONED_PROVIDER_NAME"); },
    });
    const attempted = [];
    const cache = {
      delete(request) {
        attempted.push(request.url);
        if (mode === "sync") throw providerError;
        return Promise.reject(providerError);
      },
    };
    if (mode === "getter") {
      Object.defineProperty(cache, "delete", {
        get() { throw providerError; },
      });
    }
    const calls = await withThrowingWarn(async () => {
      await assert.doesNotReject(() =>
        deletePublicJsonCacheBestEffort(KEY, { cache }),
      );
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ["[public-cache] cache_api_delete_failed"]);
    assert.deepEqual(attempted, mode === "getter" ? [] : [publicJsonCacheUrl(KEY)]);
  }
});

test("SEC-767 Next cache deletion continues to later keys despite warning failure", async () => {
  const dropped = [];
  const attempted = [];
  const providerError = new Error("SEC767_SECRET_FROM_EDGE_DELETE");
  Object.defineProperty(providerError, "name", {
    get() { throw new Error("SEC767_NAME_READ"); },
  });
  const host = {
    dropIsolateEntry(key) { dropped.push(key); },
    readEdgeCache() {
      return {
        async delete(url) {
          attempted.push(url);
          if (attempted.length === 1) throw providerError;
          return true;
        },
      };
    },
  };
  const keys = [KEY, "public-event-export:9:event-2:legacy:15"];
  const calls = await withThrowingWarn(async () => {
    await assert.doesNotReject(() => deletePublicJsonCaches(keys, host));
  });
  assert.deepEqual(dropped, keys);
  assert.deepEqual(attempted, keys.map(publicJsonCacheUrl));
  assert.deepEqual(calls, [["[public-cache] cache_api_delete_failed"]]);
});

test("SEC-767 successful Cache API deletes preserve return and emit no warning", async () => {
  const attempted = [];
  const host = {
    cache: {
      async delete(request) {
        attempted.push(request.url);
        return true;
      },
    },
  };
  const calls = await withThrowingWarn(async () => {
    await assert.doesNotReject(() => deletePublicJsonCacheBestEffort(KEY, host));
  });
  assert.deepEqual(attempted, [publicJsonCacheUrl(KEY)]);
  assert.equal(calls.length, 0);
});

test("SEC-767 Next local isolate invalidation remains first and is not silently skipped", async () => {
  const order = [];
  const host = {
    dropIsolateEntry(key) { order.push("isolate:" + key); },
    readEdgeCache() {
      return { async delete() { order.push("edge"); return true; } };
    },
  };
  await deletePublicJsonCache(KEY, host);
  assert.deepEqual(order, ["isolate:" + KEY, "edge"]);
});
