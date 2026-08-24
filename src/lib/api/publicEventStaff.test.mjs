import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

if (process.env.FLAMENODE_PUBLIC_EVENT_STAFF_EXECUTION !== "1") {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", fileURLToPath(import.meta.url)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_PUBLIC_EVENT_STAFF_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  const {
    normalizePublicEventStaffArtifact,
    parsePublicEventId,
    PUBLIC_EVENT_STAFF_MAX_ITEMS,
    isPvsfPublicApiOrigin,
  } = await import("./publicEventStaff.ts");
  const { findForbiddenPublicKeys } = await import("./publicDto.ts");

  function artifact(overrides = {}) {
    return {
      generated_at: 1_700_000_000,
      event: {
        id: "PVSF2026Sp",
        title: "PVSF 2026 Spring",
        visibility_status: "public",
      },
      public_staff: [
        {
          display_name: "Mochi",
          public_role_label: "主催",
          x_user_id: "Mochi_Staff",
          x_name: "Mochi",
          icon_url: "https://example.com/icon.png",
          permission_preset: "owner",
          custom_permission_keys_json: "[\"event.manage\"]",
          internal_note: "must-not-leak",
          role: "admin",
        },
      ],
      ...overrides,
    };
  }

  test("event ID parser accepts only the canonical route-safe alphabet", () => {
    assert.equal(parsePublicEventId("PVSF2026Sp"), "PVSF2026Sp");
    assert.equal(parsePublicEventId("PVSF%32%30%32%36Sp"), "PVSF2026Sp");
    assert.equal(parsePublicEventId("a%2Fb"), null);
    assert.equal(parsePublicEventId("../event"), null);
    assert.equal(parsePublicEventId("%E0%A4%A"), null);
    assert.equal(parsePublicEventId("x".repeat(65)), null);
  });

  test("normalizer emits only the dedicated public staff DTO", () => {
    const payload = normalizePublicEventStaffArtifact(
      artifact(),
      "PVSF2026Sp",
    );
    assert.deepEqual(payload, {
      schema_version: 1,
      event_id: "PVSF2026Sp",
      generated_at: 1_700_000_000,
      staff: [
        {
          display_name: "Mochi",
          role_label: "主催",
          x_id: "mochi_staff",
          x_name: "Mochi",
          icon_url: "https://example.com/icon.png",
          has_public_profile: false,
        },
      ],
    });
    assert.deepEqual(findForbiddenPublicKeys(payload), []);
  });

  test("normalizer fails closed for mismatched, private, malformed, or oversized artifacts", () => {
    assert.equal(
      normalizePublicEventStaffArtifact(artifact(), "another-event"),
      null,
    );
    assert.equal(
      normalizePublicEventStaffArtifact(
        artifact({
          event: {
            id: "PVSF2026Sp",
            title: "PVSF 2026 Spring",
            visibility_status: "private",
          },
        }),
        "PVSF2026Sp",
      ),
      null,
    );
    assert.equal(
      normalizePublicEventStaffArtifact(
        artifact({ generated_at: "1700000000" }),
        "PVSF2026Sp",
      ),
      null,
    );
    assert.equal(
      normalizePublicEventStaffArtifact(
        artifact({ public_staff: [{ display_name: "" }] }),
        "PVSF2026Sp",
      ),
      null,
    );
    assert.equal(
      normalizePublicEventStaffArtifact(
        artifact({
          public_staff: Array.from(
            { length: PUBLIC_EVENT_STAFF_MAX_ITEMS + 1 },
            () => ({ display_name: "staff" }),
          ),
        }),
        "PVSF2026Sp",
      ),
      null,
    );
  });

  test("invalid X handles never become public profiles", () => {
    const payload = normalizePublicEventStaffArtifact(
      artifact({
        public_staff: [
          {
            display_name: "Legacy Staff",
            x_user_id: "https://evil.example/path",
            has_public_profile: true,
          },
        ],
      }),
      "PVSF2026Sp",
    );
    assert.equal(payload?.staff[0]?.x_id, null);
    assert.equal(payload?.staff[0]?.has_public_profile, false);
  });

  test("PVSF CORS accepts only the canonical apex and www origins", () => {
    assert.equal(isPvsfPublicApiOrigin("https://pvsf.jp"), true);
    assert.equal(isPvsfPublicApiOrigin("https://www.pvsf.jp"), true);
    assert.equal(isPvsfPublicApiOrigin("https://evil.example"), false);
    assert.equal(isPvsfPublicApiOrigin("https://pvsf.jp/"), false);
  });
}
