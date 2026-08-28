import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  parseExternalRetryAfterMs,
  proxyExternalImage,
} from "./externalImageProxy.ts";

const source = await readFile(new URL("./externalImageProxy.ts", import.meta.url), "utf8");

test("外部画像Retry-Afterは秒・HTTP-date・上限を解釈する", () => {
  assert.equal(parseExternalRetryAfterMs("5", 60_000), 5_000);
  assert.equal(parseExternalRetryAfterMs("120", 60_000), 60_000);
  assert.equal(
    parseExternalRetryAfterMs("Thu, 01 Jan 1970 00:00:05 GMT", 60_000, 1_000),
    4_000,
  );
});

test("外部画像はinline retryせずnegative cacheとstaleを優先する", () => {
  assert.match(source, /store\.failures\.set/);
  assert.match(source, /Math\.max\(options\.failureTtlMs, retryAfter \?\? 0\)/);
  assert.match(source, /cached && cached\.staleUntil > now/);
  assert.doesNotMatch(source, /for \(let attempt/);
});

test("Workers isolate globalへrequest-scoped fetch Promiseを保存しない", () => {
  assert.doesNotMatch(source, /inFlight:/);
  assert.doesNotMatch(source, /store\.inFlight/);
  assert.doesNotMatch(source, /Map<string, Promise<RefreshResult>>/);
  assert.match(source, /await refreshImage\(store, options, cached, now\)/);
});

test("cache hit responseは画像buffer全体のsliceコピーを作らない", () => {
  const responseStart = source.indexOf("function imageResponse(");
  const responseEnd = source.indexOf("function fallbackResponse(", responseStart);
  const responseSource = source.slice(responseStart, responseEnd);
  assert.match(
    responseSource,
    /new Response\(entry\.bytes\.buffer as ArrayBuffer, \{ headers \}\)/,
  );
  assert.doesNotMatch(responseSource, /entry\.bytes\.slice\(\)/);
});

test("外部画像はSVG・未指定MIMEを受け付けずnosniffで返す", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("<svg><script>alert(1)</script></svg>", {
      status: 200,
      headers: { "content-type": "image/svg+xml" },
    });
  };
  try {
    const response = await proxyExternalImage({
      namespace: `external-image-svg-${Date.now()}-${Math.random()}`,
      cacheKey: "svg",
      upstreamUrl: "https://upstream.example/image",
      fallbackSvg: "<svg>fallback</svg>",
    });
    assert.equal(response.headers.get("x-fn-upstream-status"), "200");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await response.text(), "<svg>fallback</svg>");
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("外部画像の上限超過はbodyを全量bufferせずstreamをcancelする", async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  let pulls = 0;
  globalThis.fetch = async () => {
    const body = new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array([1, 2, 3]));
        if (pulls >= 100) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  };
  try {
    const response = await proxyExternalImage({
      namespace: `external-image-limit-${Date.now()}-${Math.random()}`,
      cacheKey: "oversized",
      upstreamUrl: "https://upstream.example/large",
      fallbackSvg: "<svg>fallback</svg>",
      maxObjectBytes: 4,
    });
    assert.equal(response.headers.get("x-fn-upstream-status"), "413");
    assert.equal(await response.text(), "<svg>fallback</svg>");
    assert.equal(cancelled, true);
    assert.equal(pulls < 100, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
