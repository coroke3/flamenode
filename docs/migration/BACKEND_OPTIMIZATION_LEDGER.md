# FlameNode Backend Optimization Ledger

> Status: Active / Backend optimization source of truth
> Last updated: 2026-10-06
> Frontend preservation contract: [`FRONTEND_FEATURE_INVENTORY.md`](FRONTEND_FEATURE_INVENTORY.md)
> Function implementation detail: [`FUNCTION_INVENTORY.md`](FUNCTION_INVENTORY.md) + `functions/*.md`
> API migration: [`API_MATRIX.md`](API_MATRIX.md)

この文書は、移行時にbackend実装をそのまま写経せず、**frontendの使い心地・機能・安全性を維持したまま、より単純・共通化可能・効率的・理解しやすい実装を継続的に探すための台帳**。

コード行数削減はKPIではない。

優先順位:

```text
1. frontend capability / UX維持
2. permission / privacy / visibility / audit / idempotency / atomicity維持
3. correctness / rollback / operability
4. Cloudflare Free CPU・I/O効率
5. 責務分離 / 共通化 / 読みやすさ / testability
6. 結果としてのコード量・重複削減
```

短いコードより、**説明可能で安全なコード**を選ぶ。

---

# 1. Candidate states

- `DISCOVERED`: 重複/複雑性/CPU課題を発見
- `EVIDENCED`: call sites・tests・frontend contract・costを確認済み
- `PROPOSED`: target patternを提案済み
- `APPROVED`: migration taskで採用決定
- `IN_PROGRESS`: 実装中
- `VERIFIED`: parity/performance/operability確認済み
- `REJECTED`: 利点よりリスクが大きく不採用
- `DEFERRED`: 今は変更しない方が良い
- `FRONTEND_DECISION_REQUIRED`: 最適化にfrontend仕様変更が必要

「似ているから共通化」は採用理由にならない。

---

# 2. Evaluation dimensions

各候補は最低限以下で評価する。

```text
Optimization ID
Current code / owners
Related function IDs
Related routes/APIs/jobs
Observed duplication / complexity / CPU / I/O problem
Why current structure exists
Frontend-visible contract
Security/permission/visibility contract
Audit/atomicity/idempotency contract
Candidate target design
Alternative designs considered
Expected CPU / D1 / R2 / Queue effect
Failure mode / partial failure
Migration bridge
Rollback
Test strategy
Frontend impact: none | internal-only | visible-compatible | visible-change
Frontend impact detail
Decision / state
Evidence
```

---

# 3. Design principles

## 3.1 Domain behaviorをtransportから分離

目標:

```text
UI / Hono / legacy Server Action / Queue
              |
              v
       domain service
              |
       repositories/adapters
```

- `packages/domain`へNext/Hono/Astro依存を持ち込まない。
- Server ActionをそのままHono handlerへコピーしない。
- legacy Nextとnew Honoが同一domain serviceを呼べるbridgeを優先する。

## 3.2 QueryとCommandを意味単位で揃える

単純なCRUD抽象化を目的にしない。

例:

```text
updateVideoMetadata
changeVideoVisibility
submitVideoToSlot
approveXLinkRequest
changeEventStaffRole
```

のように、frontendから見える業務行為と一致するcommandを優先する。

## 3.3 認可を共通policyへ寄せる

ページ/Action/APIごとに似たpermission判定が散っている場合:

- principal
- resource
- operation
- event/video role

を入力とする共通policy/coreを検討する。

ただしpermission simulatorとproduction判定が同一coreを使えることをAcceptanceにする。

## 3.4 Post-commit side effectsを明示

mutationの中に以下が混在している場合、共通orchestrationを検討する。

- audit
- static rebuild enqueue
- notification enqueue
- R2/KV invalidation
- public build dirty
- external sync wake

DB commit前に外部副作用を出さない。

必要なら:

```text
transaction
  -> commit
  -> post-commit effect dispatcher
  -> Queue
```

を使う。

「万能event bus」を先に作らない。実際の重複が確認された領域だけ抽出する。

## 3.5 Public projectionを一元化

