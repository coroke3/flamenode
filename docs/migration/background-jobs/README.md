# FlameNode Queue / Cron / Background Jobs CURRENT Baseline

> Status: CURRENT_VERIFIED
> Verified: 2026-10-07
> Scope: Cloudflare Queues, Cron triggers, D1 work-state machines, retry/DLQ/recovery/idempotency, external side effects, user-visible async states
> Platform topology: [`../cloudflare/TOPOLOGY.md`](../cloudflare/TOPOLOGY.md)
> CPU baseline: [`../cloudflare/PERFORMANCE_BASELINE.md`](../cloudflare/PERFORMANCE_BASELINE.md)
> Static delivery: [`../static-delivery/README.md`](../static-delivery/README.md)
> Production mutation: none

MIG-0009でCURRENT background execution contractをcode/testsとread-only Cloudflare実環境から固定する。

最重要原則:

> **D1 が業務処理の正本。Cloudflare Queue messageは業務データを運ばず、D1に既に保存された pending/due workを起こす doorbell だけを運ぶ。**

Queue messageの消失・重複・DLQ化だけで、canonical business stateを失ってはならない。

## Execution layers

CURRENT background executionは次の3層を分けて扱う。

1. **Cloudflare Queue delivery layer**
   - wake messageのdeliver/retry/DLQ。
   - message自体にvideo/event/notification payloadを載せない。
2. **D1 application work-state layer**
   - notification outbox、static rebuild queue、YouTube metadata/playlist due stateが正本。
   - lease token、attempt count、next retry、statusを持つ。
3. **Recovery Cron layer**
   - Queue wake失敗・consumer停止・lease切れ・continuation失敗をD1から再発見し、再wakeまたはbounded fallback drainする。

Cloudflare DLQとD1の `dead_letter` / `failed` / `deferred` は別物である。

## CURRENT Cloudflare Queue topology

Read-only Cloudflare APIで2026-10-07に再確認。

| Wake Queue | Producers | Consumer | Cloudflare retry | Platform DLQ |
| --- | --- | --- | --- | --- |
| `flamenode-notification-wake` | web, fast, sync | fast | batch 10, max retries 3, retry delay 60s, max concurrency 1 | `flamenode-notification-dlq` |
| `flamenode-static-rebuild-wake` | web, content, sync | content | batch 10, max retries 3, retry delay 60s, max concurrency 1 | `flamenode-static-rebuild-dlq` |
| `flamenode-youtube-sync-wake` | web, sync | sync | batch 10, max retries 3, retry delay 300s, max concurrency 1 | `flamenode-youtube-sync-dlq` |

All six queues currently use 86400 second message retention.

DLQ queues have no Worker consumer. This is acceptable only because canonical D1 work state survives Queue failure and Recovery Cron rediscovers it. A later migration must not turn wake messages into the sole copy of work.

## Wake message protocol

CURRENT version: `QUEUE_WAKE_MESSAGE_VERSION = 1`.

Kinds:

- `notification_available`
- `static_rebuild_available`
- `youtube_sync_pending`
- `youtube_playlist_sync`

Allowed sources:

- `web`
- `admin`
- `manage`
- `sync`
- `import`
- `recovery`
- `continuation`

Message fields are exactly:

- `version`
- `kind`
- `source`
- `requested_at`
- `trace_id`

Unknown/business fields cause parse rejection. The internal target is < 1024 bytes/message.

A wake is sent **after canonical D1 commit**. Send failure is best-effort and does not roll back a successful business mutation.

Per invocation, `sentKinds` coalesces duplicate wake kinds. Queue continuation is bounded to at most one wake per invocation.

## Queue feature gates

Environment-only flags:

- `QUEUE_DISPATCH_ENABLED`
- `QUEUE_CONTINUATION_ENABLED`
- `QUEUE_YOUTUBE_SYNC_ENABLED`

They do not require a D1 read.

Behavior:

- dispatch disabled -> no wake; Cron fallback remains;
- continuation disabled -> current unit may finish but no self-continuation;
- YouTube Queue disabled -> metadata/playlist queue wake disabled; scheduled Cron remains authoritative fallback.

