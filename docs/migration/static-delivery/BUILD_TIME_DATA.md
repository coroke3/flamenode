# Build-Time Public Data & Delivery (D-09)

> Status: Draft (MIG-0409, PR #323). Nothing here is deployed.
> Last verified: 2026-10-18
> Source of truth: `docs/migration/OPEN_DECISIONS.md` (D-06, D-09), `docs/migration/ZERO_1102.md` (§1, §3, §5), `docs/migration/PHASE_4_5_SPEC.md` §MIG-0409

Every number below is either measured (with the command that produced it) or marked
**NOT MEASURED**. Measured numbers are local (one Linux VM, Node 22) and are not Workers
Builds, workerd or production figures. A 2026-10-18 review removed earlier figures (build 0.35 min, page render
4.2–6.8 ms / 18–35 ms, shard < 4.5 ms) because no measurement or log backed them.

## 0. Owner decisions (Yugo, project chat 2026-10-18T16:38:49Z, "すべて承認してよい　進めて")

| Item | Decision |
| --- | --- |
| Maximum publish delay | **Approved**: about 60 min + one build (CURRENT 30–300 s). The MIG-0410 constants follow §2 |
| Build-time D1 read | **Option A** (read-only API token, least privilege) — default applied because the approval named no option; see §5 |
| Non-production Worker, Queue and Workers Builds project for U03 / U07 | **Approved** to create and later delete. Not created yet: this agent has no Cloudflare credentials; owner steps in §2 and §4 U07 |
| One read-only production D1 count | **Done** once (§6); no further remote D1 read |
| New page with no R2 HTML yet | **Not part of the approval** — CURRENT gateway 404/503 stays (§3.1) |

## 1. Delivery classification (U02)

CURRENT `revalidate` values are read from the page files (`export const revalidate`).

| Public data | CURRENT revalidate (source) | Changed by | Target delivery | Owner MIG |
| --- | --- | --- | --- | --- |
| `events/index.json` (event list + group sections) | 30 s (`app/(public)/event/page.tsx:8`); R2 object `max-age=300` (`workers/json-generator/rebuild.ts` `rebuildEventsIndex`) | event / group / public staff edit, visibility change | **build** (`apps/site/scripts/readPublicData.ts`, this PR) | MIG-0409 → MIG-0509 |
| Home `top.json` sections | 120 s (`app/(public)/page.tsx:53`) | video publish, featured edit, stats | build (sections faster than the build interval → API) | MIG-0509 / MIG-06xx |
| Work list `/list` | 30 s (`app/(public)/list/page.tsx:8`) | video publish / score | **NOT DECIDED** — U06 shard CPU not measured | MIG-0409 U06 |
| Recommend / trending | 300 s (`recommend/page.tsx:27`, `trending/page.tsx:23`) | score / sync jobs | **NOT DECIDED** — U06 | MIG-0409 U06 |
| User list `/user` | 30 s (`app/(public)/user/page.tsx:8`) | profile / approval | **NOT DECIDED** — U06 | MIG-0409 U06 |
| Video `/[id]` | 30 s (`app/(public)/[id]/page.tsx:65`) | video edit / visibility | **Build (MIG-0509) until an Island loader exists**; the Queue only deletes unpublished pages (upper-bound `renderToString` 25–49 ms; the approved Island-shell fallback has no client loader, so it would be an empty body) | MIG-0411 / MIG-0509 |
| User `/user/[id]` | 30 s (`app/(public)/user/[id]/page.tsx:9`) | profile edit, work publish | Queue → R2 HTML, **server-rendered** (`renderToString` max 4.4–5.8 ms) | MIG-0411 |
| Event `/event/[id]` | 60 s (`app/(public)/event/[id]/page.tsx:61`) | event / staff edit | **Build (MIG-0509) until an Island loader exists**; the Queue only deletes unpublished pages (max 5.4–8.7 ms, 5 of 6 runs ≥ 8 ms; Island-shell fallback has no loader) | MIG-0411 / MIG-0509 |
| Slot vacancy (`/event/[id]/slots`) | 30 s (`slots/page.tsx:32`) | reservation / release | **API (S2) from an Island** | MIG-06xx (slots) |
| Like count, viewer overlay | per request | like, session | API (S2) from an Island | MIG-06xx |

## 2. Build budget (U03) — local measurement only

Formula (Work Order): `data builds/day = floor((3,000 × 0.8 − code-push build minutes/month) ÷ minutes per build ÷ 30)`.

**Local measurement, 2026-10-18** (not Workers Builds; log
`project-files/migration-review/pr323-u03-build-timing.log`). Machine: Intel Xeon 2.80 GHz,
4 cores, Node v22.22.0, Linux. Clean `git clone` of the branch; synthetic snapshot written by
`apps/site/scripts/measurePublicData.mjs --snapshot` (real `migrations/` schema, 3,000 works,
20 events, 120 slots each, 1,000 users). One run = `npm run build -w @flamenode/ui` →
`readPublicData.ts --sqlite <snapshot>` → `npm run build -w @flamenode/site`, with `dist` and
`.astro` removed first.

| Run | ui build | data (events index) | site build | total |
| --- | --- | --- | --- | --- |
| 1 | 4.98 s | 0.19 s | 10.99 s | 16.17 s |
| 2 | 5.82 s | 0.26 s | 12.61 s | 18.69 s |
| 3 | 8.92 s | 0.27 s | 13.46 s | 22.66 s |
| 4 | 6.27 s | 0.35 s | 12.43 s | 19.06 s |
| 5 | 4.61 s | 0.13 s | 9.51 s | 14.25 s |

`npm ci` on an empty `node_modules` (one run): 62.40 s. The five events-index files are
byte-identical (T04). `dist` is 5 files / 192,915 B.

Calculation with these local figures (minutes per build `m` = install + slowest build =
(62.40 + 22.66) s = 1.418 min):

- Code-push builds: 125 PRs merged into `main` from 2026-09-18 to 2026-10-18
  (`GET https://api.github.com/repos/coroke3/flamenode/pulls?state=closed&base=main`, `merged_at`
  in the window; 158 commits on `main` in the same window) → 125 × 1.418 = 177.2 min/month.
- Data builds/day = floor((2,400 − 177.2) ÷ 1.418 ÷ 30) = **52**; shortest interval =
  1,440 ÷ 52 = **27.7 min**.
- The MIG-0410 check runs in the hourly `flamenode-fast-jobs` Cron (`0 * * * *`), so the
  effective cap is **24 builds/day** and the maximum publish delay is about **60 min + one
  build (~1.5 min locally)**, against CURRENT's 30–300 s `revalidate`.

Limits of this figure: Workers Builds machine speed, clone, queueing and the deploy upload are
not included; `apps/site` renders 2 pages today and does not yet render the detail pages
(Phase 5), so the real build will be longer and the daily cap lower. Re-measure on Workers
Builds once a non-production build project exists (needs approval).

**MIG-0410 constants (approved with the publish delay, 2026-10-18):**
`MAX_DATA_BUILDS_PER_DAY = 52` (the formula above) and
`MIN_BUILD_INTERVAL_MS = ceil(86,400,000 ÷ 52) = 1,661,539 ms` (27.7 min). The hourly Cron is the
binding limit (24 hooks/day, maximum delay ≈ 60 min + build); the constants only bind if the
check ever runs more often. Re-derive both when Workers Builds timing replaces the local figure.

**Owner steps to re-measure on Workers Builds (approved, not run — no credentials here):**

1. Dashboard → Workers & Pages → Create → Import a repository → `coroke3/flamenode`, project
   name `flamenode-u03-build-probe`, production branch: a throwaway branch (e.g.
   `probe/u03-build`) so no production Worker is touched; build command
   `npm ci && npm run build -w @flamenode/ui && npm run build -w @flamenode/site`; deploy command
   `true` (build only).
2. Push 5 empty commits to `probe/u03-build`; record each build's duration from the build log.
3. Put the 5 durations in this table, recompute `m`, the daily cap and the interval.
4. Delete the project (Settings → Delete) and the branch.

## 3. New and unpublished pages (U04)

### 3.1 A page that has no R2 HTML yet

Current gateway behaviour (MIG-0405/0406, `apps/site/src/gateway/index.ts`, `r2Html.ts`):

- A path not in the route shards answers **404** (the route manifest is produced by the build,
  so a work created after the last build is unknown to the gateway until the next build).
- A path in the shards whose R2 HTML is missing / from another generation / unreadable answers
  **503** and sends one `rebuild-page` message (once per key per isolate per minute).

The Work Order default ("serve a static shell and let the Island read the API") is **not
implemented**. The 2026-10-18 approval did not cover it, so the current 404/503 behaviour stays;
a new work is reachable once the next build (≤ ~60 min + build) adds its route.

### 3.2 Unpublished after the build

- The update API (S3) writes the revocation entry in the same request. Key format is owned by
  `revocationKey()` in `apps/site/src/gateway/routeShards.ts`: `deny:<kind>:<id>` (user ids
  lower-cased). Writers must call that function; no other format is valid.
- The entry must **not** have a TTL that can expire while the page is private (an expired entry
  would make a stale build page servable again). It is removed only on republish.
- The gateway reads that one KV key before serving any Static Assets or R2 page (fail-closed 503
  when KV is unbound). KV propagation to other locations can take up to 60 s
  (https://developers.cloudflare.com/kv/api/write-key-value-pairs/).

## 4. CPU measurements (U05, U06, U07)

**Local Node measurement, 2026-10-18** — not workerd and not production. Command:
`node --experimental-strip-types --no-warnings apps/site/scripts/measurePublicData.mjs --runs 50 --out <result.json>`
(two runs; log `project-files/migration-review/pr323-u05-u06-cpu.log`; same machine as §2).
The harness runs CURRENT `workers/json-generator/rebuild.ts` `rebuildTarget` on the synthetic
set above, one cold run then 50 warm runs (20 for whole families), each from the same R2 state
so CURRENT's "same generation" skip never shortcuts a sample. CPU = `process.cpuUsage()` of the
process. SQLite runs in-process, so "total" includes SQL execution that a Worker would wait for
remotely, and "excl. D1" subtracts the time inside the D1 shim (which also removes result
materialisation, which is CPU on Workers): the Workers figure is expected between the two.
Values are max over 50 samples (range across the two runs).

### U05 (b) CURRENT JSON for one page, largest synthetic input per kind

| Kind (target) | total p50 | total max | excl. D1 max | D1 statements | output |
| --- | --- | --- | --- | --- | --- |
| Video `video` (3 members, related lists) | 17.5–18.1 ms | 28.6–29.3 ms | 15.8–18.2 ms | 18 | 27,056 B, 2 objects |
| User `user` (busiest creator, 3 works) | 5.8 ms | 10.0–10.6 ms | 0.9–1.0 ms | 6 | 3,669 B |
| Event `event_base` | 5.4–5.5 ms | 10.6–10.7 ms | 5.4–5.8 ms | 7 | 33,354 B |
| Event `event_slots` (120 slots) | 0.9 ms | 1.5–1.8 ms | 1.1–1.2 ms | 5 | 9,496 B |
| Event `event_release` (100 works) | 9.0–9.3 ms | 19.5–28.2 ms | 11.0–17.0 ms | 5 | 79,340 B |
| Event composer `event` | 1.2–1.6 ms | 5.7–7.1 ms | 5.4–6.6 ms | 4 | 41,472 B |

Indicative reading against the 8 ms `B` budget (MIG-0411 keeps only kinds with max < 8 ms):
video and the event release section exceed it even without D1 time; user and event slots stay
below it; event base and the composer are borderline. Not a final classification: ZERO_1102 §5
requires a workerd profile.

U05 (a) server-rendered page per kind — **measured in MIG-0411 (PR #326)**: React `renderToString`
of the shared `@flamenode/ui` screens (MIG-0205) inside the site adapters (MIG-0402), which is
what Astro itself calls for React components; `experimental_AstroContainer` was not used because
no `.astro` R-PAGE page exists yet (MIG-0403) and the gateway Worker bundles no Astro runtime.
Upper-bound inputs (video 100 members / 128 chapters / 30 related; event 8 works / 20 staff /
20 slot parts; user 8 + 8 works; 1,000-char titles, 10,000-char bodies), NODE_ENV=production,
max of 300 warm renders, 6 runs (`project-files/migration-review/pr326-u05a-render-to-string.log`):

| Kind | p50 | p95 | max | HTML | Format chosen |
| --- | --- | --- | --- | --- | --- |
| Video | 1.7–2.8 ms | 5.4–6.8 ms | 25.3–48.8 ms | 591 KB | excluded (Island-shell fallback approved, no loader yet) |
| User | 0.3–0.6 ms | 0.9–1.9 ms | 4.4–5.8 ms | 166 KB | server-rendered |
| Event | 0.5–0.8 ms | 1.0–1.5 ms | 5.4–8.7 ms | 157 KB | excluded (borderline; Island-shell fallback approved, no loader yet) |

The first render in a fresh isolate also evaluates React and the UI (8.7–12.0 ms for the
wrangler-like bundle), which alone exceeds 8 ms; whether that counts against the consumer's CPU
is part of the U07 / workerd check. Behaviour difference (approved): no-JS readers and crawlers
see no body text on video / event pages rendered by the Queue until the Island reads it.
That Island needs a client loader (a built script plus the page data) that does not exist yet
(R-PAGE pages, MIG-0403), so the Queue does not write video / event pages at all (2026-10-19,
PR #326 review): they stay with the build (MIG-0509) and the Queue only deletes them on
unpublish. The fallback is enabled together with its loader.

### U06 list / search shards

Whole family (CURRENT, 3,000 works, 2,850 public):

| Family | total p50 | total max | output |
| --- | --- | --- | --- |
| `list_recent` | 24.2–26.7 ms | 48.9–58.1 ms | 856,470 B |
| `list_popular` | 26.6–27.6 ms | 31.9–34.1 ms | 856,470 B |
| `search_index` | 1,007–1,082 ms | 1,302–1,633 ms | 41,101,106 B in 967 objects |

Shard proxy (the same CURRENT producer over a database holding only S public works, i.e. the
cost of one shard of S items with CURRENT's SQL, DTO and stringify; the shard format itself is
not designed yet):

| S | `list_recent` p95 / max | `search_index` p95 / max |
| --- | --- | --- |
| 50 | 1.3 / 4.1–4.7 ms | 27.6–35.7 / 44.6–45.5 ms |
| 100 | 1.6–2.9 / 4.7–4.9 ms | 47.2–53.5 / 49.0–75.4 ms |
| 250 | 6.3–6.9 / 12.1–13.4 ms | 98.4–102.1 / 119.3–119.6 ms |
| 500 | 12.4–13.9 / 12.9–20.7 ms | 188.5–219.2 / 195.0–234.2 ms |

Indicative classification by the D-09 rule (shard max < 8 ms → Queue): new / popular lists →
**Queue, split into shards of ≤ 100 items** (max 4.9 ms; 250 already exceeds 8 ms); search
index in CURRENT's format → **build** (even 50 works cost > 40 ms); events index → build (this
PR). Pending a workerd profile and the user's review; nothing here changes MIG-0410 / MIG-0411.

### U07 Queue consumer CPU limit — APPROVED, NOT RUN (BLOCKED: no Cloudflare credentials here)

Probe: `apps/site/scripts/queue-cpu-probe/worker.ts` + `wrangler.jsonc` (Worker and Queue both
named `flamenode-u07-queue-cpu-probe`, `max_batch_size = 1`, `max_retries = 0`, no FlameNode
bindings, no Route). The consumer runs `ITERATIONS_PER_MS × ms` loop iterations (Workers freeze
the clock during execution); locally that is 23.3 / 104.4 / 994.5 ms CPU for 20 / 100 / 1000
(`worker.test.mjs`; `wrangler deploy --dry-run` bundles it, 1.46 KiB). Owner steps:

```bash
npx wrangler login
npx wrangler queues create flamenode-u07-queue-cpu-probe
npx wrangler deploy --config apps/site/scripts/queue-cpu-probe/wrangler.jsonc
npx wrangler tail flamenode-u07-queue-cpu-probe --format json > u07-tail.jsonl   # leave running
for ms in 20 100 1000; do
  curl -X POST "https://flamenode-u07-queue-cpu-probe.<subdomain>.workers.dev/send?ms=$ms&count=50"
  sleep 120
done
# count per condition: outcome == "exceededCpu" vs "ok", and cpuTime, from u07-tail.jsonl
npx wrangler delete --config apps/site/scripts/queue-cpu-probe/wrangler.jsonc
npx wrangler queues delete flamenode-u07-queue-cpu-probe
```

Results (3 × `exceededCpu` counts) go to `ZERO_1102.md` §1. A local run cannot answer it:
workerd does not enforce or report the production CPU limit.

## 5. How the build reads D1

| Option | What | Status |
| --- | --- | --- |
| A | D1 REST API with a "D1 Read"-only API token in the build environment | **Chosen** (2026-10-18 default); code done, token not created |
| B | `wrangler d1 export` before the build, then the CLI on the snapshot | Not used (needs a broader credential) |
| C | Local SQLite fixture | Tests and local measurement only |

```bash
# A (Workers Builds): build variables CLOUDFLARE_ACCOUNT_ID, FLAMENODE_D1_DATABASE_ID, FLAMENODE_D1_READ_TOKEN
node --experimental-strip-types apps/site/scripts/readPublicData.ts --d1-api --out <events-index.json>
# C (local)
node --experimental-strip-types apps/site/scripts/readPublicData.ts \
  --sqlite <snapshot.sqlite> --out <events-index.json> [--generated-at <unix seconds>]
```

Option A (`openD1HttpReader`) POSTs each statement to
`/client/v4/accounts/<account>/d1/database/<database>/query`, refuses anything that is not a
single `SELECT` / `WITH` before sending (defence in depth on top of the token scope), sends at
most 19 requests per run, times out after 15 s, and never puts the token in a log or error.
Tests use a fake endpoint over the same SQLite fixture: output bytes equal the SQLite path.

Owner steps (not run — no credentials here; the token is a secret):

1. Dashboard → My Profile → API Tokens → Create Custom Token, name
   `flamenode-build-d1-read`; permission **Account → D1 → Read** only; account resources: the
   FlameNode account only; optional TTL.
2. Check it once from a trusted shell: `curl -X POST .../d1/database/<id>/query -H "Authorization: Bearer $T" -d '{"sql":"SELECT 1"}'`.
   If the API rejects a Read-only token for `/query` (`Authentication error`), **stop** and tell
   the lead — do not widen the token to D1 Edit; the fallback (option B, or a read-only proxy
   Worker) needs a new decision.
3. Add `FLAMENODE_D1_READ_TOKEN` (secret), `CLOUDFLARE_ACCOUNT_ID`, `FLAMENODE_D1_DATABASE_ID`
   as build variables of the Workers Builds project (MIG-0509 wires the build command).

It opens the file read-only, runs a bounded number of statements (at most 19: count, list,
groups, group events, and public-staff chunks of 90 ids for ≤ 200 + ≤ 1,000 events), each capped
by `LIMIT` / window limits from the `MAX_` constants (which equal CURRENT's), fails when the public event count exceeds
`EVENTS_INDEX_MAX_ROWS` (CURRENT silently keeps the newest 200), and writes key-sorted JSON.
It never runs inside a Worker request. Choosing A or B, and creating the token or credential,
is pending user approval.

## 6. Sizing from the production counts (one read-only count, 2026-10-18)

Source: `project-files/migration-review/2026-10-18-prod-d1-count.log` (one SELECT via the
Cloudflare MCP connector, `changes = 0`, approved by the owner). videos 708 / 701 public,
events 22 / 22 public, event_groups 2, slots 98, x_users 737 (113 `approved`), auth users 128,
video_chapters 1,196, video_members 1,915. Public user pages follow
`PUBLIC_LISTABLE_X_APPROVAL_STATUSES` (approved, pending, imported, …), so the user-page count is
between 113 and 737; the upper bound is used below.

| Quantity | Estimate | Limit | Share |
| --- | --- | --- | --- |
| Detail pages (video 701 + user ≤ 737 + event 22) | ≤ 1,460 | — | — |
| Static Assets files if every page were in Assets: pages ≤ 1,460 + route shards 256 + fixed pages / `_astro` / JSON (≈ 50) | ≤ 1,766 | 20,000 files / version | ≤ 8.8 % |
| Static Assets files with the D-06 split (detail pages in R2): shards 256 + fixed / build JSON ≈ 50 | ≈ 306 | 20,000 | ≈ 1.5 % |
| R2 objects (detail HTML) | ≤ 1,460 | — | — |

Assets / R2 split: the file count would fit in Static Assets either way; detail pages stay in
R2 because of freshness (Assets change only with a build, ≤ 24/day), not because of size.
Static Assets: home, lists / events index / search index JSON (build families of §1), route
shards, fixed pages and bundles. R2: one HTML per public video / user / event, written by the
MIG-0411 consumer.

R2 reads: each detail page view is one R2 GET (Class B; free 10 M/month ≈ 333,000/day) after one
KV read and one route shard read. No traffic figures were read, so the volume is stated as that
break-even: the free tier holds up to ~333 k detail views/day. R2 writes are one PUT per render
(Class A; free 1 M/month) — at most the message volume below.

Queue messages (free 10,000 operations/day; one message ≈ 3 operations — write, read,
delete — under 64 KB; 50 % = 5,000 operations ≈ 1,666 messages/day). Sources and estimate
(update rates were not read; per-entity rates are the assumption):

| Source | Messages/day | Operations | Share |
| --- | --- | --- | --- |
| Update doorbells, every public entity updated once a day (≤ 1,460) | ≤ 1,460 | ≤ 4,380 | ≤ 43.8 % |
| Recovery doorbells (≤ 5 per Cron run, hourly; only rows still pending) | ≤ 120 | ≤ 360 | ≤ 3.6 % |
| Gateway `rebuild-page` after a build that changes the route generation (each visited page once per isolate per minute) | ≤ 1,460 × builds that change the generation | — | **see note** |

With realistic update rates (far below one update per entity per day) the first two rows stay
well inside 50 %. The third row is the risk: R2 HTML is accepted only when its generation equals
the route shard generation (`r2Html.ts`), so if every data build (≤ 24/day) produced a new
generation, every visited detail page would answer 503 and be re-rendered after each build —
up to 1,460 × 24 ≈ 35,000 messages/day, 10× the free tier. MIG-0509 must therefore keep the
route generation unchanged across data-only builds (e.g. derive it from the route manifest
content), or the gateway contract must change; that is a design decision for the lead and the
owner, recorded in MIG-0411.

