// MIG-0628 U01–U05: non-production config safety and smoke-plan regressions.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildNewWorkerSmokePlan, listHonoMounts, loadNewWorkerSmokePlan } from "./new-worker-smoke-list.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const gateway = read("apps/site/wrangler.toml");
const api = read("apps/api/wrangler.toml");
const personal = read("apps/app/wrangler.toml");
const configs = [gateway, api, personal];

const matches = (body, key) =>
  [...body.matchAll(new RegExp("^" + key + '\\s*=\\s*"([^"]+)"\\s*$', "gm"))].map((x) => x[1]);

// Parse table boundaries, rather than searching the entire TOML file: otherwise
// [assets] assertions could accidentally pass using a binding in [[services]] or
// [vars], and a stray [env.production] section could bypass route-key checks.
function tomlSections(body) {
  const sections = [{ name: "<root>", content: [] }];
  for (const line of body.split(/\r?\n/)) {
    const header = /^\s*(\[\[[\w.-]+\]\]|\[[\w.-]+\])\s*(?:#.*)?$/.exec(line);
    if (header) {
      sections.push({ name: header[1], content: [] });
    } else {
      if (/^\s*\[\[?/.test(line)) throw new Error("Unexpected TOML table header: " + line);
      sections[sections.length - 1].content.push(line);
    }
  }
  return sections.map(({ name, content }) => ({ name, content: content.join("\n") }));
}

function assertStrictWranglerTopology(siteBody, apiBody, appBody) {
  const cases = [
    {
      body: siteBody,
      headers: ["[assets]", "[vars]", "[[d1_databases]]", "[[r2_buckets]]",
        "[[kv_namespaces]]", "[[kv_namespaces]]", "[[services]]"],
      main: "./src/gateway/index.ts",
      bindings: [["[assets]", "ASSETS"], ["[[d1_databases]]", "DB"],
        ["[[r2_buckets]]", "R2_STORAGE"], ["[[kv_namespaces]]", "KV"],
        ["[[kv_namespaces]]", "VISIBILITY_KV"], ["[[services]]", "AUTH_ORIGIN"]],
    },
    {
      body: apiBody,
      headers: ["[vars]", "[[d1_databases]]", "[[r2_buckets]]", "[[kv_namespaces]]"],
      main: "./src/index.ts",
      bindings: [["[[d1_databases]]", "DB"], ["[[r2_buckets]]", "BUCKET"],
        ["[[kv_namespaces]]", "KV"]],
    },
    { body: appBody, headers: ["[assets]"], main: null, bindings: [] },
  ];
  for (const { body, headers, main, bindings } of cases) {
    const sections = tomlSections(body);
    assert.deepEqual(sections.map((section) => section.name), ["<root>", ...headers],
      "Unexpected Wrangler TOML section or changed section order");
    const root = sections[0].content;
    assert.deepEqual(matches(root, "compatibility_date"), ["2026-07-21"],
      "compatibility_date must remain at TOML root");
    assert.match(root, /^workers_dev\s*=\s*false$/m,
      "workers_dev=false must remain at TOML root");
    assert.deepEqual(matches(root, "main"), main === null ? [] : [main],
      "Worker main must remain at TOML root");
    const actualBindings = sections.slice(1).flatMap(({ name, content }) =>
      matches(content, "binding").map((binding) => [name, binding]));
    assert.deepEqual(actualBindings, bindings,
      "Each binding must remain in its explicitly authorized TOML section");
    const asset = sections.find((section) => section.name === "[assets]");
    if (asset) {
      assert.match(asset.content, /^run_worker_first\s*=\s*(?:true|false)$/m,
        "run_worker_first must be within [assets]");
      if (main === "./src/gateway/index.ts") {
        assert.match(asset.content, /^run_worker_first\s*=\s*true$/m);
      }
    }
    // A naked route property (including nested env tables) is forbidden even
    // when the section layout above would otherwise be accepted.
    assert.doesNotMatch(body, /^\s*(?:route|routes|custom_domain|custom_domains)\s*=/m);
  }
}

test("MIG-0628 U02: strict TOML section and binding topology resists drift", () => {
  assertStrictWranglerTopology(gateway, api, personal);

  const movedAssetBinding = gateway.replace('binding = "ASSETS"\n', "")
    .replace("[vars]\n", '[vars]\nbinding = "ASSETS"\n');
  assert.throws(() => assertStrictWranglerTopology(movedAssetBinding, api, personal),
    /Each binding must remain/);

  const misplacedWorkerFlag = gateway.replace("workers_dev = false\n", "")
    .replace("[assets]\n", "[assets]\nworkers_dev = false\n");
  assert.throws(() => assertStrictWranglerTopology(misplacedWorkerFlag, api, personal),
    /workers_dev=false must remain/);

  const injectedRouteTable = api + '\n[[env.production.routes]]\npattern = "example.com/*"\n';
  assert.throws(() => assertStrictWranglerTopology(gateway, injectedRouteTable, personal),
    /Unexpected Wrangler TOML section/);
});

test("MIG-0628 U02: three isolated configs preserve CURRENT compatibility and prohibit routes", () => {
  for (const body of configs) {
    assert.deepEqual(matches(body, "compatibility_date"), ["2026-07-21"]);
    assert.match(body, /compatibility_flags\s*=\s*\["nodejs_compat",\s*"global_fetch_strictly_public"\]/);
    assert.match(body, /^workers_dev\s*=\s*false$/m);
    assert.doesNotMatch(body, /^\s*(?:route|routes|custom_domain|custom_domains)\s*=/m);
    assert.doesNotMatch(body, /^\s*(?:AUTH_SECRET|WORKER_ADMIN_TOKEN)\s*=/m);
    assert.doesNotMatch(body, /^\s*account_id\s*=/m);
    for (const row of [...body.matchAll(/^\s*(?:database_id|id)\s*=\s*"([^"]+)"/gm)]) {
      assert.ok(["00000000-0000-0000-0000-000000000000",
        "00000000000000000000000000000000"].includes(row[1]), "real resource ID forbidden");
    }
  }
  assert.equal(matches(gateway, "main")[0], "./src/gateway/index.ts");
  assert.equal(matches(api, "main")[0], "./src/index.ts");
  assert.deepEqual(matches(personal, "main"), [], "Personal SPA is assets-only, no runtime worker");
});

test("MIG-0628 U01/U02: gateway is Worker-first and API binding names match declared env", () => {
  assert.match(gateway, /\[assets\][\s\S]*?binding\s*=\s*"ASSETS"[\s\S]*?run_worker_first\s*=\s*true/);
  assert.match(gateway, /binding\s*=\s*"AUTH_ORIGIN"\s*\nservice\s*=\s*"flamenode-web"/);
  for (const key of ["DB", "KV", "VISIBILITY_KV", "R2_STORAGE", "ASSETS", "AUTH_ORIGIN"]) {
    assert.ok(gateway.includes('binding = "' + key + '"'), "gateway missing " + key);
  }
  const declared = read("apps/api/src/env.ts");
  const bindings = [...declared.matchAll(/^\s{2}([A-Z][A-Z0-9_]+)\??:/gm)].map((row) => row[1]);
  for (const required of ["DB", "BUCKET", "KV"]) {
    assert.ok(bindings.includes(required), "API env type lacks " + required);
    assert.ok(api.includes('binding = "' + required + '"'), "API Wrangler binding missing " + required);
  }
  for (const opt of bindings.filter(x => !["DB", "BUCKET", "KV", "AUTH_SECRET", "WORKER_ADMIN_TOKEN"].includes(x))) {
    assert.ok(new RegExp("^" + opt + "\\s*=", "m").test(api), "API public runtime var missing " + opt);
  }
  assert.match(personal, /not_found_handling\s*=\s*"single-page-application"/);
  assert.doesNotMatch(personal, /\[\[(?:d1_databases|r2_buckets|kv_namespaces|services)\]\]/);
});

test("MIG-0628 U04: smoke list is sourced from mounted API groups and migration matrices", () => {
  const entry = read("apps/api/src/app.ts");
  const mounts = listHonoMounts(entry);
  const attempted = [...entry.matchAll(/\bapp\.route\(/g)].length;
  assert.equal(mounts.length, attempted, "new API mount is missing from smoke coverage parser");
  const plan = loadNewWorkerSmokePlan();
  assert.equal(plan.schemaVersion, 1);
  assert.deepEqual(plan.coverage.map(x => x.owner).sort(), mounts.map(x => x.owner).sort());
  assert.ok(plan.coverage.some(x => x.mount === "/api/admin"));
  assert.ok(plan.coverage.some(x => x.mount === "/api/personal"));
  assert.ok(plan.coverage.some(x => x.mount === "/api/health"));
  assert.ok(plan.publicSmoke.some(x => x.path === "/"));
  assert.ok(plan.publicSmoke.some(x => x.path === "/robots.txt"));
  assert.ok(plan.publicSmoke.some(x => x.path === "/sitemap.xml"));
  assert.ok(plan.apiSmoke.every(x => ["candidate", "fixture-required"].includes(x.mode)));
  // No currently mounted Hono root can be silently omitted; where API_MATRIX
  // lacks entries the source-anchored overlay supplies concrete actual paths.
  assert.deepEqual(plan.coverage.filter(x => x.needsManualAudit), []);
  assert.ok(plan.apiSmoke.some(x => x.path === "/api/manage/navigation" && x.method === "GET"));
  assert.ok(plan.apiSmoke.some(x => x.path === "/api/admin/spreadsheet/data" && x.method === "GET"));
  assert.ok(plan.apiSmoke.some(x => x.path === "/api/google-drive-image/:id" && x.mode === "fixture-required"));
  assert.ok(plan.apiSmoke.some(x => x.path === "/api/youtube-thumbnail/:id/:size" && x.mode === "fixture-required"));
});

test("MIG-0628 U04: method/route parser flags undocumented mounted groups for review", () => {
  const fake = buildNewWorkerSmokePlan({
    appEntry: 'app.route("/api/a", aRoutes);\napp.route("/api/b", makeBRoutes());',
    apiMatrix: "| GET /api/a/health | example |",
    routeMatrix: "| \`/about\` | Next/OpenNext | Astro/site |",
  });
  assert.deepEqual(fake.coverage.map(x => [x.mount, x.needsManualAudit]),
    [["/api/a", false], ["/api/b", true]]);
  assert.ok(fake.apiSmoke.some(x => x.method === "GET" && x.path === "/api/a/health"));
  assert.ok(!fake.apiSmoke.some(x => x.path.startsWith("/api/b")));
});

test("MIG-0628 U04: plan construction never contacts real network", () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("unexpected network"); };
  try {
    const plan = loadNewWorkerSmokePlan();
    assert.ok(plan.coverage.length > 0);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
