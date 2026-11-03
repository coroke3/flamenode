import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {readR2Json,MAX_R2_JSON_BYTES} from "../apps/site/scripts/readR2Object.ts";
import {buildPublicSiteArgs,safeBuildEnv} from "../apps/site/scripts/buildPublicSite.ts";
import {parseSnapshotCliArgs} from "../apps/site/scripts/produceSnapshots.ts";

const opts={accountId:"a".repeat(32),bucket:"flamenode-storage",
  key:"analytics/trending.json",token:"secret-from-test"};
test("MIG-0509 T07: R2 trending 200 returns exact JSON without exposing token or changing method",async()=>{
  let calls=0;
  const data={schema_version:1,items:[{video_id:"a"}]};
  const result=await readR2Json({...opts,fetchFn:async(url,init)=>{
    calls++;
    assert.equal(init.method,"GET");
    assert.equal(init.headers.Authorization,"Bearer "+opts.token);
    assert.equal(url,"https://api.cloudflare.com/client/v4/accounts/"+opts.accountId+
      "/r2/buckets/flamenode-storage/objects/analytics/trending.json");
    return new Response(JSON.stringify(data),{status:200});
  }});
  assert.deepEqual(result,data);
  assert.equal(calls,1);
});

test("MIG-0509 T07: R2 404 is null; 401 and malformed payload fail closed without token",async()=>{
  assert.equal(await readR2Json({...opts,fetchFn:async()=>new Response(null,{status:404})}),null);
  for(const response of [new Response(null,{status:401}),new Response("<bad>",{status:200})]){
    await assert.rejects(readR2Json({...opts,fetchFn:async()=>response}),error=>{
      assert.equal(String(error).includes(opts.token),false);
      return true;
    });
  }
});

test("MIG-0509 U02: stream budget enforces 2MiB without trusting content-length",async()=>{
  const tooLarge=new Uint8Array(MAX_R2_JSON_BYTES+1);
  await assert.rejects(readR2Json({...opts,fetchFn:async()=>new Response(tooLarge,{status:200})}),/byte budget/);
  const headerResponse=()=>new Response("{}",{status:200,headers:{"content-length":String(MAX_R2_JSON_BYTES+1)}});
  await assert.rejects(readR2Json({...opts,fetchFn:async()=>headerResponse()}),/byte budget/);
  await assert.rejects(readR2Json({accountId:"bad",bucket:opts.bucket,key:opts.key,token:opts.token}),/R2 read requires/);
});

test("MIG-0509 U02/U03: CLI mutually excludes trending-file and --trending-r2",()=>{
  assert.throws(()=>parseSnapshotCliArgs(["--sqlite","x","--out","z","--generation","g",
    "--trending-file","a","--trending-r2"]),/expected exactly one/);
  assert.equal(parseSnapshotCliArgs(["--d1-api","--out","x","--generation","g","--trending-r2"]).trendingR2,true);
});

test("MIG-0509 U03: build entry requires remote generation and isolates credentials",()=>{
  assert.throws(()=>buildPublicSiteArgs(["--d1-api","--trending-r2"],{}),/usage/);
  assert.deepEqual(buildPublicSiteArgs(["--sqlite","seed"],{}),["--sqlite","seed","--generation","local-fixture"]);
  assert.deepEqual(buildPublicSiteArgs(["--d1-api"],{WORKERS_CI_COMMIT_SHA:"abc"}),["--d1-api","--generation","abc"]);
  assert.throws(()=>buildPublicSiteArgs(["--sqlite","a","--out","/tmp/x"],{}),/temporary snapshot/);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"mig0509-env-"));
  fs.writeFileSync(path.join(temp,"rules-current.json"),"{}");
  const env=safeBuildEnv({FLAMENODE_D1_READ_TOKEN:"secret1",
    FLAMENODE_R2_READ_TOKEN:"secret2",CLOUDFLARE_API_TOKEN:"secret3",
    OTHER_SAFE:"ok"},temp,"generation");
  assert.equal(env.FLAMENODE_D1_READ_TOKEN,undefined);
  assert.equal(env.FLAMENODE_R2_READ_TOKEN,undefined);
  assert.equal(env.CLOUDFLARE_API_TOKEN,undefined);
  assert.equal(env.OTHER_SAFE,"ok");
  assert.equal(env.FLAMENODE_SNAPSHOT_GENERATION,"generation");
  assert.ok(env.FLAMENODE_RULES_SNAPSHOT_FILE.endsWith("rules-current.json"));
});


