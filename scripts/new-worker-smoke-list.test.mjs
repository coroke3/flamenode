// MIG-0628 U01–U05: non-production config safety and smoke-plan regressions.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildNewWorkerSmokePlan, collectApiMatrixRoutes, countActiveHonoMountCalls, listHonoMounts, loadNewWorkerSmokePlan, sourceDeclaresGetRoute } from "./new-worker-smoke-list.mjs";

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
      workerName: "flamenode-public-gateway",
      bindings: [["[assets]", "ASSETS"], ["[[d1_databases]]", "DB"],
        ["[[r2_buckets]]", "R2_STORAGE"], ["[[kv_namespaces]]", "KV"],
        ["[[kv_namespaces]]", "VISIBILITY_KV"], ["[[services]]", "AUTH_ORIGIN"]],
    },
    {
      body: apiBody,
      headers: ["[vars]", "[[d1_databases]]", "[[r2_buckets]]", "[[kv_namespaces]]"],
      main: "./src/index.ts",
      workerName: "flamenode-hono-api",
      bindings: [["[[d1_databases]]", "DB"], ["[[r2_buckets]]", "BUCKET"],
        ["[[kv_namespaces]]", "KV"]],
    },
    { body: appBody, headers: ["[assets]"], main: null,
      workerName: "flamenode-personal", bindings: [] },
  ];
  for (const { body, headers, main, workerName, bindings } of cases) {
    const sections = tomlSections(body);
    assert.deepEqual(sections.map((section) => section.name), ["<root>", ...headers],
      "Unexpected Wrangler TOML section or changed section order");
    const root = sections[0].content;
    assert.deepEqual(matches(root, "name"), [workerName],
      "Worker name must remain isolated from CURRENT production flamenode-web");
    assert.deepEqual(matches(root, "compatibility_date"), ["2026-07-21"],
      "compatibility_date must remain at TOML root");
    // Compatibility flags are Wrangler top-level settings. A whole-file
    // regex also matches [vars].compatibility_flags, leaving the actual
    // Worker without nodejs_compat and global_fetch_strictly_public.
    const compatibilityFlags = "compatibility_flags = [\"nodejs_compat\", \"global_fetch_strictly_public\"]";
    assert.deepEqual(root.split("\n").filter((line) => /^\s*compatibility_flags\s*=/.test(line)),
      [compatibilityFlags], "compatibility_flags must be exact and at TOML root");
    assert.equal(sections.slice(1).filter(({ content }) =>
      /^\s*compatibility_flags\s*=/m.test(content)).length, 0,
    "compatibility_flags must not appear in nested TOML sections");

    assert.match(root, /^workers_dev\s*=\s*false$/m,
      "workers_dev=false must remain at TOML root");
    assert.deepEqual(matches(root, "main"), main === null ? [] : [main],
      "Worker main must remain at TOML root");
    const actualBindings = sections.slice(1).flatMap(({ name, content }) =>
      matches(content, "binding").map((binding) => [name, binding]));
    assert.deepEqual(actualBindings, bindings,
      "Each binding must remain in its explicitly authorized TOML section");
    const auth = sections.find((section) => section.name === "[[services]]");
    if (auth) {
      assert.deepEqual(matches(auth.content, "service"), ["flamenode-web"],
        "AUTH_ORIGIN must target unchanged CURRENT Auth.js service");
    }
    const asset = sections.find((section) => section.name === "[assets]");
    if (asset) {
      assert.deepEqual(matches(asset.content, "directory"), ["./dist"],
        "assets.directory must be explicitly set within [assets]");
      assert.match(asset.content, /^run_worker_first\s*=\s*(?:true|false)$/m,
        "run_worker_first must be within [assets]");
      if (main === "./src/gateway/index.ts") {
        assert.match(asset.content, /^run_worker_first\s*=\s*true$/m,
          "Gateway must be Worker-first; [vars] values cannot override [assets]");
        assert.deepEqual(matches(asset.content, "not_found_handling"), ["404-page"]);
      } else {
        assert.match(asset.content, /^run_worker_first\s*=\s*false$/m);
        assert.deepEqual(matches(asset.content, "not_found_handling"), ["single-page-application"]);
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

  const flags = 'compatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]\n';
  const moveFlags = (body, table) => body.replace(flags, "")
    .replace(table + "\n", table + "\n" + flags);
  const gatewayFlagsInVars = moveFlags(gateway, "[vars]");
  assert.throws(() => assertStrictWranglerTopology(gatewayFlagsInVars, api, personal),
    /compatibility_flags must be exact and at TOML root/);
  const apiFlagsInVars = moveFlags(api, "[vars]");
  assert.throws(() => assertStrictWranglerTopology(gateway, apiFlagsInVars, personal),
    /compatibility_flags must be exact and at TOML root/);
  const personalFlagsInAssets = moveFlags(personal, "[assets]");
  assert.throws(() => assertStrictWranglerTopology(gateway, api, personalFlagsInAssets),
    /compatibility_flags must be exact and at TOML root/);
  const duplicatedFlagsInVars = gateway.replace("[vars]\n", "[vars]\n" + flags);
  assert.throws(() => assertStrictWranglerTopology(duplicatedFlagsInVars, api, personal),
    /compatibility_flags must not appear in nested TOML sections/);
  const swappedFlags = api.replace(flags,
    'compatibility_flags = ["nodejs_compat"]\n');
  assert.throws(() => assertStrictWranglerTopology(gateway, swappedFlags, personal),
    /compatibility_flags must be exact and at TOML root/);


  assert.throws(() => assertStrictWranglerTopology(movedAssetBinding, api, personal),
    /Each binding must remain/);

  const misplacedWorkerFlag = gateway.replace("workers_dev = false\n", "")
    .replace("[assets]\n", "[assets]\nworkers_dev = false\n");
  assert.throws(() => assertStrictWranglerTopology(misplacedWorkerFlag, api, personal),
    /workers_dev=false must remain/);

  const misplacedWorkerFirst = gateway.replace("run_worker_first = true\n", "run_worker_first = false\n")
    .replace("[vars]\n", "[vars]\nrun_worker_first = true\n");
  assert.throws(() => assertStrictWranglerTopology(misplacedWorkerFirst, api, personal),
    /Gateway must be Worker-first/);
  const missingWorkerFirst = gateway.replace("run_worker_first = true\n", "");
  assert.throws(() => assertStrictWranglerTopology(missingWorkerFirst, api, personal),
    /run_worker_first must be within/);

  const reusedProductionWorkerName = gateway.replace('name = "flamenode-public-gateway"',
    'name = "flamenode-web"');
  assert.throws(() => assertStrictWranglerTopology(reusedProductionWorkerName, api, personal),
    /Worker name must remain isolated/);
  const reusedApiProductionName = api.replace('name = "flamenode-hono-api"',
    'name = "flamenode-web"');
  assert.throws(() => assertStrictWranglerTopology(gateway, reusedApiProductionName, personal),
    /Worker name must remain isolated/);
  const reusedPersonalProductionName = personal.replace('name = "flamenode-personal"',
    'name = "flamenode-web"');
  assert.throws(() => assertStrictWranglerTopology(gateway, api, reusedPersonalProductionName),
    /Worker name must remain isolated/);
  const invalidAuthTarget = gateway.replace('service = "flamenode-web"',
    'service = "flamenode-unapproved-auth"');
  assert.throws(() => assertStrictWranglerTopology(invalidAuthTarget, api, personal),
    /AUTH_ORIGIN must target unchanged/);

  const missingDirectory = gateway.replace('directory = "./dist"\n', "");
  assert.throws(() => assertStrictWranglerTopology(missingDirectory, api, personal),
    /assets.directory must be explicitly set/);
  const missing404Handling = gateway.replace('not_found_handling = "404-page"\n', "");
  assert.throws(() => assertStrictWranglerTopology(missing404Handling, api, personal),
    /deep-equal/);

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
  const attempted = countActiveHonoMountCalls(entry);
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
  assert.ok(plan.apiSmoke.every(x => ["GET", "HEAD"].includes(x.method) || x.mode === "fixture-required"),
    "mutation endpoints cannot be automatic smoke candidates");
  // No currently mounted Hono root can be silently omitted; where API_MATRIX
  // lacks entries the source-anchored overlay supplies concrete actual paths.
  assert.deepEqual(plan.coverage.filter(x => x.needsManualAudit), []);
  assert.ok(plan.apiSmoke.some(x => x.path === "/api/manage/navigation" && x.method === "GET"));
  assert.ok(plan.apiSmoke.some(x => x.path === "/api/health/deep" &&
    x.mode === "fixture-required"), "deep-health requires a bearer fixture");
  assert.ok(plan.apiSmoke.some(x => x.path === "/api/admin/spreadsheet/data" && x.method === "GET"));
  assert.ok(plan.apiSmoke.some(x => x.path === "/api/google-drive-image/:id" && x.mode === "fixture-required"));
  assert.ok(plan.apiSmoke.some(x => x.path === "/api/youtube-thumbnail/:id/:size" && x.mode === "fixture-required"));
  assert.ok(plan.apiSmoke.some(x => x.path === "/api/personal/library" && x.mode === "fixture-required"));
  assert.ok(plan.apiSmoke.some(x => x.path === "/api/admin-read/ops/security" && x.mode === "fixture-required"));
  for (const suffix of ["slots", "submissions", "summary"]) {
    assert.ok(plan.apiSmoke.some(x => x.path === "/api/live/events/:id/" + suffix &&
      x.mode === "fixture-required"), "live endpoint fixture missing: " + suffix);
  }
  assert.ok(plan.apiSmoke.every(x => !/[?\[\]{}]/.test(x.path)),
    "smoke must only list real normalized Hono paths");
});

test("MIG-0628 U04: Hono mount parser excludes comments and quoted app.route examples", () => {
  const source = [
    'app.route("/api/real", realRoutes);',
    '// app.route("/api/commented", ghostRoutes);',
    '/* app.route("/api/block", ghostRoutes); */',
    '/*\napp.route("/api/block-multiline", ghostRoutes);\n*/',
    'const stringExample = \'app.route("/api/string", ghostRoutes)\';',
    'const templateExample = `app.route("/api/template", ghostRoutes)`;',
    'const url = "https://example.invalid/path"; app.route("/api/other", otherRoutes);',
    'app.route(\n  "/api/multiline", makeRoutes());',
  ].join("\n");
  assert.equal(countActiveHonoMountCalls(source), 3,
    "quoted and commented app.route calls cannot count as live mounts");
  assert.deepEqual(listHonoMounts(source), [
    { path: "/api/multiline", owner: "makeRoutes" },
    { path: "/api/other", owner: "otherRoutes" },
    { path: "/api/real", owner: "realRoutes" },
  ]);
  assert.deepEqual(listHonoMounts('// app.route("/api/ghost", ghostRoutes)\n'), []);
  assert.equal(countActiveHonoMountCalls('// app.route("/api/ghost", ghostRoutes)\n'), 0);
  assert.equal(countActiveHonoMountCalls('app.route("/api/health", makeRoutes(options));'), 1,
    "unparsable active mounts must still be counted for explicit audit");
  assert.throws(() => buildNewWorkerSmokePlan({
    appEntry: '/* app.route("/api/ghost", ghostRoutes); */',
    apiMatrix: "| GET /api/ghost/health | example |",
    routeMatrix: "",
  }), /no parsable Hono mounts/,
  "only commented mounts must not satisfy the source coverage gate");
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

test("MIG-0628 U04: non-readonly APIs always require owner fixtures", () => {
  const plan = buildNewWorkerSmokePlan({
    appEntry: 'app.route("/api/a", aRoutes);',
    apiMatrix: [
      "| GET /api/a/status | read |",
      "| HEAD /api/a/status | read |",
      "| POST /api/a/rebuild | write |",
      "| PUT /api/a/settings | write |",
      "| PATCH /api/a/settings | write |",
      "| DELETE /api/a/reset | write |",
      "| GET /api/a/items/:id | parameter fixture |",
    ].join("\n"),
    routeMatrix: "",
    sourceRoutes: [
      { method: "GET", path: "/api/a/status" },
      { method: "HEAD", path: "/api/a/status" },
    ],
  });
  const byMethodAndPath = (method, path) =>
    plan.apiSmoke.find((row) => row.method === method && row.path === path);
  for (const method of ["GET", "HEAD"]) {
    assert.equal(byMethodAndPath(method, "/api/a/status")?.mode, "candidate");
  }
  for (const [method, path] of [
    ["POST", "/api/a/rebuild"],
    ["PUT", "/api/a/settings"],
    ["PATCH", "/api/a/settings"],
    ["DELETE", "/api/a/reset"],
    ["GET", "/api/a/items/:id"],
  ]) {
    const probe = byMethodAndPath(method, path);
    assert.equal(probe?.mode, "fixture-required", method + " " + path);
    assert.equal(probe.expected, "owner-verified contract");
  }
  assert.equal(plan.apiSmoke.filter(x => x.mode === "candidate").length, 2);
});

test("MIG-0628 U04: API_MATRIX query syntax becomes fixture-bound real path", () => {
  const routes = collectApiMatrixRoutes([
    "| GET /api/personal/library?tab&page | user route |",
    "| GET /api/admin-read/ops/security?run=1 | privileged read |",
    "| GET /api/admin-read/ops/youtube-sync?... | query shorthand |",
    "| GET /api/live/events/[id]/{slots,submissions,summary} | Next shorthand only |",
    "| GET /api/events/[id]/slots/viewer-overlay | Next shorthand |",
    "| GET /api/health | public read |",
    "| GET /api/health?verbose | fixture even if plain also documented |",
    "| GET /api/event-endpoints/:id/release) | punctuation from prose |",
  ].join("\n"));
  const find = (path) => routes.find(r => r.path === path);
  for (const path of [
    "/api/personal/library", "/api/admin-read/ops/security",
    "/api/admin-read/ops/youtube-sync", "/api/health",
  ]) {
    assert.equal(find(path)?.requiresFixture, true, path);
  }
  assert.equal(find("/api/event-endpoints/:id/release")?.requiresFixture, false);
  assert.ok(routes.every(r => !/[?[\]{}]/.test(r.path)),
    "never include query text, Next brackets, or grouped shorthand as a route");
  assert.equal(routes.length, 5);
});

test("MIG-0628 U04: private GETs, query GETs, and grouped route shorthand fail closed", () => {
  const plan = buildNewWorkerSmokePlan({
    appEntry: [
      'app.route("/api/personal", personal);',
      'app.route("/api/admin-read", adminRead);',
      'app.route("/api/manage", manage);',
      'app.route("/api/health", health);',
      'app.route("/api/live/events", live);',
    ].join("\n"),
    apiMatrix: [
      "| GET /api/personal/dashboard | private |",
      "| GET /api/personal/library?tab&page | filter |",
      "| GET /api/admin-read/ops/security?run=1 | audited expensive read |",
      "| GET /api/manage/navigation | private |",
      "| GET /api/health | public read |",
      "| GET /api/live/events/[id]/{slots,submissions,summary} | doc shorthand |",
    ].join("\n"),
    routeMatrix: "",
    sourceRoutes: [
      { method: "GET", path: "/api/health" },
      { method: "GET", path: "/api/live/events/:id/slots" },
      { method: "GET", path: "/api/live/events/:id/submissions" },
      { method: "GET", path: "/api/live/events/:id/summary" },
    ],
  });
  const get = path => plan.apiSmoke.find(r => r.path === path && r.method === "GET");
  for (const path of [
    "/api/personal/dashboard", "/api/personal/library",
    "/api/admin-read/ops/security", "/api/manage/navigation",
    "/api/live/events/:id/slots", "/api/live/events/:id/submissions",
    "/api/live/events/:id/summary",
  ]) assert.equal(get(path)?.mode, "fixture-required", path);
  assert.equal(get("/api/health")?.mode, "candidate");
  assert.ok(!plan.apiSmoke.some(r => /[?[\]{}]/.test(r.path)));
  assert.deepEqual(plan.coverage.filter(r => r.needsManualAudit), []);
});

test("MIG-0628 U04: source overlays cannot erase documented query fixture requirements", () => {
  const plan = buildNewWorkerSmokePlan({
    appEntry: 'app.route("/api/health", health);',
    apiMatrix: "| GET /api/health?probe=1 | explicit query fixture |",
    routeMatrix: "",
    sourceRoutes: [{ method: "GET", path: "/api/health" }],
  });
  assert.equal(plan.apiSmoke.length, 1);
  assert.equal(plan.apiSmoke[0].path, "/api/health");
  assert.equal(plan.apiSmoke[0].requiresFixture, true);
  assert.equal(plan.apiSmoke[0].mode, "fixture-required");
  assert.deepEqual(plan.coverage.filter(x => x.needsManualAudit), []);
});

test("MIG-0628 U04: deep health is authenticated and cannot be an ordinary smoke candidate", () => {
  const plan = buildNewWorkerSmokePlan({
    appEntry: 'app.route("/api/health", healthRoutes);',
    apiMatrix: [
      "| GET /api/health | ordinary health |",
      "| GET /api/health/deep | authenticated diagnostics |",
    ].join("\n"),
    routeMatrix: "",
    sourceRoutes: [{ method: "GET", path: "/api/health" }],
  });
  const health = plan.apiSmoke.find(x => x.path === "/api/health");
  const deep = plan.apiSmoke.find(x => x.path === "/api/health/deep");
  assert.equal(health?.mode, "candidate");
  assert.equal(health.expected, 200);
  assert.equal(deep?.mode, "fixture-required");
  assert.match(deep.expected, /401.*503/);
  assert.ok(!plan.apiSmoke.some(x => x.path === "/api/health/deep" && x.mode === "candidate"));
});

test("MIG-0628 U04: private React/Vite SPA routes never enter public smoke", () => {
  const plan = buildNewWorkerSmokePlan({
    appEntry: 'app.route("/api/health", healthRoutes);',
    apiMatrix: "| GET /api/health | public |",
    routeMatrix: [
      "| Route group | CURRENT | TARGET | Render | Data | Visibility/Auth |",
      "| --- | --- | --- | --- | --- | --- |",
      "| \`/about\` | Next/OpenNext | Astro/site | SSG | snapshot | public |",
      "| \`/dashboard\` | Next/OpenNext | React/Vite app | SPA | Hono | auth |",
      "| \`/dashboard/*\` | Next/OpenNext | React/Vite app | SPA | Hono | auth |",
      "| \`/manage/navigation\` | Next/OpenNext | React/Vite app | SPA | Hono | auth |",
      "| \`/admin\` | Next/OpenNext | React/Vite app | SPA | Hono | admin |",
    ].join("\n"),
  });
  assert.ok(plan.publicSmoke.some(x => x.path === "/about"));
  for (const path of ["/dashboard", "/manage/navigation", "/admin"]) {
    assert.ok(!plan.publicSmoke.some(x => x.path === path),
      "private SPA route cannot be a public smoke candidate: " + path);
  }
  assert.ok(plan.publicSmoke.every(x => x.mode === "candidate"));
});

test("MIG-0628 U04: source route audit requires an actual Hono router receiver", () => {
  const hono = 'import { Hono } from "hono";\nconst routes = new Hono<AppEnv>();\n';
  for (const commented of [
    '// routes.get("/data", handler);\n',
    '/* routes.get("/data", handler); */\n',
    '/*\nroutes.get("/data", handler);\n*/\n',
    'const url = "https://example.test/api"; // routes.get("/data", handler)\n',
    'const text = ".get(\\"/data\\", handler)";\n',
    'const sample = `.get("/data", handler)`;\n',
  ]) {
    assert.equal(sourceDeclaresGetRoute(hono + commented, "/data"), false,
      "commented or quoted route cannot satisfy smoke coverage");
  }

  assert.equal(sourceDeclaresGetRoute('routes.get("/data", handler);', "/data"), false,
    "a source snippet without Hono must fail closed");
  for (const unrelated of [
    'const cache = new Map(); cache.get("/data", handler);',
    'const client = { get() {} }; client.get("/data", handler);',
    'const object = { routes }; object.routes.get("/data", handler);',
    'const fake = "const proxy = new Hono();"; proxy.get("/data", handler);',
    'const hidden = /* new Hono() */ new Map(); hidden.get("/data", handler);',
  ]) {
    assert.equal(sourceDeclaresGetRoute(hono + unrelated, "/data"), false,
      "non-Hono receiver must not satisfy smoke coverage: " + unrelated);
  }
  assert.equal(sourceDeclaresGetRoute(hono +
    'const url = "https://test.invalid"; routes.get("/data", handler);',
    "/data"), true, "quoted URLs do not suppress a real registration");
  assert.equal(sourceDeclaresGetRoute(hono + 'routes.get("/data", handler);', "/data"), true);
  assert.equal(sourceDeclaresGetRoute(hono + "routes.get('/data', handler);", "/data"), true);
  assert.equal(sourceDeclaresGetRoute(hono + 'routes.get(\n  "/data", async (c) => {})', "/data"), true);
  assert.equal(sourceDeclaresGetRoute(
    'import { Hono } from "hono";\n' +
    'const dashboard = new Hono<AppEnv>().get("/", async (c) => {});', "/"), true);
  assert.equal(sourceDeclaresGetRoute(hono + 'routes.get("/other", handler);', "/data"), false);
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

test("MIG-0628 U04: matrix-only fictitious GET stays manual even under a real mount", () => {
  const plan = buildNewWorkerSmokePlan({
    appEntry: 'app.route("/api/health", healthRoutes);',
    apiMatrix: [
      "| GET /api/health | real source-verified |",
      "| GET /api/health/not-registered | documentation drift |",
    ].join("\n"),
    routeMatrix: "",
    sourceRoutes: [{ method: "GET", path: "/api/health" }],
  });
  const real = plan.apiSmoke.find(r => r.path === "/api/health");
  const invented = plan.apiSmoke.find(r => r.path === "/api/health/not-registered");
  assert.equal(real?.mode, "candidate");
  assert.equal(invented?.mode, "fixture-required",
    "a mounted prefix does not prove the documented leaf handler exists");
});
