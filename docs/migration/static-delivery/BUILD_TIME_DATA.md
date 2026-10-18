# Build-Time Public Data & Delivery (D-09)

> Status: Draft (MIG-0409, PR #323). Not approved; nothing here is deployed.
> Last verified: 2026-10-18
> Source of truth: `docs/migration/OPEN_DECISIONS.md` (D-06, D-09), `docs/migration/ZERO_1102.md` (§1, §3, §5), `docs/migration/PHASE_4_5_SPEC.md` §MIG-0409

Every number below is either measured (with the command that produced it) or marked
**NOT MEASURED**. A 2026-10-18 review removed earlier figures (build 0.35 min, page render
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

## 2. Build budget (U03) — NOT MEASURED

Formula (Work Order): `data builds/day = floor((3,000 × 0.8 − code-push build minutes/month) ÷ minutes per build ÷ 30)`.

- Minutes per build: **NOT MEASURED.** U03 requires 5 builds of `apps/site` with the synthetic
  data set (3,000 works, 20 events, 120 slots each). `apps/site` does not consume that data
  yet, so a local `astro build` time would not represent the target build.
- Code-push builds: `git log --since=2026-09-18 origin/main` shows 53 commits on `main` in the
  30 days before 2026-10-18 (each push to `main` is one Workers Build). Minutes per push are
  not measured.
- Consequence: the MIG-0410 constants (`MIN_BUILD_INTERVAL_MS = 480_000`,
  `MAX_DATA_BUILDS_PER_DAY = 180`) are **provisional placeholders, not derived values**. The
  Work Order STOP applies: the "maximum publish delay" must be shown to the user and
  approved before those constants are fixed.
- The MIG-0410 check runs inside the hourly `flamenode-fast-jobs` Cron (`0 * * * *`), so in
  practice at most 24 deploy hooks/day are sent and the delay from a change to the start of a
  build is up to ~60 min plus the build time, regardless of `MIN_BUILD_INTERVAL_MS`.

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

| Unit | Status |
| --- | --- |
| U05 (a) full `renderToString` page per kind | **NOT MEASURED** — no Astro page components exist yet (Phase 5). |
| U05 (b) data JSON + minimal head shell per kind | Local Node only, see MIG-0411 (`apps/site/src/gateway/pageRenderQueue.test.mjs`); not a production or workerd CPU figure. |
| U06 list / search shard rebuild | **NOT MEASURED.** |
| U07 Queue consumer CPU limit (20 ms / 100 ms / 1 s × 50 messages) | **NOT RUN** — needs a non-production Worker and Queue (account change, requires approval). |

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
