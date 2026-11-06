import assert from "node:assert/strict";
import test from "node:test";
import { verifyProductionEnvironment } from "./cloudflare-production.mjs";

// An empty fixture intentionally fails other production requirements. Isolate
// the runtime-version diagnostic instead of manufacturing production secrets.
function runtimeVersionErrors(runtimeNodeVersion) {
  try {
    verifyProductionEnvironment({ env: {}, requireGitHead: false, runtimeNodeVersion });
    assert.fail("empty environment must not pass production verification");
  } catch (error) {
    return String(error.message);
  }
}

test("production preflight accepts only complete Node 22 semver triplets", () => {
  for (const version of ["22.0.0", "22.13.0", "22.99.123"]) {
    assert.doesNotMatch(runtimeVersionErrors(version),
      /Node\.js runtime must be major version 22/, version);
  }
  for (const version of [
    "22", "22.13", "22garbage", "22.13.0junk", "22.13.0-rc.1",
    "22.13.0+build", "22..0", "22.01.0", " 22.13.0", "22.13.0 ",
    "v22.13.0", "23.0.0", "21.9.0", "NaN", "", "22.13.0\n23.0.0",
  ]) {
    assert.match(runtimeVersionErrors(version),
      /Node\.js runtime must be major version 22/, JSON.stringify(version));
  }
});
