import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicXIconMapPayloadFromProjection,
  hasProjectedPublicProfile,
  normalizePublicXIconMap,
  resolveProjectedIcon,
  publicXIconEntriesToMap,
} from "./publicIconProjection.ts";

test("registered iconがhistoricalより優先される", () => {
  const payload = buildPublicXIconMapPayloadFromProjection(
    {
      registeredUsers: [
        { id: "User_A", icon_url: "https://example.com/reg.webp" },
      ],
      iconUrls: new Map([["User_A", "https://example.com/old.webp"]]),
    },
    100,
  );
  assert.equal(payload.entries.user_a.source, "registered");
  assert.equal(
    payload.entries.user_a.icon_url,
    "https://example.com/reg.webp",
  );
});

test("登録ユーザー+historicalは公開プロフィール(none)として保持する", () => {
  const payload = buildPublicXIconMapPayloadFromProjection(
    {
      registeredUsers: [{ id: "user_c", icon_url: null }],
      iconUrls: new Map([["user_c", "https://example.com/historical.webp"]]),
    },
    100,
  );
  assert.equal(payload.entries.user_c.source, "none");
  assert.equal(
    payload.entries.user_c.icon_url,
    "https://example.com/historical.webp",
  );

  const map = publicXIconEntriesToMap(payload);
  assert.equal(
    hasProjectedPublicProfile({ xUserId: "user_c", iconMap: map }),
    true,
  );
  assert.equal(
    resolveProjectedIcon({
      xUserId: "user_c",
      iconMap: map,
      legacyIconUrl: null,
    }),
    "https://example.com/historical.webp",
  );
});

test("known nullはlegacy iconを復活させない", () => {
  const payload = buildPublicXIconMapPayloadFromProjection(
    {
      registeredUsers: [{ id: "user_b", icon_url: null }],
      iconUrls: new Map(),
    },
    100,
  );
  assert.equal(payload.entries.user_b.source, "none");
  assert.equal(payload.entries.user_b.icon_url, null);

  const map = publicXIconEntriesToMap(payload);
  assert.equal(
    resolveProjectedIcon({
      xUserId: "user_b",
      iconMap: map,
      legacyIconUrl: "https://example.com/legacy.webp",
    }),
    null,
  );
  assert.equal(
    hasProjectedPublicProfile({ xUserId: "user_b", iconMap: map }),
    true,
  );
});

test("mapに無いX IDはlegacyを後方互換採用する", () => {
  const map = publicXIconEntriesToMap(
    normalizePublicXIconMap({
      schema_version: 1,
      generated_at: 1,
      entries: {},
    }),
  );
  assert.equal(
    resolveProjectedIcon({
      xUserId: "unknown",
      iconMap: map,
      legacyIconUrl: "https://example.com/legacy.webp",
    }),
    "https://example.com/legacy.webp",
  );
  assert.equal(
    hasProjectedPublicProfile({ xUserId: "unknown", iconMap: map }),
    false,
  );
});

test("video source is not treated as a public profile", () => {
  const map = publicXIconEntriesToMap(
    normalizePublicXIconMap({
      schema_version: 1,
      generated_at: 1,
      entries: {
        orphan: { icon_url: "https://example.com/orphan.webp", source: "video" },
      },
    }),
  );
  assert.equal(
    hasProjectedPublicProfile({ xUserId: "orphan", iconMap: map }),
    false,
  );
});


test("SEC: a valid __proto__ X handle survives producer, JSON and normalizer without prototype mutation", () => {
  const producer = buildPublicXIconMapPayloadFromProjection(
    {
      registeredUsers: [{ id: "__proto__", icon_url: "https://example.test/registered.png" }],
      iconUrls: new Map([["constructor", "https://example.test/video.png"]]),
      orphans: [{ x_id: "constructor" }],
    },
    123,
  );
  assert.equal(Object.getPrototypeOf(producer.entries), null);
  assert.equal(Object.hasOwn(producer.entries, "__proto__"), true);
  assert.equal(producer.entries.__proto__.source, "registered");
  assert.equal(Object.hasOwn(producer.entries, "constructor"), true,
    "inherited Object.prototype.constructor must not cause an orphan to be skipped");
  assert.equal(producer.entries.constructor.source, "video");

  const encoded = JSON.stringify(producer);
  assert.match(encoded, /"__proto__"/);
  assert.match(encoded, /"constructor"/);
  const decoded = normalizePublicXIconMap(JSON.parse(encoded));
  assert.ok(decoded);
  assert.equal(Object.getPrototypeOf(decoded.entries), null);
  assert.equal(Object.hasOwn(decoded.entries, "__proto__"), true);
  assert.equal(decoded.entries.__proto__.source, "registered");
  assert.equal(decoded.entries.constructor.source, "video");
  assert.equal(publicXIconEntriesToMap(decoded).get("__proto__").source, "registered");
  assert.equal(publicXIconEntriesToMap(decoded).get("constructor").source, "video");
  assert.equal(Object.hasOwn(Object.prototype, "icon_url"), false,
    "valid icon-map keys must never modify Object.prototype");

  const standalone = normalizePublicXIconMap(JSON.parse(
    '{"schema_version":1,"generated_at":5,"entries":{"__proto__":{"icon_url":null,"source":"none"}}}',
  ));
  assert.ok(standalone);
  assert.equal(Object.hasOwn(standalone.entries, "__proto__"), true);
  assert.equal(hasProjectedPublicProfile({
    xUserId: "__proto__",
    iconMap: publicXIconEntriesToMap(standalone),
  }), true);
});
