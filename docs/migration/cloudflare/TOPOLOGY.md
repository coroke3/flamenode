# FlameNode Cloudflare CURRENT Topology

> Status: CURRENT_VERIFIED
> Verified: 2026-10-07
> Scope: FlameNode production Worker / ingress / binding / resource / build-deploy topology
> Evidence: tracked Wrangler/deploy configuration + read-only Cloudflare API inspection

この文書はMIG-0005で固定したCloudflare実環境のCURRENT正本。Cloudflare account内のFlameNode以外のWorker/DB/R2は対象外とする。

## Safety boundary

- このbaselineでCloudflare resourceの作成・更新・削除は行っていない。
- Worker Route / Custom Domain / Remote D1 / R2 / KV / Queue / secret / deploymentへのproduction mutationは0。
- secretは名前とbinding存在だけを確認し、値は記録しない。
- volatileなdeployment/version/resource IDはこの文書の契約にしない。

## Project boundary

CURRENT Worker scripts: 4

| Worker | Primary role | Runtime handlers | CURRENT deployment source |
| --- | --- | --- | --- |
| `flamenode-web` | Next.js + OpenNext public/private web and API | `fetch` | Wrangler, orchestrated by Workers Builds |
| `flamenode-fast-jobs` | notification/recovery fast jobs | `fetch`, `scheduled`, `queue` | Wrangler from the web build pipeline |
| `flamenode-content-jobs` | static/public artifact rebuild jobs | `fetch`, `scheduled`, `queue` | Wrangler from the web build pipeline |
| `flamenode-sync-jobs` | YouTube/GA4/external synchronization jobs | `fetch`, `scheduled`, `queue` | Wrangler from the web build pipeline |

All four use compatibility date `2026-07-21`. Background Workers use `nodejs_compat`; web additionally uses `global_fetch_strictly_public`. Observability is enabled on all four. Web uses Smart Placement and Workers Static Assets.

## Ingress and routing

Custom Domains: 2

| Hostname | Worker | Environment | State |
| --- | --- | --- | --- |
| `flamenode.net` | `flamenode-web` | production | enabled |
| `www.flamenode.net` | `flamenode-web` | production | enabled |

Worker Routes: 0

- The `flamenode.net` zone has no zone Worker Routes.
- Production ingress therefore uses Workers Custom Domains, where `flamenode-web` is the origin.
- `workers.dev` remains enabled for all four project Workers and previews are enabled. It is an auxiliary/bootstrap surface, not the canonical public origin.
- The canonical production web origin is `https://flamenode.net`.

Cloudflare distinguishes Custom Domains from Worker Routes: a Custom Domain makes the Worker the origin for the hostname, while a Worker Route executes in front of another origin. Migration must preserve the current Custom Domain model unless an explicitly approved topology change replaces it.

## Resource topology

### Shared storage

| Capability | CURRENT resource | Consumers |
| --- | --- | --- |
| D1 | `flamenode_db` | all four Workers |
| R2 | `flamenode-storage` | web (`BUCKET`, `NEXT_INC_CACHE_R2_BUCKET`), content (`R2`), sync (`R2`) |
| KV | one production FlameNode namespace | all four Workers |
| Static assets | `ASSETS` | web only |
| Worker service binding | `WORKER_SELF_REFERENCE -> flamenode-web` | web only |

Resource IDs were verified against deployed bindings but are intentionally not duplicated here. Tracked Wrangler templates use placeholder D1/KV IDs and the verified production deploy path injects real IDs.

### Queue graph

CURRENT Queues: 6

| Queue | Producers | Consumer | Retry / DLQ |
| --- | --- | --- | --- |
| `flamenode-notification-wake` | web, fast, sync | fast | batch 10; retry 3; delay 60s; concurrency 1 -> `flamenode-notification-dlq` |
| `flamenode-notification-dlq` | queue DLQ target | none | retained for recovery/inspection |
| `flamenode-static-rebuild-wake` | web, content, sync | content | batch 10; retry 3; delay 60s; concurrency 1 -> `flamenode-static-rebuild-dlq` |
| `flamenode-static-rebuild-dlq` | queue DLQ target | none | retained for recovery/inspection |
| `flamenode-youtube-sync-wake` | web, sync | sync | batch 10; retry 3; delay 300s; concurrency 1 -> `flamenode-youtube-sync-dlq` |
| `flamenode-youtube-sync-dlq` | queue DLQ target | none | retained for recovery/inspection |

Detailed job semantics, idempotency, recovery side effects and user-visible async states belong to MIG-0009. This section fixes only the platform topology needed to audit them.

## Cron topology

| Worker | CURRENT Cron triggers |
| --- | --- |
| `flamenode-web` | none |
| `flamenode-fast-jobs` | `0 * * * *` |
| `flamenode-content-jobs` | `15 * * * *` |
| `flamenode-sync-jobs` | `7 * * * *`, `52 * * * *` |

The deployed schedules match the tracked Worker configs. Semantic ownership of each scheduled job is deferred to MIG-0009.

## Binding matrix

