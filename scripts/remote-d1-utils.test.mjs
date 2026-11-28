#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, test } from "node:test";
import {
  ZERO_D1_DATABASE_ID,
  isWranglerExecutionSummary,
  parseWranglerD1Json,
  readEnvD1DatabaseId,
  readRemoteD1DatabaseId,
  resolveRemoteD1ExecuteTarget,
} from "./remote-d1-utils.mjs";

const originalFlamenodeId = process.env.FLAMENODE_D1_DATABASE_ID;
const originalCloudflareId = process.env.CLOUDFLARE_D1_DATABASE_ID;

beforeEach(() => {
  delete process.env.FLAMENODE_D1_DATABASE_ID;
  delete process.env.CLOUDFLARE_D1_DATABASE_ID;
});

afterEach(() => {
  if (originalFlamenodeId === undefined) {
    delete process.env.FLAMENODE_D1_DATABASE_ID;
  } else {
    process.env.FLAMENODE_D1_DATABASE_ID = originalFlamenodeId;
  }
  if (originalCloudflareId === undefined) {
    delete process.env.CLOUDFLARE_D1_DATABASE_ID;
  } else {
    process.env.CLOUDFLARE_D1_DATABASE_ID = originalCloudflareId;
  }
});

test("readEnvD1DatabaseId prefers FLAMENODE_D1_DATABASE_ID over CLOUDFLARE_D1_DATABASE_ID", () => {
  process.env.FLAMENODE_D1_DATABASE_ID = "7ca561eb-5706-497d-8f7b-315255cdedfd";
  process.env.CLOUDFLARE_D1_DATABASE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  assert.equal(
    readEnvD1DatabaseId(),
    "7ca561eb-5706-497d-8f7b-315255cdedfd",
  );
});

test("readEnvD1DatabaseId falls back to CLOUDFLARE_D1_DATABASE_ID", () => {
  process.env.CLOUDFLARE_D1_DATABASE_ID = "7ca561eb-5706-497d-8f7b-315255cdedfd";
  assert.equal(
    readEnvD1DatabaseId(),
    "7ca561eb-5706-497d-8f7b-315255cdedfd",
  );
});

test("readEnvD1DatabaseId ignores placeholder UUID", () => {
  process.env.FLAMENODE_D1_DATABASE_ID = ZERO_D1_DATABASE_ID;
  assert.equal(readEnvD1DatabaseId(), null);
});

test("resolveRemoteD1ExecuteTarget uses env UUID when set", () => {
  process.env.FLAMENODE_D1_DATABASE_ID = "7ca561eb-5706-497d-8f7b-315255cdedfd";
  assert.equal(
    resolveRemoteD1ExecuteTarget(),
    "7ca561eb-5706-497d-8f7b-315255cdedfd",
  );
});

test("resolveRemoteD1ExecuteTarget defaults to flamenode_db without env override", () => {
  assert.equal(resolveRemoteD1ExecuteTarget(), "flamenode_db");
});

test("readRemoteD1DatabaseId uses env override when wrangler has placeholder", () => {
  process.env.FLAMENODE_D1_DATABASE_ID = "7ca561eb-5706-497d-8f7b-315255cdedfd";
  assert.equal(
    readRemoteD1DatabaseId(),
    "7ca561eb-5706-497d-8f7b-315255cdedfd",
  );
});

test("parseWranglerD1Json strips wrangler progress prefix", () => {
  const output = `├ Checking if file needs uploading
│
[{"results":[{"id":"evt_1"}],"success":true}]`;
  assert.deepEqual(parseWranglerD1Json(output), [{ id: "evt_1" }]);
});

test("parseWranglerD1Json drops wrangler execution summary rows", () => {
  const output = JSON.stringify([
    {
      results: [
        {
          "Total queries executed": 1,
          "Rows read": 22,
        },
      ],
      success: true,
    },
  ]);
  assert.deepEqual(parseWranglerD1Json(output), []);
});

test("isWranglerExecutionSummary detects metadata rows", () => {
  assert.equal(
    isWranglerExecutionSummary({ "Total queries executed": 1 }),
    true,
  );
  assert.equal(isWranglerExecutionSummary({ id: "evt_1" }), false);
});

test("remote diagnostics are captured only when failure-detail redaction is opted into", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-d1-diagnostics-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cliDir = path.join(dir, "node_modules/wrangler/bin");
  fs.mkdirSync(cliDir, { recursive: true });
  fs.writeFileSync(path.join(cliDir, "wrangler.js"), [
    'process.stderr.write("PRIVATE_STDERR_fixture\\n");',
    'if (process.env.REMOTE_D1_CASE === "nonzero") {',
    '  process.stdout.write("PRIVATE_STDOUT_fixture\\n");',
    '  process.exitCode = 7;',
    '} else process.stdout.write(JSON.stringify([{results:[{n:7}]}]));',
  ].join("\n"));
  const helperUrl = new URL("./remote-d1-utils.mjs", import.meta.url).href;
  const invoke = (mode, redact) => spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { runRemoteD1Command } from ${JSON.stringify(helperUrl)};
    const options = { scriptName: "fixture" };
    if (process.env.REMOTE_D1_REDACT === "1") options.redactFailureDetails = true;
    try {
      console.log(JSON.stringify(runRemoteD1Command("SELECT 7 AS n", options)));
    } catch (error) {
      console.log(JSON.stringify({ errorStatus: error.status }));
      process.exitCode = 2;
    }
  `], {
    cwd: dir, encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1", REMOTE_D1_CASE: mode,
      REMOTE_D1_REDACT: redact ? "1" : "0" },
  });
  for (const mode of ["nonzero", "success"]) {
    const normal = invoke(mode, false), redacted = invoke(mode, true);
    assert.equal(normal.status, mode === "nonzero" ? 2 : 0);
    assert.equal(redacted.status, normal.status);
    assert.deepEqual(JSON.parse(normal.stdout), mode === "nonzero" ? { errorStatus: 7 } : [{ n: 7 }]);
    assert.equal(redacted.stdout, normal.stdout, "rows and thrown child status stay unchanged");
    assert.match(normal.stderr, /PRIVATE_STDERR_fixture/);
    if (mode === "nonzero") assert.match(normal.stderr, /PRIVATE_STDOUT_fixture/);
    assert.equal(redacted.stderr, "", "capture suppresses both automatic echo and formatted diagnostics");
  }
});
