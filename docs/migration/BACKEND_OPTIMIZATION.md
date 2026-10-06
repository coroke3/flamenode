# FlameNode Backend Optimization Ledger

> Status: Active / Migration optimization source of truth
> Last updated: 2026-10-07
> Principle: frontend UX / functional parity / safety first; implementation elegance second; line count never a goal
> Related: `FRONTEND_FEATURES.md`, `FUNCTION_INVENTORY.md`, `API_MATRIX.md`, `STATUS.md`

移行はbackend実装をそのまま移植する作業ではない。

CURRENTのユーザー体験、機能、権限、安全性、副作用を維持したうえで、framework境界を外し、似た責務を共通化し、Cloudflare上で効率的かつ読みやすい実装へ再構成する。

ただし**コード行数削減そのものを成果指標にしない**。

```text
Priority 1: frontend UX / behavior parity
Priority 2: permission / privacy / audit / consistency / rollback
Priority 3: operational reliability / 1102 resistance / performance
Priority 4: conceptual clarity / testability / reuse
Priority 5: code volume
```

---

# 1. Optimization rule

最適化は以下の順で考える。

1. CURRENT capabilityを特定する。
2. frontendから観測される契約を固定する。
3. backend side effectsと安全保証を固定する。
4. framework固有処理とbusiness ruleを分離する。
5. 同じ意味を持つ処理だけを共通化する。
6. HTTP requestから不要な同期処理を外す。
7. test/observability/rollbackが簡単になる設計を優先する。
8. 結果としてコードが短くなるなら歓迎する。

禁止:

- LOC削減目的の巨大generic abstraction
- 意味の違うCRUDを無理に共通化
- permission差を共通helperへ押し込んで見えなくする
- audit/notification/Queue失敗を隠す抽象化
- UX変更を「backend簡略化」として混ぜる
- 現在動いている安全策を理解せず削除
- 新frameworkに合わせるためのbusiness rule変更

---

# 2. Candidate state

| State | Meaning |
| --- | --- |
| `OBSERVED` | CURRENTに繰り返し/複雑性を確認しただけ |
| `CANDIDATE` | 共通化/再設計候補。まだ採用しない |
| `VALIDATED` | parity/test/perf上、採用価値を確認 |
| `ACCEPTED` | target実装方針として採用 |
| `REJECTED` | 共通化しない方が明確/安全 |
| `UX_IMPACT_REVIEW_REQUIRED` | 最適化にfrontend挙動変更が必要。ユーザー判断待ち |
| `BLOCKED` | inventory不足等で評価不能 |

Phase 0中は原則`OBSERVED`/`CANDIDATE`まで。
全機能棚卸し前に「最適解」と断定しない。

---

# 3. CURRENT observations and optimization candidates

以下は2026-10-06時点のコード探索から見えている候補。MIG-0003/0004/0007/0008/0009で詳細を監査して更新する。