同じentityからpublic API、R2 static artifact、Astro build inputで別々のprojectionを実装しない。

理想:

```text
D1/domain entity
   -> safe public DTO projector
      -> API
      -> R2 artifact
      -> Astro build snapshot
```

private field追加時に一箇所で漏洩防止できることを重視する。

## 3.6 External integrationsをadapter化

YouTube / Discord / X / Google Driveはdomain logicと分離し、

- quota
- timeout
- retry
- idempotency
- external error mapping

をadapter境界へ寄せる。

frontendにはdomain-levelな状態へ変換して返す。

## 3.7 Queue job contractを統一

Jobごとの共通要素:

- stable job type/version
- idempotency key
- attempt
- lease/claim
- retryable/non-retryable classification
- DLQ/recovery metadata
- observability

を共通helperへ寄せられるか検討する。

ただしfast/content/syncの実行特性が異なるため、1巨大consumerへ統合することを目的にしない。

## 3.8 Error contractを明示

内部例外をそのままUIへ返さない。

frontendが必要とするerror categoryを共有contract化する候補:

```text
VALIDATION
UNAUTHENTICATED
FORBIDDEN
NOT_FOUND
CONFLICT
RATE_LIMITED
EXTERNAL_UNAVAILABLE
RETRYABLE
INTERNAL
```

message文言までbackend contractへ固定しすぎず、UIが適切なfeedbackを構築できる情報を返す。

---

# 4. Seed optimization candidates

以下は**採用決定ではない**。MIG-0003/0004/0007/0008/0009で実コードとtestを確認してstateを上げる。

| ID | Candidate | Related functions | Expected benefit | Frontend impact | State |
| --- | --- | --- | --- | --- | --- |
| `OPT-001` | Server Action / Route Handlerのbusiness logicをdomain serviceへ抽出 | Personal/Entry/Manage/Admin mutations | Next依存削減、Honoとの二重実装防止、test容易化 | none expected | DISCOVERED |
| `OPT-002` | auth/permission request contextを共通principal/policyへ整理 | Auth, PER-003, MNG-004..009, ADM全般, X-002 | permission重複削減、simulator parity | visible-compatible | DISCOVERED |
| `OPT-003` | mutation後のaudit/rebuild/notification等をpost-commit orchestrationへ整理 | X-005, PLAT-003..005, JOB-006/008 | atomicity明確化、side-effect漏れ防止 | none expected | DISCOVERED |
| `OPT-004` | public DTO projectorをAPI/R2/Astroで共有 | PUB detail/list/user/event, PLAT-002, X-003/004 | privacy安全性、projection重複削減 | none expected | DISCOVERED |
| `OPT-005` | visibility判定API/manifest/route-mapの責務整理 | PUB-002/010/013/018/022, PLAT-004/005/007, X-010/011 | fail-closedを保ったままgateway軽量化 | none expected if parity proven | DISCOVERED |
| `OPT-006` | static rebuild target/dependency graph helperの共通化 | PLAT-003/006/008/009, JOB-002/008 | fanout storm抑制、dedupe、理解性 | none expected | DISCOVERED |
| `OPT-007` | Queue envelope/retry/idempotency helper | JOB-001..008, X-006 | retry semantics統一、DLQ運用改善 | none expected | DISCOVERED |
| `OPT-008` | YouTube integration adapter統合 | ENT-005, MNG-010, ADM-030/031, JOB-005 | quota/error/dedupeロジック集約 | visible-compatible | DISCOVERED |
| `OPT-009` | Discord notification delivery adapter + result model | MNG-006/011, ADM-018, JOB-006 | retry/DM失敗/二重送信制御の一元化 | visible-compatible | DISCOVERED |
| `OPT-010` | X identity/link/merge domainの共通化 | PER-007, MNG-012, ADM-028/029 | approval/merge制約の一元化 | visible-compatible | DISCOVERED |
| `OPT-011` | video mutation commandsの責務分割 | PER-002/003, ENT-003/004, MNG-008/009, ADM-025/026 | 巨大update処理回避、permission/side-effect明確化 | none if commands preserve workflows | DISCOVERED |
| `OPT-012` | event/staff/slot policyとcommand共通化 | ENT-002/003, MNG-004..009, ADM-009..012, X-001 | owner/slot/stage invariantを一箇所で保証 | none expected | DISCOVERED |
| `OPT-013` | admin CRUDのvalidation/command/result pattern共通化 | ADM-002/008/009/010/020/024/025 | boilerplate削減、error/result一貫性 | visible-compatible | DISCOVERED |
| `OPT-014` | media proxy経路をstream/direct/cached artifactへ整理 | API-009/010/011 | 1102 CPU低減、buffer削減 | possibly visible-compatible | DISCOVERED |
| `OPT-015` | query/loadersのrequest-scope cacheとbatching見直し | public/detail/admin lists | D1 rows/CPU削減、重複read抑制 | none expected | DISCOVERED |
| `OPT-016` | frontend server-state contractをdomain別endpointへ整理 | Private SPA全般 | Hono APIの理解性、巨大RPC type回避 | visible-compatible | DISCOVERED |
| `OPT-017` | operation mode / cost guardの一貫したread/write境界 | ADM-007, platform jobs | CAS/overrideの分散防止 | visible-compatible | DISCOVERED |
| `OPT-018` | audit actor/target/change builderの共通化 | 全mutation | audit欠落/形式差減少 | none expected | DISCOVERED |

