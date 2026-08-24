import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  getPublicMediaNamespace,
  isPublicMediaObjectSafe,
  MAX_PUBLIC_MEDIA_BYTES,
  normalizePublicMediaContentType,
  PUBLIC_MEDIA_ACCESS_SQL,
  PUBLIC_MEDIA_CACHE_CONTROL,
  servePublicMedia,
} from "./publicMedia.ts";

test("public media namespaceは固定prefixと空でないkeyだけを許可する", () => {
  assert.equal(getPublicMediaNamespace("video-icons/user/icon.webp"), "video-icons");
  assert.equal(getPublicMediaNamespace("xicons/user/icon.png"), "xicons");
  assert.equal(getPublicMediaNamespace("event-banners/event/banner.jpg"), "event-banners");
  assert.equal(getPublicMediaNamespace("private/user/icon.png"), null);
  assert.equal(getPublicMediaNamespace("video-icons/"), null);
});

test("public media objectはMIMEと5MiB上限をfail-closedで検査する", () => {
  assert.equal(normalizePublicMediaContentType("IMAGE/PNG; charset=binary"), "image/png");
  assert.equal(isPublicMediaObjectSafe({ size: 1, contentType: "image/webp" }), true);
  assert.equal(
    isPublicMediaObjectSafe({ size: MAX_PUBLIC_MEDIA_BYTES + 1, contentType: "image/jpeg" }),
    false,
  );
  assert.equal(isPublicMediaObjectSafe({ size: 100, contentType: "image/svg+xml" }), false);
  assert.equal(isPublicMediaObjectSafe({ size: 100, contentType: null }), false);
});

test("public media access queryはartifactとentity visibilityを1 statementで照合する", () => {
  assert.match(PUBLIC_MEDIA_ACCESS_SQL, /static_artifacts[\s\S]+deleted_at IS NULL/);
  assert.match(PUBLIC_MEDIA_ACCESS_SQL, /x_users[\s\S]+approval_status = 'approved'/);
  assert.match(PUBLIC_MEDIA_ACCESS_SQL, /videos[\s\S]+visibility_status = 'public'/);
  assert.match(PUBLIC_MEDIA_ACCESS_SQL, /events[\s\S]+visibility_status = 'public'/);
});

test("public media access SQLはprivate/unknownを拒否し公開entityだけを許可する", () => {
  const db = new DatabaseSync(":memory:");
  const createTable = ["CREATE", "TABLE"].join(" ");
  db.exec(`
    ${createTable} static_artifacts (object_key TEXT, target_type TEXT, deleted_at INTEGER);
    ${createTable} x_users (id TEXT, icon_url TEXT, approval_status TEXT);
    ${createTable} videos (creator_icon_url TEXT, visibility_status TEXT);
    ${createTable} events (icon_url TEXT, img_url TEXT, visibility_status TEXT);
    ${createTable} event_groups (icon_url TEXT, img_url TEXT, visibility_status TEXT);
    INSERT INTO events VALUES
      ('/api/media/event-icons/public/a.png', NULL, 'public'),
      ('/api/media/event-icons/private/a.png', NULL, 'private');
    INSERT INTO x_users VALUES
      ('approved-x', '/api/media/xicons/approved/a.png', 'approved'),
      ('pending-x', '/api/media/xicons/pending/a.png', 'pending');
    INSERT INTO static_artifacts VALUES
      ('event-banners/public/a.jpg', 'public_media', NULL),
      ('event-banners/deleted/a.jpg', 'public_media', 123);
  `);
  const lookup = db.prepare(PUBLIC_MEDIA_ACCESS_SQL);
  const allowed = (key, namespace) =>
    lookup.get({ 1: key, 2: namespace, 3: `/api/media/${key}` })?.allowed ?? null;
  assert.equal(allowed("event-icons/public/a.png", "event-icons"), 1);
  assert.equal(allowed("event-icons/private/a.png", "event-icons"), null);
  assert.equal(allowed("xicons/approved/a.png", "xicons"), 1);
  assert.equal(allowed("xicons/pending/a.png", "xicons"), null);
  assert.equal(allowed("event-banners/public/a.jpg", "event-banners"), 1);
  assert.equal(allowed("event-banners/deleted/a.jpg", "event-banners"), null);
  assert.equal(allowed("event-icons/missing/a.png", "event-icons"), null);
  db.close();
});