| OPT ID | Area | CURRENT observation | Target direction to evaluate | Frontend contract at risk | State |
| --- | --- | --- | --- | --- | --- |
| OPT-001 | Server transport | 多数のServer Actionがbusiness logic、認可、DB、audit、revalidateを同居 | framework-neutral domain service + legacy adapter + Hono adapter | 保存結果、validation、permission、redirect/refetch | CANDIDATE |
| OPT-002 | Revalidation | `revalidatePath()`がadmin/manage/public等多数のactionに分散 | `revalidatePath`の意味を SPA query invalidation / public projection dirty / SSG build dirty / local optimistic update に分解 | 保存直後の反映、一覧と詳細の整合 | CANDIDATE |
| OPT-003 | Post-commit effects | `runRulesPostCommit`, `runXIdPostCommit`, `runSlotPostCommit`, `runModerationPostCommit`等domain別post-commit orchestrationが複数 | 共通のtyped post-commit runnerを核にしつつ、domain固有順序/必須性は明示 | 成功表示後の通知、static反映、retry | CANDIDATE |
| OPT-004 | Admin write guard | 複数actionにlocal `requireAdmin()` wrapperがあり、共有`requireAdminWrite`の周囲でcontext形成が重複 | typed `AdminMutationContext` / actor context factoryを検討 | unauthorized/forbidden表示、actor attribution | CANDIDATE |
| OPT-005 | Audit mutation | `expectedRowCondition`等audit adapterを多数のadmin mutationが利用 | domain mutation command + audit transaction helperの境界を整理 | conflict/error表示、restore可能性 | CANDIDATE |
| OPT-006 | Permissions | admin/manage/video/eventでpermission判定が広く利用され、simulatorも実core一致が必要 | 1つのpermission core + transport-specific guard adapter | ボタン可視性、403、owner invariant | CANDIDATE |
| OPT-007 | Visibility | video visibility transitionには既にshared helperが存在 | shared transition patternを保持し、他entityも同一のfail-closed設計へ寄せられるか評価 | private化の即時反映、情報漏洩 | OBSERVED |
| OPT-008 | Static rebuild | mutation後のpublic artifact rebuild/follow-upが複数domainへ波及 | domain event → projection/rebuild dependency resolverを明示し、重複enqueueを抑える | 公開反映時間、古い表示 | CANDIDATE |
| OPT-009 | Notifications | slot/video/admin等でpost-commit notification/outbox/retryが存在 | notification command/outbox contractを共通化、payload/domain ruleは分離 | 通知有無、重複、失敗再試行 | CANDIDATE |
| OPT-010 | Errors/results | actionごとにResult/Error shapeを持つ箇所が多い | domain error taxonomy + Hono error contract + UI mapping | field error、toast、再試行可否 | CANDIDATE |
| OPT-011 | Validation | form/action/APIで入力validation責務が分散しやすい | `packages/contracts`へ共有可能なsemantic schemaを置き、UI-only/domain-only validationは分ける | 入力エラー文言、許容値 | CANDIDATE |
| OPT-012 | Query/read models | public/manage/adminで同一entityを異なる形で読む | use-case別read modelを明示し、N+1/巨大joinを避ける。万能repositoryは禁止 | 一覧/詳細の情報欠落、表示速度 | CANDIDATE |
| OPT-013 | Public DTO | explicit public DTO projectionが既に重要な安全境界 | projectionをtargetでも独立packageとして維持し、UIからDB rowを直接参照しない | public/private境界、SEO表示 | OBSERVED |
| OPT-014 | External sync | YouTube等にquota/retry/idempotency/進捗管理がある | external job envelopeとsync state modelの共通化を評価 | progress、quota、retry表示 | CANDIDATE |
| OPT-015 | Queue jobs | fast/content/syncにjob/retry/recoveryが存在 | 共通job envelope/telemetry/idempotency keyは共有、job semanticsは分離 | 非同期完了時間、失敗復旧 | CANDIDATE |
| OPT-016 | Media proxy | YouTube thumbnail/Drive image等のproxyがHTTP Worker CPUを消費し得る | direct/cached/static/background artifactへ移せるものを分類 | 画像表示、fallback、キャッシュ更新 | CANDIDATE |
| OPT-017 | ID/alias | video internal ID/YouTube ID等複数識別子がroute/visibilityへ影響 | canonical ID resolver/route mapへ集約 | 既存URL、deep link、SEO | CANDIDATE |
| OPT-018 | CRUD UI/backend | adminに類似CRUD画面が多い | UI primitive/form compositionは共通化。backendはdomain invariantが同一の場合のみ共通command patternを採用 | 操作感、確認、validation | CANDIDATE |
| OPT-019 | Optimistic concurrency | cost guard/audit等でCAS/expected-row semanticsがある | conflict semanticsをdomain共通語彙へ整理 | 「他で変更された」時の再読込/再試行UX | CANDIDATE |
| OPT-020 | Observability | Worker/job/admin healthが複数surfaceに存在 | request/job correlation ID、structured result、admin diagnosticsの共通契約を評価 | エラー調査・再試行判断 | CANDIDATE |

この表は実装指示ではない。各MIG taskで「共通化した方が本当に意味が明確か」を検証する。

## MIG-0006 evidence

Workers Observabilityをread-only集計し、CURRENT request CPU/resource failureを測定した。countはABR sampling（主に sampleInterval ~= 10）による推定値として扱い、individual invocationで resource failureの存在も確認した。