Binding missing or send failure is recorded as a best-effort last-failure record in KV and does not make the already-committed D1 mutation fail.

## Queue consumer ACK/retry contract

Invalid wake messages are ACKed/discarded.

Duplicate wakes in one batch are coalesced into one bounded D1 drain.

Consumer-level `message.retry()` is reserved for invocation/infrastructure failures where the D1 unit could not be safely classified as complete/deferred.

If application state already records the result, the wake is ACKed even when the business result is failed/deferred.

Examples:

- notification D1/dispatcher throw -> Queue batch retry;
- static rebuild consumer throw -> Queue batch retry;
- YouTube playlist function returns persisted event failure/deferred -> ACK;
- YouTube playlist function itself throws before a persisted result -> retry;
- metadata commit succeeds but post-commit score/rebuild work fails -> metadata wake is not replayed as though metadata had not committed.

This prevents external side effects from being repeated merely because post-commit work failed.

## CURRENT Cron topology

Read-only Cloudflare schedules reverified 2026-10-07.

| Worker | Cron | Primary role |
| --- | --- | --- |
| `flamenode-fast-jobs` | `0 * * * *` | notification lease recovery, slot deadline reminders, Queue wake/fallback drain |
| `flamenode-content-jobs` | `15 * * * *` | static-rebuild recovery/repair, cleanup, shared artifact repair, recovery fanout |
| `flamenode-sync-jobs` | `7 * * * *` | GA4 trending + scheduled YouTube metadata + score/ranking + daily related repair + pending recovery |
| `flamenode-sync-jobs` | `52 * * * *` | event YouTube playlist sync recovery |

Queue paths do not use the outer Cron lease. Their D1 pending/due/lease state is sufficient to arbitrate work.

## Cron lease contract

`worker_leases` in D1 is the canonical Cron lease store. KV is not used as a compare-and-set lease.

A lease stores:

- job name;
- lease token;
- lease expiry;
- last started/succeeded/failed state.

Important invariants:

- active lease prevents overlapping Cron execution;
- lease duration is bounded;
- heartbeat loss aborts the run;
- success marking is token/CAS protected;
- a lost lease cannot be recorded as success;
- release failure after successful work does not intentionally replay completed work; expiry recovers the lease;
- wall-clock deadline and lease-loss failures propagate through the shared job boundary.

## fast-jobs: notification / reminder pipeline

### Sources of work

Notification business state lives in `notification_outbox`.

CURRENT states:

- `pending`
- `processing`
- `sent`
- `failed`
- `cancelled`
- `dead_letter`

Queue kind: `notification_available`.

The Queue wake contains no recipient/message body.

### Recovery Cron

Hourly `:00`:

1. recover expired notification leases;
2. convert “Discord delivery succeeded but sent mark failed” marker rows to `sent` without redelivery;
3. requeue retryable expired rows or dead-letter exhausted rows;
4. enqueue due slot deadline reminders under a separate minimum-interval lease;
5. if due pending work exists, send one Queue wake;
6. only if Queue dispatch is disabled/binding missing/send failed, perform a bounded direct drain.

This fallback preserves availability without making Cron and Queue normally execute the same heavy work.

### Delivery retry

Application retry budget: **4 attempts**.

Default delays:

- 1st failure -> 60s
- 2nd -> 300s
- 3rd -> 900s
- exhausted/permanent -> D1 `dead_letter`

Discord 429 honors bounded Retry-After and does **not** inline retry.

Permanent route/auth transport errors may enter D1 `dead_letter` before four attempts.

Orphan DM recipients are dead-lettered without sending.

### No duplicate external delivery

Processing claim has a 5 minute lease/token.

Before Discord side effect, dispatcher rechecks the active claim. A cancelled/stolen claim cannot send.

After Discord success:

- mark `sent` is retried;
- if the sent-mark cannot be committed, the row is marked `delivery_succeeded_awaiting_sent_mark`;
- lease recovery advances that row to `sent` instead of redelivering Discord.

This marker is a core exactly-once-like safety mechanism for the external side effect.

### Notification enqueue/dedupe