test("MIG-0509 regression: each build selects its own rules snapshot, never an inherited one", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mig0509-rules-isolation-"));
  try {
    const snapshotDir = path.join(base, "new-build");
    fs.mkdirSync(snapshotDir);
    const previousRules = path.join(base, "previous-rules.json");
    fs.writeFileSync(previousRules, JSON.stringify({ body: "old build" }));
    const inherited = {
      FLAMENODE_RULES_SNAPSHOT_FILE: previousRules,
      FLAMENODE_SNAPSHOT_DIR: path.join(base, "previous-build"),
      FLAMENODE_SNAPSHOT_GENERATION: "previous-generation",
    };

    // No published rules in the new snapshot means CURRENT's built-in terms.
    // The previous build's valid on-disk file must not override this fallback.
    const withoutRules = safeBuildEnv(inherited, snapshotDir, "new-generation");
    assert.equal(withoutRules.FLAMENODE_RULES_SNAPSHOT_FILE, undefined);
    assert.equal(withoutRules.FLAMENODE_SNAPSHOT_DIR, snapshotDir);
    assert.equal(withoutRules.FLAMENODE_SNAPSHOT_GENERATION, "new-generation");
    assert.equal(inherited.FLAMENODE_RULES_SNAPSHOT_FILE, previousRules, "caller env is not mutated");

    // A newly produced rules file must take precedence over the inherited path.
    const currentRules = path.join(snapshotDir, "rules-current.json");
    fs.writeFileSync(currentRules, JSON.stringify({ body: "new build" }));
    const withRules = safeBuildEnv(inherited, snapshotDir, "new-generation");
    assert.equal(withRules.FLAMENODE_RULES_SNAPSHOT_FILE, currentRules);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});


test("MIG-0509 regression: Astro and budget children never inherit unrelated credentials", () => {
  const inherited = {
    FLAMENODE_D1_READ_TOKEN: "d1-secret",
    FLAMENODE_R2_READ_TOKEN: "r2-secret",
    GITHUB_TOKEN: "github-secret",
    GH_TOKEN: "gh-secret",
    AWS_ACCESS_KEY_ID: "aws-id",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
    AWS_SESSION_TOKEN: "aws-session",
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/private-credentials.json",
    SENTRY_AUTH_TOKEN: "sentry-secret",
    DATABASE_URL: "postgres://private:secret@host/db",
    npm_config_registry_authToken: "npm-secret",
    CLOUDFLARE_API_KEY: "cf-secret",
    PATH: "/usr/bin",
    NODE_ENV: "production",
    CI: "true",
    OTHER_SAFE: "preserved",
  };
  const result = safeBuildEnv(inherited, "/tmp/public-snapshot", "new-generation");
  for (const key of [
    "FLAMENODE_D1_READ_TOKEN", "FLAMENODE_R2_READ_TOKEN",
    "GITHUB_TOKEN", "GH_TOKEN", "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
    "GOOGLE_APPLICATION_CREDENTIALS", "SENTRY_AUTH_TOKEN",
    "DATABASE_URL", "npm_config_registry_authToken", "CLOUDFLARE_API_KEY",
  ]) {
    assert.equal(result[key], undefined, key + " must not reach child processes");
    assert.equal(inherited[key] !== undefined, true, "do not mutate caller env");
  }
  assert.equal(result.PATH, inherited.PATH);
  assert.equal(result.NODE_ENV, "production");
  assert.equal(result.CI, "true");
  assert.equal(result.OTHER_SAFE, "preserved");
  assert.equal(result.FLAMENODE_SNAPSHOT_DIR, "/tmp/public-snapshot");
  assert.equal(result.FLAMENODE_SNAPSHOT_GENERATION, "new-generation");
});