- `flamenode-web` fetchはCPU median 15ms、p95 872ms、p99 1249msのsampling-weighted分布。successful rolloverを含むためこれ自体をCPU entitlementとは扱わない。
- web `exceededCpu` はsampling-weightedで約2,070件のsignalがあり、個別eventでは public video / user pathがCPU 10ms・HTTP 503で終了する例を確認した。
- webにはhistorical versionで `exceededMemory` も存在し、長wall-time後にHTTP 503。CPUだけを引き上げる対策では不十分。
- content queueにも `flamenode-static-rebuild-wake` の `exceededCpu` 実event（CPU 50ms）がある。background budgetはHTTP thin pathと分離して扱う。
- hot pathは home/list/user/videoのSSR/RSC、Google Drive/YouTube image proxy、account summary、entryに分散している。
- CURRENTのISR/card caps/icon-map削減/bounded degraded D1/static asset bypassは有効な防御なのでreplacement parityまで維持する。
- TARGET public SSG + thin visibility gateway、private SPA + bounded API、heavy work Queue/backgroundの方向を実測が支持する。
- representative TARGET budgetは simple read p95 < 5ms / normal mutation < 8ms / auth-heavy < 9ms / gateway p50 <1.5ms p95 <3ms p99 <5ms / exceededCpu=0。

Account subscription APIはconnector権限上read不能だったため、plan名は推測しない。観測されたfailure boundaryと公式runtime semanticsを基準にする。

MIG-0006でfrontend product-contract変更を必須とするoptimization blockerは0。レンダリングownershipは変えるがUX/URL/permission/visibility semanticsは維持する。

## MIG-0005 evidence

Cloudflare実環境とtracked config/deploy pathを照合し、以下をCURRENTとして固定した。

- production runtimeは `flamenode-web` + fast/content/sync job Workersの4本。4 Workerとも同一commitへ収束する単一production rolloutになっている。
- GitHub `main` に直接連携するWorkers Builds triggerはwebのみ。webのcustom deploy commandが web -> fast -> content -> sync -> smoke を順次実行し、job Workersへ独立Git pipelineは持たない。
- production ingressは `flamenode.net` / `www.flamenode.net` のCustom Domain 2件で、zone Worker Routesは0。workers.devは補助/bootstrapping surfaceとして有効。
- D1/KVは4 Workerで共有する一方、R2、assets、self service binding、Queue consumer、secretはWorker責務に応じて限定されている。
- tracked Wrangler templateのQueue/GA4 flags=`0` とproduction=`1`、Workers Builds metadataのbootstrap workers.dev originとdeployed custom-domain originの差は、production config生成時の明示的override/rewriteでありdriftではない。
- topologyの共通化は「全Workerを同じconfigへ寄せる」のではなく、typed deploy manifest + capability-specific bindingsとして扱う。

MIG-0005時点でfrontend behavior変更を必須とするoptimization blockerは0。Worker統合可否はMIG-0006のCPU実測とMIG-0009のjob semanticsを確認するまで確定しない。

## MIG-0004 evidence

33 Route Handler methodsの棚卸しから以下を確認した。

- public API envelope（rate limit / explicit DTO / safe error / cache headers）は共通化価値が高いが、static fallback・visibility sourceはrouteごとに明示する。
- Spreadsheetはsame-origin + admin write guard + bounded body + preview/atomicityを既に共有しており、targetでも専用bulk/data commandとして強化する。
- Live APIの `handleLiveApiGet` は良い共通核。operation mode確認、5秒micro-cache、payload query分離を維持する。
- Mediaはvalidation/R2 body/cache primitiveを共有できる一方、public D1 ACL / signed manage URL / viewer-conditional slot iconは異なるsecurity modelなので統合しない。
- public events/videosはstatic-first化をさらに進められるが、maintenance/static_json_only時のfail-closed D1 fallback禁止を維持する。
- Auth.js catch-all、legacy import、deep health、PVSF CORS staff APIは意図的なarchitecture exception候補。

MIG-0004時点でfrontend behavior変更を必須とするoptimization blockerは確定していない。cache/freshness変更のUX影響はMIG-0011で最終評価する。

## MIG-0003 evidence

110 Server Action execution unitsの棚卸しから以下を確認した。

- `writeGuard` / `requireAdminWrite`、`mutateWithAudit`、post-commit runner、video/slot plan系は既存の良い核としてtargetでも強化候補。
- `revalidatePath` はtargetで SPA refetch / public projection dirty / site build dirty / navigation refresh へ意味分解する。
- event ID rename、audit restore、submitted-slot destructive release、X merge、visibility repair、CostGuard CASはgeneric CRUD化しない。
- Server Action transport廃止自体はfrontend変更を要求しない。frontend change必須のoptimization blocker最終判定はMIG-0011で行う。