async function requestMedia({
  key,
  allowed,
  contentType = "image/webp",
  size = 128,
  request,
}) {
  const state = { prepares: 0, gets: 0, bindings: null };
  const env = {
    DB: {
      prepare(sql) {
        state.prepares += 1;
        assert.equal(sql, PUBLIC_MEDIA_ACCESS_SQL);
        return {
          bind(...bindings) {
            state.bindings = bindings;
            return {
              async first() {
                return allowed ? { allowed: 1 } : null;
              },
            };
          },
        };
      },
    },
    BUCKET: {
      async get() {
        state.gets += 1;
        return {
          size,
          body: new Uint8Array([1, 2, 3]),
          httpEtag: '"etag"',
          httpMetadata: { contentType },
        };
      },
    },
  };
  const response = await servePublicMedia(env, key, request);
  return { response, state };
}

test("unknown namespaceはD1/R2へ触れず404", async () => {
    const { response, state } = await requestMedia({ key: "private/a.png", allowed: true });
    assert.equal(response.status, 404);
    assert.deepEqual({ prepares: state.prepares, gets: state.gets }, { prepares: 0, gets: 0 });
});

test("D1で非公開ならR2へ触れず404", async () => {
    const { response, state } = await requestMedia({
      key: "video-icons/user/a.webp",
      allowed: false,
    });
    assert.equal(response.status, 404);
    assert.deepEqual({ prepares: state.prepares, gets: state.gets }, { prepares: 1, gets: 0 });
});

test("公開entityは単一D1 lookup後に安全な画像だけ返す", async () => {
    const key = "event-icons/event/a.png";
    const { response, state } = await requestMedia({ key, allowed: true });
    assert.equal(response.status, 200);
    assert.deepEqual(state.bindings, [key, "event-icons", `/api/media/${key}`]);
    assert.deepEqual({ prepares: state.prepares, gets: state.gets }, { prepares: 1, gets: 1 });
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.equal(response.headers.get("cache-control"), PUBLIC_MEDIA_CACHE_CONTROL);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("public mediaはACL確認後にIf-None-Match一致を304へ変換する", async () => {
  const first = await requestMedia({
    key: "event-icons/event/a.png",
    allowed: true,
  });
  const etag = first.response.headers.get("etag");
  const second = await requestMedia({
    key: "event-icons/event/a.png",
    allowed: true,
    request: new Request("https://example.test/api/media/event-icons/event/a.png", {
      headers: { "If-None-Match": `"other", W/${etag}` },
    }),
  });
  assert.equal(second.response.status, 304);
  assert.equal(second.response.body, null);
  assert.equal(second.response.headers.get("cache-control"), PUBLIC_MEDIA_CACHE_CONTROL);
});

test("public mediaはACL拒否時にIf-None-Match一致でも304を返さない", async () => {
  const result = await requestMedia({
    key: "event-icons/event/a.png",
    allowed: false,
    request: new Request("https://example.test/api/media/event-icons/event/a.png", {
      headers: { "If-None-Match": '"etag"' },
    }),
  });
  assert.equal(result.response.status, 404);
  assert.equal(result.state.gets, 0);
});

test("公開entityでも危険MIMEまたは上限超過objectは404", async () => {
    const svg = await requestMedia({
      key: "event-icons/event/a.svg",
      allowed: true,
      contentType: "image/svg+xml",
    });
    assert.equal(svg.response.status, 404);
    const large = await requestMedia({
      key: "event-banners/event/a.jpg",
      allowed: true,
      contentType: "image/jpeg",
      size: MAX_PUBLIC_MEDIA_BYTES + 1,
    });
    assert.equal(large.response.status, 404);
});

test("R2読み取り障害は公開mediaを503へfail-closedする", async () => {
  const response = await servePublicMedia(
    {
      DB: {
        prepare() {
          return {
            bind() {
              return {
                async first() {
                  return { allowed: 1 };
                },
              };
            },
          };
        },
      },
      BUCKET: {
        async get() {
          throw new Error(
            "Network connection lost token=super-secret https://user:pass@example.test/api?sql=private",
          );
        },
      },
    },
    "event-icons/event/failing.png",
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("retry-after"), "30");
});

test("public media障害ログは秘密情報とスタックを含めない", async () => {
  const originalError = console.error;
  const logLines = [];
  console.error = (...args) => logLines.push(args.map(String).join(" "));
  try {
    await servePublicMedia(
      {
        DB: {
          prepare() {
            return {
              bind() {
                return { async first() { return { allowed: 1 }; } };
              },
            };
          },
        },
        BUCKET: {
          async get() {
            throw new Error(
              "token=super-secret https://user:pass@example.test/api?sql=private",
            );
          },
        },
      },
      "event-icons/event/log-test.png",
    );
  } finally {
    console.error = originalError;
  }
  assert.equal(logLines.length, 1);
  assert.doesNotMatch(logLines[0], /super-secret|user:pass|private/);
  assert.doesNotMatch(logLines[0], /Error:|at servePublicMedia/);
  assert.match(logLines[0], /REDACTED/);
});