Notifications can be written atomically with the originating D1 mutation.

Active dedupe uniqueness covers `pending|processing|sent`.

Some transitions intentionally scope dedupe keys per transition so “remove then regrant” remains a new notification event.

### User-visible state

Admin:

- `/admin/notifications`: pending / processing / sent / failed + dead_letter terminal failures;
- shows retry timing, last error, stuck lease warning, bulk/single retry and cancel constraints;
- description explicitly exposes Queue wake + hourly Recovery and 1/5/15 minute retry behavior.

Manage:

- `/manage/notifications`: event-scoped recent notification state;
- terminal failure is visible, but recovery operation remains site-admin responsibility.

## content-jobs: static publication pipeline

### Canonical work state

`static_rebuild_queue` is D1 canonical work state.

Schema states:

- `pending`
- `processing`
- `done`
- `failed`
- `dead_letter`

The CURRENT processor uses `failed` as its application terminal retry-exhausted state; schema/admin still understand `dead_letter`. Do not silently remove `dead_letter` until migration consolidation proves no producer/history path needs it.

Queue kind: `static_rebuild_available`.

### Work coalescing

Active target uniqueness is `target_type + target_id` for `pending|processing`.

New invalidation for an already-active target:

- merges reason/priority;
- updates `updated_at`;
- if it arrives while processing, successful completion detects the newer dirty generation and returns the same row to `pending` instead of incorrectly finalizing it.

Large mutation fanout is bulk-upserted to preserve all dependent targets without one D1 query per target.

### Consumer bound

The Queue consumer handles **one static target per invocation**.

If work remains, it sends one continuation wake.

When D1 rows-read soft budget is high, continuation may be delayed for backpressure.

The normal consumer intentionally does not run stale-lease reconcile on every wake.

### Application retry

Processing lease: 5 minutes.

Application retry budget: **4 attempts**.

Retry delays:

- 60s
- 300s
- 900s
- then `failed`

Lease token CAS prevents an older worker from completing a newer claim.

If rebuild output succeeded but D1 `done` marking fails, `rebuild_succeeded_awaiting_done_mark` prevents regeneration; Recovery Cron finalizes the row as `done`.

### Recovery Cron

Hourly `:15` owns stale-processing reconciliation.

It also performs bounded repair/orchestration including:

- deploy-generator global rebuild enqueue when generator source hash changed;
- missing YouTube related shared inputs;
- missing users shared inputs;
- missing top slot stats/sections;
- X ID approved-slot bind recovery;
- event playlist projection backfill;
- daily nostalgic shuffle enqueue;
- static Queue wake;
- bounded direct static drain (max 3 targets) only when Queue delegation is unavailable;
- daily cleanup under its own lease;
- incremental-cache cleanup.

Heavy rebuild remains separated into Queue invocation when Queue is functioning.

### User-visible state

`/admin/static-builds` exposes:

- pending;
- processing;
- failed;
- dead_letter;
- done;
- last error;
- backfill running/completed/failed;
- manual enqueue/retry;
- Queue/Cron operational explanation.

Mutations that enqueue public rebuilds may return `pendingPublicReflection: true` and the user-visible message:

> 公開ページへの反映は、静的データの再生成が完了するまでしばらく時間がかかることがあります。

The target migration must preserve this asynchronous semantic even if implementation technology changes.

## sync-jobs: YouTube metadata

### Canonical work state

`video_youtube_metadata.sync_status`:

- `pending`
- `synced`
- `failed`

Queue kind: `youtube_sync_pending`.

Queue messages contain no video ID.

Pending selection is read from D1.

### Queue bounds

Pending Queue drain:

- max 50 videos;
- one YouTube API batch/invocation for pending lane;
- API request timeout 8s;
- max 2 inline attempts;
- Retry-After/exponential delay capped at 15s;
- external request budget is explicit.

If pending remains and quota is healthy, one continuation wake is sent.

### Quota behavior

YouTube quota/cooldown is not treated as an infrastructure Queue failure.

Examples:

- quota cooldown active;
- quota reservation denied;
- API quota reason.

