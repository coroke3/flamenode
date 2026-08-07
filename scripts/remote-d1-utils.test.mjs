#!/usr/bin/env node

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  ZERO_D1_DATABASE_ID,
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
