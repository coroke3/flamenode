// MIG-0503 characterization: the `/groups` compatibility redirects in apps/site/public/_redirects against CURRENT
// app/(public)/groups/** (Next `redirect()` = 307) and `eventGroupPublicHref`. The workerd behaviour of the rules
// (status, Location, fragment, query) is recorded by scripts/migration-groups-redirects.wrangler-smoke.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { eventGroupAnchorId, eventGroupPublicHref } from "../src/lib/eventGroupRoutes.ts";
import { buildEventsIndexModel, parseEventsQuery } from "../apps/site/src/lib/eventIndex.ts";
import { loadEventBuildData } from "../apps/site/src/lib/eventData.ts";
import { mergeEventRedirects } from "../apps/site/src/integrations/eventRedirects.ts";

const read = (p) => fs.readFileSync(p, "utf-8");
const redirectsText = read("apps/site/public/_redirects");

/** `_redirects` lines: `source destination status`, `#` comments and blank lines ignored. */
function parseRules(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [source, destination, status] = l.split(/\s+/);
      return { source, destination, status: Number(status) };
    });
}

/** Mirrors the Workers Static Assets matching proven in the wrangler smoke: exact path or one `:name` segment. */
function match(rules, pathname) {
  for (const rule of rules) {
    const names = [...rule.source.matchAll(/:([A-Za-z_]\w*)/g)].map((m) => m[1]);
    const re = new RegExp("^" + rule.source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:([A-Za-z_]\w*)/g, "([^/]+)") + "$");
    const m = re.exec(pathname);
    if (!m) continue;
    let location = rule.destination;
    names.forEach((n, i) => (location = location.replaceAll(":" + n, m[i + 1])));
    return { status: rule.status, location };
  }
  return null;
}

const rules = parseRules(redirectsText);

test("T01 /groups -> 307 /event (CURRENT redirect(\"/event\"))", () => {
  assert.match(read("app/(public)/groups/page.tsx"), /redirect\("\/event"\)/);
  assert.deepEqual(match(rules, "/groups"), { status: 307, location: "/event" });
  assert.deepEqual(match(rules, "/groups/"), { status: 307, location: "/event" }, "the gateway asks Assets for the directory form");
});

test("T02 /groups/spring -> 307 /event#event-group-spring (CURRENT eventGroupPublicHref)", () => {
  assert.match(read("app/(public)/groups/[slug]/page.tsx"), /redirect\(eventGroupPublicHref\(slug\)\)/);
  assert.equal(eventGroupPublicHref("spring"), "/event#event-group-spring");
  assert.deepEqual(match(rules, "/groups/spring"), { status: 307, location: eventGroupPublicHref("spring") });
  assert.deepEqual(match(rules, "/groups/spring/"), { status: 307, location: eventGroupPublicHref("spring") });
});

test("T03 /groups/a%20b: same URL as CURRENT after parsing (CURRENT puts the decoded slug in Location raw, workerd re-encodes)", () => {
  // Next gives the page the decoded param `a b`; the redirect header is the raw string `/event#event-group-a b`.
  const current = eventGroupPublicHref(decodeURIComponent("a%20b"));
  assert.equal(current, "/event#event-group-a b");
  // workerd substitutes the still-encoded segment (smoke: Location `/event#event-group-a%20b`).
  const ours = match(rules, "/groups/a%20b").location;
  assert.equal(ours, "/event#event-group-a%20b");
  const normalize = (loc) => new URL(loc, "https://flamenode.net").href;
  assert.equal(normalize(ours), normalize(current));
  // the browser resolves both to the element id `event-group-a b` (EventGroupHashScroll decodes the hash)
  assert.equal(decodeURIComponent(new URL(ours, "https://flamenode.net").hash.slice(1)), eventGroupAnchorId("a b"));
});

test("T04 query: documented divergence (assets keep it, CURRENT drops it); nothing else in the rules reads it", () => {
  // `_redirects` has no way to drop a request query string: see the smoke (assets: /groups?x=1 -> /event?x=1;
  // gateway PoC: /groups answered 200). The rules therefore never carry a query in their destination.
  assert.ok(rules.every((r) => !r.destination.includes("?")));
  assert.match(read("docs/migration/work-items/MIG-0503.md"), /\/groups\?x=1/);
});

test("rules are exactly the four compatibility entries, all 307, and no groups page exists", () => {
  assert.deepEqual(rules, [
    { source: "/groups", destination: "/event", status: 307 },
    { source: "/groups/", destination: "/event", status: 307 },
    { source: "/groups/:slug", destination: "/event#event-group-:slug", status: 307 },
    { source: "/groups/:slug/", destination: "/event#event-group-:slug", status: 307 },
  ]);
  assert.ok(!fs.existsSync("apps/site/src/pages/groups"), "no new screen for /groups");
  assert.equal(match(rules, "/groups/a/b"), null, "CURRENT [slug] is a single segment");
  assert.equal(match(rules, "/group"), null);
});

test("target anchor: /event renders a section with id event-group-{slug} for every group", async () => {
  const data = await loadEventBuildData({});
  const model = buildEventsIndexModel(data.index, parseEventsQuery(""), 1_800_000_000);
  const anchors = model.sections.map((s) => s.anchorId).filter(Boolean);
  assert.deepEqual(anchors, data.index.groupSections.filter((g) => g.events.length > 0).map((g) => eventGroupAnchorId(g.slug)));
  assert.ok(anchors.length > 0);
});

test("MIG-0502 integration keeps hand-written rules: merged `_redirects` still holds the groups entries", () => {
  const merged = mergeEventRedirects(redirectsText, ["/event/x/slots /event/x 307"]);
  assert.ok(merged.startsWith(redirectsText));
  assert.deepEqual(parseRules(merged).slice(0, 4), rules);
  assert.equal(parseRules(merged).length, 5);
});

test("built dist/_redirects (when built) has the groups rules before the generated event block", { skip: fs.existsSync("apps/site/dist/_redirects") ? false : "apps/site/dist missing: build @flamenode/site first" }, () => {
  const built = read(path.join("apps/site/dist", "_redirects"));
  assert.deepEqual(parseRules(built).slice(0, 4), rules);
  assert.ok(!fs.existsSync("apps/site/dist/groups"), "no groups HTML");
});