These set `quota_stopped` / reason and defer future work. They do not cause immediate Queue redelivery storms.

Transient failed metadata rows are eligible for later scheduled retry; permanent-prefixed failure is excluded from ordinary retry lanes.

### Post-commit work

After metadata D1 commit:

- affected score recalculation runs;
- score-dependent static targets may be enqueued;
- related eligibility change enqueues related projection rebuilds.

Post-commit failure does not roll back already-committed metadata and does not turn the metadata wake into a duplicate external fetch.

### Cron recovery

At `:07`:

- GA4 trending sync runs independently;
- scheduled metadata lane runs;
- Queue pending may be included directly when YouTube Queue is disabled;
- score/ranking post-commit work runs;
- once daily at 03:07 UTC, blocked/private/missing YouTube eligibility is rechecked and related projections reconciled;
- when Queue is enabled and soft D1 budget permits, remaining pending state may be re-woken.

GA4 failure is intentionally isolated from YouTube metadata failure.

## sync-jobs: event YouTube playlists

### Canonical state

`event_youtube_playlist_sync.sync_status`:

- `disabled`
- `idle`
- `scanning`
- `synced`
- `deferred`
- `failed`

Run history state:

- `running`
- `succeeded`
- `failed`
- `deferred`
- `skipped`

Queue kind: `youtube_playlist_sync`.

The Queue message carries no event/playlist data; D1 due state determines the event.

### Scheduling/recovery

- config/manual mutation commits `next_sync_at`/pending state first;
- best-effort Queue wake follows commit;
- one Queue invocation processes at most one due event;
- if more due rows remain, one continuation wake is sent;
- `:52` Cron is the recovery/backstop.

### Queue ACK semantics

If playlist worker returns a persisted business result, the wake is ACKed.

This includes event-specific failure/deferred state whose `next_sync_at` was already updated.

Only a thrown D1/Worker/infrastructure failure causes Queue retry.

Quota stop is normalized from failure to deferred/skipped so it does not trigger immediate Queue or Cron failure.

### Mixed YouTube Queue batches

Metadata and playlist share one physical wake Queue.

If both kinds arrive in the same batch:

- playlist work runs;
- metadata wake messages are ACKed/coalesced;
- if D1 still has metadata pending, one metadata continuation doorbell is sent.

The two heavy external-API job types are not executed in one invocation.

### User-visible state

Admin/manage playlist health shares reason codes including:

- disabled;
- failed;
- deferred;
- scanning;
- overdue;
- missing_schedule;
- never_synced;
- never_full_scan;
- out_of_sync;
- last_error;
- healthy;
- unknown_status.

Due immediately after schedule is not treated as unhealthy because `:52` Recovery exists. Overdue grace is two hours.

## Other content/sync jobs

### GA4 trending

Runs in sync `:07` slot before YouTube metadata.

Its failure is isolated and does not prevent YouTube metadata job.

It writes bounded trending output to R2. Exact ranking product semantics remain `FN-PLAT-009` audit scope.

### Score/recommend rebuild fanout

YouTube metadata changes trigger bounded score recalculation and selected ranking/static rebuild targets.

Duplicate downstream rebuild requests coalesce through the D1 static rebuild queue.

### Cleanup

content-jobs owns bounded daily cleanup:

- audit/history retention cleanup;
- stale/generated data cleanup according to current cleanup contract;
- R2 incremental-cache cleanup using bounded scan/checkpoint.

Cleanup failure is isolated from user-visible static repair where explicitly designed.

### X ID slot bind recovery

content-jobs repairs pending approved X-ID slot bindings with bounded row limits and enqueues dependent static rebuild where needed.

This is recovery of canonical D1 state, not a Queue payload workflow.

## D1 budget and wall-clock safety

Cron and Queue consumers use shared D1 budget wrappers.

Design assumptions include:

- D1 query hard budget applies to the whole invocation;
- soft limits reserve headroom for lease/recovery/finalization;
- content and sync jobs stop/defer rather than continue unbounded;
- Queue execution creates another invocation but does not imply unlimited CPU;
- wall-clock abort signals propagate into external fetches and loops.