---

# 5. Anti-goals

以下は「綺麗そう」でも採用しない。

- 全domainを1巨大generic repositoryへ入れる
- 全mutationを1generic CRUD endpointへする
- 全Queueを1 Worker/1 consumerへ統合すること自体を目的にする
- UI都合を無視したREST purity
- 行数削減のために明示的permission/audit/error handlingを隠す
- implicit magic decorator/codegenを増やしagentが追えなくする
- frontend stateを減らすためbackend errorを全部500へ丸める
- performance推測だけでcacheを追加する
- legacyとnewを同時に書き換え、比較可能なbridgeを消す

---

# 6. Optimization acceptance

backend最適化を`VERIFIED`へ上げる条件:

1. 関連frontend function IDsを特定
2. CURRENT frontend behaviorをテスト/証拠で固定
3. permission/privacy/visibility/audit/idempotency/atomicityを固定
4. target実装が同等以上である
5. migration bridgeがある、またはatomic cutoverが安全と証明済み
6. failure/partial-failure behaviorが同等以上
7. CPU/D1/R2/Queue改善を主張する場合は計測あり
8. rollback可能
9. `FRONTEND_FEATURE_INVENTORY.md`のvisible contractに変更がない、または明示承認済み
10. 変更理由を「行数が減るから」だけにしない

---

# 7. Frontend-impact blocker rule

全機能棚卸し後、backendのより良い構造が**frontend仕様のために実現しにくい**場合は、勝手にfrontendを変えない。

`FRONTEND_DECISION_REQUIRED`として以下を記録する。

```text
Optimization ID:
Blocking Function IDs:
Current frontend behavior:
Backend constraint caused by it:
Best backend design if behavior is preserved:
Best backend design if behavior changes:
Exact user-visible difference:
Affected roles/routes:
Migration/security/data effect:
Measured cost of preserving behavior:
Recommendation:
```

ユーザーへ提示する際は、

- 何がbackend最適化の障害なのか
- 現状維持で何が残るのか
- frontendを変えると利用者に何が起きるか
- 変更しない選択肢

を必ず示す。

---

# 8. How `/flamenode-migration` uses this ledger

- MIG-0002/0010: frontend contractを固定する。
- MIG-0003/0004: Action/API重複から候補を`EVIDENCED`へ上げる。
- MIG-0005/0006/0007/0009: Cloudflare/CPU/static/Queue観点から候補を追加・評価する。
- MIG-0008: auth/permission候補を評価する。
- MIG-0011: 全候補とfrontend blockerを横断整理する。
- MIG-0301以降: `APPROVED`候補のみtarget architectureへ実装する。

各taskはbackend改善案を見つけても、active taskのscope外なら実装せずこのledgerへ記録する。