---

# 4. Preferred target shape

基本形:

```text
UI / Astro / React
        |
contracts (input/output/error)
        |
Hono / legacy adapter
        |
domain service / command / query
        |
DB + audit transaction
        |
post-commit effects
  |       |       |
Queue   R2 build  notification
```

## Domain service

責務:

- business rule
- permission decisionのdomain側ロジック
- transaction orchestration
- domain result/error

含めない:

- `revalidatePath`
- `redirect`
- Next Request/Response
- Hono Context
- React state

## Adapter

責務:

- session/requestからactor取得
- Zod parse
- domain service呼び出し
- HTTP/action resultへ変換
- SPA invalidation hint等のtransport concern

## Post-commit

DB commit後の処理を「全部同じbest-effort」とはしない。

各effectを分類する。

```text
REQUIRED_FOR_USER_RESULT
RETRYABLE_ASYNC
BEST_EFFORT_OBSERVABILITY
PUBLICATION_SAFETY_CRITICAL
```

例: visibility fail-closedは単なるbest-effortへ落としてはいけない。

---

# 5. Commonization acceptance test

共通化を採用する前に以下へすべてYesと答えられること。

- 入力の意味は本当に同じか
- permission semanticsは同じか
- transaction boundaryは同じか
- failure/retry semanticsは同じか
- audit requirementは同じか
- public/private impactは同じか
- frontendへ返す状態は同じか
- 共通化後もdomain名を読めば挙動が理解できるか
- 例外を大量のflagで表現していないか
- testが簡単になるか

Noが多い場合、重複コードでもdomain別実装を残す方が良い。

---

# 6. Backend optimization review required per MIG task

backendを触るMIG taskはPR内で以下を記録する。

```text
Optimization review:
- duplicated/current complexity observed:
- candidate commonization:
- rejected commonization and why:
- HTTP CPU impact:
- DB rows/read-write impact:
- Queue/R2 impact:
- frontend UX impact: none | describe
- feature IDs affected:
- recommendation:
```

「特になし」も有効。無理に最適化を作らない。

---

# 7. Efficiency blocker definition

以下を`OPTIMIZATION_BLOCKER`候補とする。

- 1機能のためだけにHTTP requestで重い同期処理を残す必要がある
- 同じ概念なのにfrontend仕様差のため共通化不能
- 特殊なpermission/visibility ruleが全体architectureを複雑化する
- legacy URL/データ互換がtarget設計を大きく拘束する
- 外部API仕様によりjob/UXが不自然になる
- リアルタイム性要求がSSG/static-firstと直接衝突する
- 危険操作の安全要件がgeneric CRUD化を阻む
- 既存UX維持のため高コストな二重経路が長期間必要

**これは悪い機能という意味ではない。**
その機能を例外として保持する方が全体として良い場合は、例外を明示して共通化を諦める。

---

# 8. Mandatory blocker report format

全機能棚卸しが完了したMIG-0011で、効率化の障害となる機能がある場合は必ずユーザーへ以下で提示する。

```text
Optimization blocker: <name>
Affected capability IDs:
Affected screens:
CURRENT frontend behavior:
Why it blocks simplification/efficiency:
Option A — preserve behavior exactly:
  backend consequence:
  frontend impact: none
Option B — change behavior:
  backend benefit:
  exact frontend UX/function impact:
Recommendation:
Risk:
Approval required: yes
```

ルール:

- frontend影響を「軽微」だけで済ませず具体化する
- 影響画面/操作/状態/権限を列挙する
- behavior changeは自動採用しない
- ユーザー承認まではCURRENT behaviorを維持する案をdefaultとする

障害がなければ:

```text
Optimization blockers requiring frontend change: 0
```

と明示する。

---

# 9. Inventory gate

最適化の最終評価は以下完了後のみ行う。

- all frontend capabilities audited
- all 86 screens mapped
- all Server Actions / inline actions disposed
- all Route Handlers disposed
- auth/permission baseline complete
- static/visibility baseline complete
- Queue/Cron/jobs baseline complete
- unknown functions = 0

この条件を満たすまでは、候補は候補のまま保持する。