Background work may have a larger CPU envelope than thin HTTP requests, but it remains bounded.

## Platform DLQ vs application terminal state

These must remain visibly distinct.

### Cloudflare platform DLQ

A wake message reaches platform DLQ after Cloudflare consumer retries.

Because wake messages contain no work payload:

- DLQ does not become the canonical recovery source;
- D1 pending/due state remains intact;
- Recovery Cron can issue a fresh wake.

### Application terminal states

Examples:

- notification `dead_letter`;
- static rebuild `failed`;
- YouTube metadata `failed`;
- playlist `failed` or quota-driven `deferred`.

These represent business processing state and require their own admin visibility/retry policy.

A future system must not “replay DLQ” as a substitute for checking canonical D1 state.

## Monitoring / operator-visible contract

`/admin/workers` reads D1/KV operational truth and exposes:

- Cron last started/succeeded/failed and lease state;
- notification pending/processing/failed/dead_letter/stuck;
- static rebuild pending/processing/failed/dead_letter/stuck;
- YouTube pending/failed/staleness;
- estimated drain/backlog;
- Queue wake last-failure records from KV.

Queue wake KV failure records are diagnostics only. D1 remains work truth.

The CURRENT admin UI does not use Cloudflare DLQ messages as the primary business recovery queue.

## Side-effect ordering

### Required atomic / pre-commit

When a side effect is represented by a D1 outbox/queue row required for correctness, the row is inserted in the same canonical mutation batch where the domain operation requires atomicity.

### Post-commit best effort

Examples:

- sending Queue doorbell;
- revalidation/UI refresh;
- score/static follow-up where source mutation is already durable.

A post-commit failure must not falsify or roll back the canonical committed business state.

### External side effects

Discord and Google/YouTube requests require lease/claim or canonical due-state validation before execution.

Completion markers are designed to prevent duplicate external execution after a successful side effect followed by D1 finalization failure.

## Idempotency / redelivery invariants

1. Queue message has no unique business payload; duplicate wake is safe.
2. Duplicate wakes in one consumer batch collapse to one drain.
3. D1 lease token/CAS owns processing.
4. Old lease token cannot finalize newer work.
5. static active target unique index coalesces fanout.
6. notification active dedupe index suppresses duplicate logical notifications.
7. successful external/rebuild side effect followed by mark failure uses a sentinel so recovery finalizes instead of repeating it.
8. YouTube playlist due state and run lease are D1 canonical.
9. continuation failure never erases already-persisted pending/due work.
10. Recovery Cron is the final ordinary recovery path when Queue dispatch/continuation is unavailable.

## Current gaps / migration cautions

### 1. Platform DLQ has no direct consumer

All three Cloudflare DLQs currently have no consumer. This is safe only because they contain doorbells and D1 remains canonical. Migration must preserve that premise or introduce an explicit DLQ recovery consumer before carrying business payloads.

### 2. static rebuild schema exposes `dead_letter`, processor terminates at `failed`

Admin/monitoring supports both. The CURRENT processor retry exhaustion writes `failed`. Treat `dead_letter` as compatibility/history/possible external state until MIG-0011 can prove it is removable; do not silently delete it.

### 3. Wake failure telemetry is last-failure, not an event log

KV stores bounded last-failure diagnostics. It must not be promoted to audit/canonical queue history.

### 4. Three retry layers can look similar

Cloudflare Queue retry, D1 application retry, and Recovery Cron have different purposes and counters. Future UI/metrics should keep them separate.

## UX / FN mapping

Primary observable async behavior:

- public reflection delay: `UX-PUB-007` plus affected mutation success messages;
- manage notification failure/retry visibility: `UX-MNG-035,UX-MNG-054..057`;
- manage playlist state/retry/quota: `UX-MNG-051..053`;
- admin worker/job health: `UX-ADM-047..048`;
- admin notification state/retry: `UX-ADM-057..060`;
- admin static build/rebuild state: `UX-ADM-073..075`;
- admin YouTube sync/quota/playlist state: `UX-ADM-100..107`.

CURRENT_VERIFIED function contracts in this task:

