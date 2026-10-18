# Build-Time Public Data & Delivery (D-09)

> Status: Draft (MIG-0409, PR #323). Not approved; nothing here is deployed.
> Last verified: 2026-10-18
> Source of truth: `docs/migration/OPEN_DECISIONS.md` (D-06, D-09), `docs/migration/ZERO_1102.md` (§1, §3, §5), `docs/migration/PHASE_4_5_SPEC.md` §MIG-0409

Every number below is either measured (with the command that produced it) or marked
**NOT MEASURED**. Measured numbers are local (one Linux VM, Node 22) and are not Workers
Builds, workerd or production figures. A 2026-10-18 review removed earlier figures (build 0.35 min, page render
4.2–6.8 ms / 18–35 ms, shard < 4.5 ms) because no measurement or log backed them.

## 1. Delivery classification (U02)

CURRENT `revalidate` values are read from the page files (`export const revalidate`).

| Public data | CURRENT revalidate (source) | Changed by | Target delivery | Owner MIG |
| --- | --- | --- | --- | --- |
| `events/index.json` (event list + group sections) | 30 s (`app/(public)/event/page.tsx:8`); R2 object `max-age=300` (`workers/json-generator/rebuild.ts` `rebuildEventsIndex`) | event / group / public staff edit, visibility change | **build** (`apps/site/scripts/readPublicData.ts`, this PR) | MIG-0409 → MIG-0509 |
| Home `top.json` sections | 120 s (`app/(public)/page.tsx:53`) | video publish, featured edit, stats | build (sections faster than the build interval → API) | MIG-0509 / MIG-06xx |
| Work list `/list` | 30 s (`app/(public)/list/page.tsx:8`) | video publish / score | **NOT DECIDED** — U06 shard CPU not measured | MIG-0409 U06 |
| Recommend / trending | 300 s (`recommend/page.tsx:27`, `trending/page.tsx:23`) | score / sync jobs | **NOT DECIDED** — U06 | MIG-0409 U06 |
| User list `/user` | 30 s (`app/(public)/user/page.tsx:8`) | profile / approval | **NOT DECIDED** — U06 | MIG-0409 U06 |
| Video `/[id]` | 30 s (`app/(public)/[id]/page.tsx:65`) | video edit / visibility | **Queue, one page per message → R2 HTML** | MIG-0411 |
| User `/user/[id]` | 30 s (`app/(public)/user/[id]/page.tsx:9`) | profile edit, work publish | Queue → R2 HTML | MIG-0411 |
| Event `/event/[id]` | 60 s (`app/(public)/event/[id]/page.tsx:61`) | event / staff edit | Queue → R2 HTML | MIG-0411 |
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

The MIG-0410 constants (`MIN_BUILD_INTERVAL_MS`, `MAX_DATA_BUILDS_PER_DAY`) stay **unset**: the
Work Order STOP requires the user to approve the maximum publish delay first.

## 3. New and unpublished pages (U04)

### 3.1 A page that has no R2 HTML yet

Current gateway behaviour (MIG-0405/0406, `apps/site/src/gateway/index.ts`, `r2Html.ts`):

- A path not in the route shards answers **404** (the route manifest is produced by the build,
  so a work created after the last build is unknown to the gateway until the next build).
- A path in the shards whose R2 HTML is missing / from another generation / unreadable answers
  **503** and sends one `rebuild-page` message (once per key per isolate per minute).

The Work Order default ("serve a static shell and let the Island read the API") is **not
implemented and not verified**. Choosing between it and the current 404/503 behaviour is a
user decision.

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

U05 (a) full `experimental_AstroContainer.renderToString` per kind: **NOT MEASURED** — no Astro
page components for video / user / event exist yet (Phase 5). Restart: when R-PAGE components
land, render the same inputs with this harness.

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

### U07 Queue consumer CPU limit — NOT RUN (BLOCKED)

Needs a non-production Worker and Queue in the Cloudflare account (20 ms / 100 ms / 1 s
consumers × 50 messages, count `exceededCpu`). Restart condition: the user approves creating
and later deleting those resources (names and deletion steps shown in the PR first); results go
to `ZERO_1102.md` §1. A local run cannot answer it: workerd does not enforce or report the
production CPU limit.

## 5. How the build reads D1

| Option | What | Approval |
| --- | --- | --- |
| A | D1 read-only API token in the build environment | Yes — token creation |
| B | `wrangler d1 export` before the build, then the CLI below on the snapshot | Yes — CI credential |
| C | Local SQLite fixture | No (tests only) |

The CLI only reads a local SQLite file (option B or C):

```bash
node --experimental-strip-types apps/site/scripts/readPublicData.ts \
  --sqlite <snapshot.sqlite> --out <events-index.json> [--generated-at <unix seconds>]
```

It opens the file read-only, runs a bounded number of statements (at most 19: count, list,
groups, group events, and public-staff chunks of 90 ids for ≤ 200 + ≤ 1,000 events), each capped
by `LIMIT` / window limits from the `MAX_` constants (which equal CURRENT's), fails when the public event count exceeds
`EVENTS_INDEX_MAX_ROWS` (CURRENT silently keeps the newest 200), and writes key-sorted JSON.
It never runs inside a Worker request. Choosing A or B, and creating the token or credential,
is pending user approval.
