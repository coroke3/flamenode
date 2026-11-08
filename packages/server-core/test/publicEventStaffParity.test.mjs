import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isPvsfPublicApiOrigin,
  normalizePublicEventStaffArtifact,
  parsePublicEventId,
  PUBLIC_EVENT_STAFF_MAX_ITEMS,
  resolvePvsfPublicApiOrigin,
} from "../src/publicData/publicEventStaff.ts";

// Characterization fixture from CURRENT src/lib/api/publicEventStaff.test.mjs.
// This must stay byte-identical after moving the normalization into server-core.
function eventArtifact(overrides = {}) {
  return {
    generated_at: 1_700_000_000,
    event: {
      id: "PVSF2026Sp",
      title: "PVSF 2026 Spring",
      visibility_status: "public",
    },
    public_staff: [{
      display_name: "Mochi",
      public_role_label: "主催",
      x_user_id: "Mochi_Staff",
      x_name: "Mochi",
      icon_url: "https://example.com/icon.png",
      permission_preset: "owner",
      internal_note: "must-not-leak",
      has_public_profile: 1,
    }],
    ...overrides,
  };
}

test("MIG-0647: CURRENT public staff payload remains an allowlist DTO", () => {
  const value = normalizePublicEventStaffArtifact(eventArtifact(), "PVSF2026Sp");
  assert.equal(JSON.stringify(value), JSON.stringify({
    schema_version: 1,
    event_id: "PVSF2026Sp",
    generated_at: 1_700_000_000,
    staff: [{
      display_name: "Mochi",
      role_label: "主催",
      x_id: "mochi_staff",
      x_name: "Mochi",
      icon_url: "https://example.com/icon.png",
      has_public_profile: true,
    }],
  }));
  assert.equal(JSON.stringify(value).includes("internal_note"), false);
  assert.equal(JSON.stringify(value).includes("permission_preset"), false);
});

test("MIG-0647: malformed, private, oversized and missing event rows fail closed", () => {
  const invalid = [
    eventArtifact({ generated_at: "1700000000" }),
    eventArtifact({ event: { id: "PVSF2026Sp", title: "PVSF 2026 Spring", visibility_status: "private" } }),
    eventArtifact({ public_staff: [{ display_name: "" }] }),
    eventArtifact({ public_staff: Array.from({ length: PUBLIC_EVENT_STAFF_MAX_ITEMS + 1 }, () => ({ display_name: "staff" })) }),
    eventArtifact({ event: { id: "another", title: "Other", visibility_status: "public" } }),
  ];
  for (const item of invalid) {
    assert.equal(normalizePublicEventStaffArtifact(item, "PVSF2026Sp"), null);
  }
});

test("MIG-0647: X identity and icon URL normalization retain their CURRENT security rules", () => {
  const staff = normalizePublicEventStaffArtifact(eventArtifact({
    public_staff: [
      { display_name: "invalid", x_user_id: "https://evil.example/path", has_public_profile: 1, icon_url: "http://evil.example/icon" },
      { display_name: "relative", icon_url: "/avatar.png?size=32" },
    ],
  }), "PVSF2026Sp")?.staff;
  assert.deepEqual(staff, [
    { display_name: "invalid", role_label: null, x_id: null, x_name: null, icon_url: null, has_public_profile: false },
    { display_name: "relative", role_label: null, x_id: null, x_name: null, icon_url: "/avatar.png?size=32", has_public_profile: false },
  ]);
});

test("MIG-0647: event-ID decoding and CORS allowlist retain CURRENT behavior", () => {
  assert.equal(parsePublicEventId("PVSF%32%30%32%36Sp"), "PVSF2026Sp");
  assert.equal(parsePublicEventId("a%2Fb"), null);
  assert.equal(parsePublicEventId("%E0%A4%A"), null);
  assert.equal(parsePublicEventId("x".repeat(65)), null);
  for (const origin of ["https://pvsf.jp", "https://www.pvsf.jp"]) {
    assert.equal(isPvsfPublicApiOrigin(origin), true);
    assert.equal(resolvePvsfPublicApiOrigin(origin), origin);
  }
  for (const origin of ["https://pvsf.jp/", "https://evil.example", null]) {
    assert.equal(isPvsfPublicApiOrigin(origin), false);
    assert.equal(resolvePvsfPublicApiOrigin(origin), null);
  }
});