- `FN-JOB-001` fast jobs
- `FN-JOB-002` content/static generation
- `FN-JOB-003` sync jobs
- `FN-JOB-004` Queue wake/DLQ/recovery
- `FN-JOB-005` YouTube metadata/playlist sync
- `FN-JOB-006` notifications/Discord
- `FN-JOB-007` cleanup jobs
- `FN-JOB-008` static rebuild follow-up fanout
- `FN-X-006` Queue retry/idempotency
- `FN-PLAT-010` content build/rebuild admin visibility

Exact GA4/trending ranking semantics (`FN-PLAT-009`) and full manage/admin screen lifecycles remain later detailed-audit scope.

## Optimization disposition

### Strengthen/reuse

- one versioned business-data-free doorbell protocol;
- one shared Queue consumer shell: validate/coalesce -> bounded D1 drain -> continuation -> ACK/retry;
- one shared Cron job envelope: D1 lease + heartbeat + wall-clock signal + normalized safe metrics;
- shared application lease/finalization helpers for “side effect succeeded, final D1 mark failed” patterns where semantics truly match;
- explicit typed job result: processed/skipped/failed/hasMore/quotaStopped;
- one monitoring model that distinguishes platform delivery failure from application work failure.

### Keep domain-specific

- notification external-delivery suppression marker and Discord retry/cooldown;
- static dirty-generation/requeue semantics;
- YouTube quota reservation/cooldown;
- playlist scan cursor/remote mutation semantics;
- static visibility release prerequisites;
- cleanup retention policies.

### Reject

- putting business payloads in wake messages merely to reduce D1 reads;
- relying on Cloudflare DLQ as canonical work storage;
- retrying post-commit work by replaying the original business mutation;
- treating Queue consumer as unlimited CPU;
- merging all retries into one generic counter/status.

Optimization blockers requiring frontend change: **0**

The target architecture may replace Queue/Cron implementation details, but async product states and recovery semantics must remain observable/equivalent.

## Representative evidence

Code:

- `src/lib/queues/wakeBudget.ts`
- `src/lib/queues/wakeMessage.ts`
- `src/lib/queues/sendQueueWakeBestEffort.ts`
- `workers/shared/queueWake.ts`
- `workers/shared/cronLease.ts`
- `workers/shared/runJob.ts`
- `workers/fast-jobs/index.ts`
- `workers/fast-jobs/notificationQueueConsumer.ts`
- `workers/notification-dispatcher/dispatch.ts`
- `workers/content-jobs/index.ts`
- `workers/content-jobs/staticRebuildWakeQueue.ts`
- `workers/json-generator/queue.ts`
- `workers/sync-jobs/index.ts`
- `workers/youtube-sync/index.ts`
- `workers/youtube-playlist-sync/index.ts`
- `src/lib/admin/workerMonitoring.ts`
- admin/manage async-state pages/actions

Representative tests:

- `workers/fast-jobs/notificationQueueConsumer.test.mjs`
- `workers/content-jobs/staticRebuildWakeQueue.test.mjs`
- `workers/content-jobs/staticRebuildWakeQueue.contract.test.mjs`
- `workers/sync-jobs/youtubeSyncQueue.test.mjs`
- `workers/sync-jobs/youtubeQueueIsolation.contract.test.mjs`
- `workers/shared/queueWake.test.mjs`
- `workers/shared/cronLease.test.mjs`
- `workers/notification-dispatcher/dispatch.test.mjs`
- `workers/json-generator/queue.test.mjs`
- `workers/youtube-playlist-sync/index.test.mjs`
- `workers/sync-jobs/index.test.mjs`
- `src/lib/admin/workerMonitoring.contract.test.mjs`

Cloudflare evidence:

- 6 queues;
- 3 wake Queue consumers;
- 3 DLQs;
- fast/content retry delay 60s;
- YouTube retry delay 300s;
- max Queue retries 3;
- max consumer concurrency 1;
- Cron schedules `:00`, `:15`, `:07`, `:52`.

MIG-0009 changes documentation/checker evidence only. Production Worker, Queue, D1, R2, KV, Discord/YouTube/GA4 and routing configuration are unchanged.