| Binding/capability | web | fast | content | sync |
| --- | :---: | :---: | :---: | :---: |
| D1 `DB` | yes | yes | yes | yes |
| KV `KV` | yes | yes | yes | yes |
| R2 application bucket | `BUCKET` | — | `R2` | `R2` |
| R2 OpenNext incremental cache | `NEXT_INC_CACHE_R2_BUCKET` | — | — | — |
| Static assets `ASSETS` | yes | — | — | — |
| Self service `WORKER_SELF_REFERENCE` | yes | — | — | — |
| Notification wake Queue | producer | producer + consumer | — | producer |
| Static rebuild wake Queue | producer | — | producer + consumer | producer |
| YouTube sync wake Queue | producer | — | — | producer + consumer |

Secrets remain capability-specific. Web carries auth/import/admin secrets; fast carries Discord delivery secrets; content carries the admin token needed by its operational surface; sync carries YouTube and GA4 credentials. Do not flatten these into an all-Workers secret/binding set.

## Workers Builds and deployment topology

Workers Builds triggers: 1

Independent job-worker build triggers: 0

```text
GitHub coroke3/flamenode : main
        | push
        v
Workers Builds attached to flamenode-web
        |
        | build: npm ci --no-audit --no-fund && npm run cf:cloud-build
        | deploy: npm run cf:deploy-production && npm run cf:smoke-production
        v
flamenode-web
        -> flamenode-fast-jobs
        -> flamenode-content-jobs
        -> flamenode-sync-jobs
        -> production smoke
```

The latest inspected Workers Build succeeded from the MIG-0004 main commit, and all four deployed Workers exposed the same `BUILD_COMMIT_SHA`. This commit-convergence invariant is intentional: one Git-triggered build owns the four-Worker production rollout instead of four independent Git pipelines.

## Repo <-> deployed reconciliation

| Surface | Tracked/configured | Deployed CURRENT | Disposition |
| --- | --- | --- | --- |
| Worker set | four named deploy targets | same four project Workers | aligned |
| compatibility | `2026-07-21` + expected flags | same | aligned |
| Custom Domain | production script canonical origin `flamenode.net` | root + `www` Custom Domains on web | aligned |
| zone Worker Routes | no required route config | 0 routes | intentional |
| `workers.dev` | `workers_dev = true` on web; job endpoints used by smoke/bootstrap | enabled on all four | intentional auxiliary surface |
| D1/R2/KV | placeholder IDs in tracked templates; production IDs injected | bindings point to verified FlameNode resources | expected production injection |
| Queue feature flags | tracked templates default `0` | production bindings are `1` | expected Workers Builds variable override |
| GA4 sync flag | tracked sync template defaults `0` | production is `1` | expected Workers Builds variable override |
| web origin variables in Build metadata | bootstrap `workers.dev` values may remain stored in Build variables | deployed `AUTH_URL` / site URL are `https://flamenode.net` | expected deploy-time rewrite |
| Cron schedules | 1 fast + 1 content + 2 sync | exact match | aligned |
| build ownership | deploy scripts define four ordered targets | only web has Git build trigger; job Workers have none | aligned |

These expected transformations must stay explicit. Future migration code should not treat them as accidental configuration drift.

## Migration invariants

1. Preserve the four logical runtime roles until a later MIG task proves a consolidation is safe.
2. Preserve canonical Custom Domain ingress and the exact public hostname behavior unless a topology change is explicitly approved.
3. Keep capability-specific bindings/secrets minimal; do not bind every resource to every Worker for convenience.
4. Keep public static assets able to bypass web Worker execution where CURRENT behavior depends on Workers Static Assets.
5. Keep a single production build owner or provide equivalent commit-convergence/rollback guarantees before changing it.
6. Queue producer/consumer/DLQ relationships are functional contracts, not deployment trivia.
7. D1/R2/KV IDs are environment data. Migration docs should name logical resources; deployment verification owns concrete IDs.
8. Build-variable overrides and deploy-time origin rewriting must be typed/validated rather than silently inferred.

## Optimization review

- Duplicated/current complexity observed: tracked templates intentionally contain safe defaults/placeholders while production generation injects IDs, flags and canonical origins. This creates two representations but is a safety boundary, not removable duplication by itself.
- Candidate commonization: retain one typed production topology/deploy manifest that validates the four Worker targets and binding capabilities before generating deployment configs.
- Commonization intentionally rejected: one universal Worker config/binding set. Web, fast, content and sync have materially different ingress, secrets, queue consumers and storage capabilities.
- HTTP CPU impact: no runtime change in MIG-0005. Custom Domain versus Route choice does not justify a behavior change here.
- DB rows/read-write impact: none.
- Queue/R2/KV impact: none; topology only documented.
- Frontend UX impact: none.
- Recommendation: preserve the single-build/four-deploy model and capability-specific binding matrix during migration; revisit Worker consolidation only after MIG-0006 CPU evidence and MIG-0009 job semantics.

Optimization blockers requiring frontend change: 0

## Follow-up

- MIG-0006 may now use this topology as the boundary for Cloudflare CPU/1102/request metrics.
- MIG-0009 may now use the Queue/Cron graph as the platform baseline for background-job semantic inventory.
- Any production topology mutation remains a separate explicitly approved operation.
