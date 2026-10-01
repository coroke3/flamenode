import assert from "node:assert/strict";
import { test } from "node:test";
import { decideCanonicalXUserResolution } from "./xIdentityResolutionCore.ts";

const direct = (id, approval_status = "approved") => ({ id, approval_status });
const alias = (
  alias_x_id,
  target_x_user_id,
  target_approval_status = "approved",
) => ({ alias_x_id, target_x_user_id, target_approval_status });

test("alias resolver resolves a normalized canonical row", () => {
  assert.deepEqual(
    decideCanonicalXUserResolution({
      candidate: " @Creator ",
      aliases: [],
      directRows: [direct("creator")],
    }),
    { value: "creator", reason: "resolved_canonical" },
  );
});

test("alias resolver accepts a rejected historical direct row only when a valid alias replaces it", () => {
  assert.deepEqual(
    decideCanonicalXUserResolution({
      candidate: "old_name",
      aliases: [alias("@OLD_NAME", "current_name")],
      directRows: [direct("old_name", "rejected")],
    }),
    { value: "current_name", reason: "resolved_alias" },
  );
});

test("alias resolver rejects every malformed or ambiguous target instead of selecting LIMIT 1", () => {
  const cases = [
    {
      aliases: [alias("old", "target_a"), alias("old", "target_b")],
      directRows: [],
      reason: "ambiguous_alias",
    },
    {
      aliases: [alias("old", null)],
      directRows: [],
      reason: "invalid_alias_target",
    },
    {
      aliases: [alias("old", "target", "rejected")],
      directRows: [],
      reason: "invalid_alias_target",
    },
    {
      aliases: [alias("old", "target")],
      directRows: [direct("old")],
      reason: "canonical_alias_collision",
    },
  ];
  for (const item of cases) {
    const resolution = decideCanonicalXUserResolution({ candidate: " @OLD ", ...item });
    assert.equal(resolution.value, null);
    assert.equal(resolution.reason, item.reason);
  }
});

test("alias resolver uses the same case, at-sign, and whitespace normalization for aliases", () => {
  assert.deepEqual(
    decideCanonicalXUserResolution({
      candidate: "  @OlD_Name  ",
      aliases: [alias("old_name", " @Current_Name ")],
      directRows: [],
    }),
    { value: "current_name", reason: "resolved_alias" },
  );
});
