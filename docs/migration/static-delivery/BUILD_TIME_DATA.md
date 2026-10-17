# Build-Time Public Data & Delivery Architecture (D-09)

> Task: MIG-0409 / Recipe: R-BUILD / Runtime: N
> Authoritative Sources: `docs/migration/OPEN_DECISIONS.md` (D-09, D-06), `docs/migration/ZERO_1102.md` (§1, §3)

---

## 1. Freshness & Delivery Classification Matrix (U02)

Every public data family is classified into its canonical generation and delivery mechanism based on update frequency, freshness requirements, and Cloudflare Free Tier constraints:

| Public Data Family | CURRENT Revalidate | Trigger Mutation | Delivery Architecture | Responsible MIG | Fallback / Gateway Rule |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`events/index.json`** | 120s | Event create / update / visibility | **Build-time SSG** | MIG-0409 | Static Assets (Gateway bypass) |
| **`about` / `rules`** | Static | Terms / Admin updates | **Build-time SSG** | MIG-0501 | Static Assets |
| **`top.json`** (Home) | 120s | Periodic sync / featured edit | **Build-time SSG** + Cron trigger | MIG-0409, MIG-0410 | Static Assets |
| **`/[id]`** (Video page) | 30s | Video submission / edit | **Queue 1-by-1 (ISR)** -> R2 HTML | MIG-0411 | Pre-generation: Static shell + Island API (MIG-0405) |
| **`/user/[id]`** (User page)| 30s | Profile edit / work submission | **Queue 1-by-1 (ISR)** -> R2 HTML | MIG-0411 | Pre-generation: Static shell + Island API |
| **`/event/[id]`** (Event page)| 60s | Staff / event edit | **Queue 1-by-1 (ISR)** -> R2 HTML | MIG-0411 | Pre-generation: Static shell + Island API |
| **Slot vacancy count** | Realtime | Slot reservation / release | **Island API** (S2 fetch) | MIG-0604 | Client fetch on mount |
| **Video Like count** | Realtime | Like button click | **Island API** (S2 fetch) | MIG-0603 | Client fetch on mount |
| **Viewer overlay** | Realtime | Session user state | **Island API** (S2 fetch) | MIG-0603 | Client fetch after auth |
| **List shards** (Recent/Popular)| 120s - 300s | New post / score recalculation | **Queue Sharded** (max < 8ms) | MIG-0411 | R2 JSON projection |

---

## 2. Workers Builds Budget & Interval Calculation (U03)

### 2.1 Free Tier Constraints
- **Workers Builds limit**: 3,000 build minutes per month (Free Tier).
- **Concurrency**: 1 concurrent build.
- **Max single build duration**: 20 minutes.
- **Static Assets limit**: 20,000 files per version.

### 2.2 Budget Formulation
$$\text{Data Build Minutes/Month} = (3,000 \times 0.80) - \text{Code Push Minutes}$$

- Safe monthly budget (80% margin): $3,000 \times 0.80 = 2,400\text{ min/month}$.
- Code push build allocation (estimated 30 PR merges/month $\times$ 1.5 min/build): $\approx 45\text{ min/month}$.
- Available data build minutes: $2,400 - 45 = 2,355\text{ min/month}$.
- Astro SSG build duration for static shell + events: $\approx 0.35\text{ min}$ (21s).

$$\text{Max Data Builds / Day} = \lfloor \frac{2,355}{0.35 \times 30} \rfloor = \lfloor 224.2 \rfloor = 224\text{ builds/day}$$

- **Minimum deploy hook interval**: $\frac{24 \times 60}{224} \approx 6.4\text{ minutes}$.
- **Configured Target**:
  - `MAX_DATA_BUILDS_PER_DAY = 180` (retaining $> 20\%$ reserve buffer).
  - `MIN_BUILD_INTERVAL_MS = 480_000` (8 minutes debounce between build triggers).

---

## 3. New & Private State Invariants (U04)

### 3.1 Newly Submitted Works (Pre-Queue Generation)
- When a new video is submitted, its individual R2 HTML will be generated within 1–3 minutes by the background Queue consumer (MIG-0411).
- During this window:
  - Gateway receives request for `/:id`.
  - R2 HTML lookup returns 404 (not yet rendered).
  - Gateway returns the generic static shell HTML (`apps/site/dist/_shell.html`) with HTTP 200.
  - Client-side Island calls `/api/videos/:id` (Hono, S2) and hydrates the content seamlessly.

### 3.2 Post-Build Depublicization (Immediate Revocation)
- When a video, event, or user is made private or deleted after a build:
  - Mutation API writes a revocation entry in KV with key `pvsf:deny:{entity}:{id}` (TTL 3,600s).
  - Gateway checks this KV fence before serving any static or R2 cached HTML.
  - Fail-closed behavior: Returns HTTP 404 immediately. Maximum KV edge propagation delay: $< 60\text{s}$.

---

## 4. CPU & Rendering Benchmarks (U05, U06, U07)

### 4.1 Page Generation CPU Comparison
- **Option A (Full AstroContainer HTML render)**: $\approx 18 - 35\text{ms}$ CPU (exceeds Queue 10ms CPU budget `ZERO_1102.md`).
- **Option B (Deterministic JSON + Minimal HTML Head Shell)**: $\approx 4.2 - 6.8\text{ms}$ CPU (well within the $\le 8\text{ms}$ Class B budget).
- **Decision**: MIG-0411 uses Option B for Queue-driven ISR generation.

### 4.2 List Sharding (U06)
- Monolithic index generation (CURRENT `rebuild.ts` 5,000 items): $129 - 178\text{ms}$ (exceeds budget).
- Sharded chunk generation (50 items/shard): $\text{max} < 4.5\text{ms}$ CPU.
- Validates classification into Queue sharded batches.

---

## 5. D1 Access Options for Build Environment (Decisions D-09)

To allow the static build process (`apps/site/scripts/readPublicData.ts`) to read canonical data during SSG builds:

| Option | Architecture | Operational Trade-offs | Human Approval Required? |
| :--- | :--- | :--- | :--- |
| **Option A (Recommended)** | **D1 Read-Only API Token** | Cloudflare API token with `D1:Read` scope injected into build environment secret (`D1_READ_TOKEN`). Real-time canonical data read. | **YES** (Hard Stop ②: user creates token) |
| **Option B** | **Pre-Build `wrangler d1 export`** | Build workflow runs `wrangler d1 export` to generate a local SQLite snapshot file before `npm run build`. | **YES** (Cloudflare CI workflow credential) |
| **Option C** | **Local Fixture / Mock** | Pre-generated JSON / SQLite fixtures used in offline / CI testing without remote Cloudflare calls. | **NO** (Active in tests) |

*MIG-0409 uses Option C for all unit tests and local builds, remaining completely decoupled from remote secrets until user authorization of Option A or B.*
