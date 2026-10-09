# FlameNode Migration Agent Protocol

> Status: Active / mandatory execution contract
> Last verified: 2026-10-07
> Applies to: Claude Code / OpenAI Codex / Google Antigravity / generic coding agents

ツール固有command/skill/workflowは薄いadapterであり、この文書が共通実行契約。

## Invocation

### Claude Code

```text
/flamenode-migration
/loop /flamenode-migration
```

### OpenAI Codex

`.codex/skills/flamenode-migration/SKILL.md` を利用する。
継続実行でもrepositoryの`STATUS.md`を進捗正本にする。

### Google Antigravity

```text
/flamenode-migration
```

- slash workflow: `.agents/workflows/flamenode-migration.md`
- reusable skill: `.agents/skills/flamenode-migration/SKILL.md`
- always-on repo rule: `.agents/rules/flamenode-project.md`

### Generic agent

```text
Read docs/migration/AGENT_PROTOCOL.md and execute exactly one READY MIG task.
```

---

# Mandatory read order

毎iteration:

1. `AGENTS.md`
2. `docs/AI_CONTEXT.md` のmigration entry
3. `docs/migration/STATUS.md`
3a. `docs/migration/OPEN_DECISIONS.md`（対象taskに紐づくDecision状態を必ず確認）
3b. **`docs/migration/IMPLEMENTATION_RUNBOOK.md`**（Luna/Haiku含む全agent必読）
3b1. **`docs/migration/FILE_PROGRESS_PROTOCOL.md` と `FILE_MIGRATION_MATRIX.md` の現在のMIGに属するファイル行だけ**（source→target→consumerと各ファイル状態を記録する）
3c. **`docs/migration/TASK_CARDS_2_3.md` / `TASK_CARDS_4_5.md` / `TASK_CARDS_6_7.md` / `TASK_CARDS_8_9.md` の該当MIG 1件だけ**。大型MIGは `docs/migration/TASK_MICRO_UNITS.md` の該当micro-unitだけ読む。全55件を一度に読み込まない
4. `docs/migration/GIT_WORKFLOW.md`
5. `docs/migration/README.md`
6. `docs/migration/FEATURE_CATALOG.md` — **対象IDの行だけ**確認（432 UX / 136 FN を一度に読む必要はない）
7. `docs/migration/PRODUCT_REQUIREMENTS.md` の**対象要件節のみ**
8. `docs/migration/CODE_QUALITY.md` の該当規約
9. task scopeに応じて:
   - route/UI/frontend → `CURRENT_ROUTES.md` + `FRONTEND_FEATURES.md` +対象`frontend/*.md` + `screen-mapping/README.md`
   - backend/domain/action/API/job → `FUNCTION_INVENTORY.md` +対象`functions/*.md` + `BACKEND_OPTIMIZATION.md`; Server Actionを触る場合は `server-actions/README.md`; Route Handler/APIを触る場合は `route-handlers/README.md`; Cloudflare Worker/ingress/binding/build/job topologyを触る場合は `cloudflare/TOPOLOGY.md`; CPU/1102/request hot-path/PoC performanceを触る場合は `cloudflare/PERFORMANCE_BASELINE.md`; static artifact/alias/visibility/fallback/repairを触る場合は `static-delivery/README.md`; auth/session/linking/terms/Active X/permission/owner invariantを触る場合は `auth/README.md`; Queue/Cron/background job/retry/DLQ/recoveryを触る場合は `background-jobs/README.md`
   - visual/UI design → `UI_REFERENCE.md`
10. 必要な`ROUTE_MATRIX.md` / `API_MATRIX.md`
11. 対象CURRENT code + tests + config

正本の所在が不明な時だけ`DOC_MAP.md`を読む。

## Context minimization

- Luna/Haiku等は **RUNBOOK → 該当MIGカード → 対象SPEC/ledgerの必要な数行 → CURRENT source/test** の順で読む。複数フェーズカードの一括読み込み禁止。
- カードの`+path`は予定作成ファイルであり実在を保証しない。既存ファイル・シンボルは現物を開いて確認する。
- 各wake最新main/PR/Decision・CI/owner/evidenceを再取得。前wakeや会話を正本にしない。

- 全432 UX行を毎回読まない。
- 全136 FN行を毎回読まない。
- 対象domain ledgerだけ読む。
- historical/archiveは必要な要件照合時のみ読む。
- chat historyは進捗正本にしない。

---

# Non-negotiable priorities

```text
1. frontend usability / behavior / capability preservation
2. permissions / privacy / data integrity / auditability
3. async/external side-effect outcome preservation
4. URL/query/history/session compatibility
5. 1102 resistance / reliability / operational efficiency
6. beautiful, explicit, maintainable implementation
7. reuse / code reduction
```

コード行数削減を目的にしない。
結果的に短くなるのはよいが、意味を失う抽象化は禁止。

---

# One iteration = one MIG task

`STATUS.md`のdependencyを満たした1 taskだけを進める。**該当TASK_CARDS_*.mdカードを読み、変更対象・テスト・停止条件をclaimへ書く。** 作業カードは `node scripts/check-migration-task-cards.mjs` と `node --test scripts/check-migration-task-cards.test.mjs` で整合性検証する（実コード完成の保証ではない）。

## Claim

開始前には FILE_MIGRATION_MATRIX.md で対象sourceの現在の行と全consumer/legacy bridgeを確認し、ファイルごとの変更・テスト・rollback計画を記入する。

```text
Task:
Owner: claude | codex | antigravity | other
State: READY -> IN_PROGRESS
CURRENT:
TARGET:
Scope:
Non-scope:
Affected UX IDs:
Affected FN IDs:
Affected routes/APIs/jobs:
Requirement sources:
Rollback:
Production action required: yes/no
```

同一MIG taskを別writerが所有している場合は新branchを作らない。

## Git rule

`GIT_WORKFLOW.md`を必ず守る。

原則:

```text
1 MIG task = 1 short-lived branch = 1 PR = 1 squash merge
```

- main直push禁止
- task branchをmainから切る
- Draft PRを早期作成
- one writer lane
- 他agentはreview/audit laneにできる
- code landingとproduction traffic切替は別操作
- Remote D1 / secret / Worker Route / Custom Domain変更は明示承認なしに実行しない
- auth/permission/visibility/schema/high-riskは独立review + Lead/user approvalを要求
- rollbackをPRに記録

---

# Existing-function guard

実装/設計前に:

0. `FEATURE_CATALOG.md` で対象機能と隣接機能を確認し、一覧から漏れているCURRENT機能がないかコードと照合する。

1. `CURRENT_ROUTES.md`で影響routeを確定し、`screen-mapping/README.md`でそのscreen/shellのRequired UX/FN・permission/state/query/RA profileを確認。
2. 対象`frontend/*.md`から関連`UX-*`を列挙。
3. 対象`functions/*.md`から関連`FN-*`を列挙。
4. CURRENT action/API/job/permission/side effectsをcode/testで確認。
5. existing design intentが関係するなら`PRODUCT_REQUIREMENTS.md`に従って照合。
6. 未監査項目を「不要」と推測しない。

ユーザーが認識する以下も機能:

- button/link/tab/menu
- search/filter/sort/page
- loading/empty/error/forbidden/degraded/pending/success
- validation/confirm/retry
- responsive/keyboard/focus
- URL/query/deep-link/back-forward/reload
- notification/external sync result
- public/private visibility
- async reflection delay

**Visual completion is not functional completion.**

---

# UI redesign contract

`UI_REFERENCE.md`が正本。

現在`PENDING_HTML`の間:

- `docs/design-redesign`を参照しない
- `app/(redesign)`をtarget designの正本にしない
- agentが独自の新visual designを確定しない
- CURRENT UX contractの棚卸し/維持は続ける

後日HTML mockが登録されたら、mockをvisual/IA targetとしてroute/UXへmappingする。

HTML mockに存在しないCURRENT機能を黙って消さない。
permission/business/visibility/side-effect rulesはHTML mockだけでは変更しない。

---

# Existing design / requirement preservation

`PRODUCT_REQUIREMENTS.md`に従う。

- CURRENT code/test/config = 現在挙動の第一証拠
- active設計文書 = product intentの証拠
- historical docs = 背景
- 矛盾は`CURRENT_DIVERGENCE`として記録
- old designへ勝手に戻さない
- CURRENT divergenceを黙って正当化もしない
- improvement候補はUX影響付きで提示する

frontend behavior変更は明示承認までCURRENT維持がdefault。

---

# Backend optimization contract

CURRENT implementationを新frameworkへ機械翻訳しない。
`BACKEND_OPTIMIZATION.md`に従って毎backend taskで評価する。

```text
Optimization review:
- duplicated/current complexity observed:
- candidate commonization:
- commonization intentionally rejected and why:
- framework coupling removed/retained:
- HTTP CPU impact:
- DB rows/read-write impact:
- Queue/R2/KV impact:
- transaction/audit/post-commit effects:
- frontend UX impact: none | exact impact
- affected UX IDs:
- affected FN IDs:
- recommendation:
```

共通化は義務ではない。
permission / transaction / failure / audit / visibilityの意味が違うなら別実装を維持する。

UX変更が必要な最適化は`UX_IMPACT_REVIEW_REQUIRED`で止める。

---

# Code quality contract

すべてのimplementationは`CODE_QUALITY.md`に従う。

要求:

- experienced production engineerが読んで責務/命名/依存方向に違和感がない
- domain vocabularyが正確
- framework adapterは薄い
- domain logicはframework-neutralを優先
- transaction/permission/visibility/side effectsが明示的
- clever magicよりpredictable control flow
- typed contracts / boundary validation
- generic mega-helper/flag-heavy CRUDを作らない
- commentsはwhy/invariantを説明
- testsはbehavior/invariantを固定
- performance最適化は計測可能
- temporary workaroundにはremoval condition/taskを付ける

「美しいコード」は短いコードではなく、意味が明確で局所的に推論できるコード。

---

# Implementation rules

- compatibility bridgeを明示する
- 新経路導入と同時に旧経路を削除しない
- Big Bang rewrite禁止
- DB migrationはexpand -> migrate -> contract
- public requestにheavy generationを戻さない
- Cloudflare topology変更前に `cloudflare/TOPOLOGY.md` のCURRENT ingress/binding/build invariantsを確認する
- auth/permission変更前に `auth/README.md` のCURRENT trust hierarchy・fail-closed・owner/privilege-mode invariantsを確認する
- Queue/Cron/job変更前に `background-jobs/README.md` のdoorbell-only・D1 canonical・retry-layer分離・Recovery invariantsを確認する
- CPU/1102/request execution変更前に `cloudflare/PERFORMANCE_BASELINE.md` のsampling semantics・resource outcomes・TARGET budgetsを確認する
- public/static delivery変更前に `static-delivery/README.md` のcommit-point・deny-first fence・canonical alias・fail-closed/fallback契約を確認する
- authzをUIだけに置かない
- public DTOをDB rowそのままにしない
- fail-closed visibilityを弱めない
- audit/retry/idempotencyを削らない
- framework移行を理由にbusiness ruleを変えない

---

# Validation

最低限:

```text
[ ] MIG task acceptance
[ ] affected UX contracts
[ ] affected FN contracts
[ ] permissions/privacy/visibility
[ ] DB/audit/Queue/R2/KV/notification effects
[ ] loading/error/empty/pending/degraded states where applicable
[ ] URL/query/history/reload behavior where applicable
[ ] relevant regression tests
[ ] code quality review
[ ] backend optimization review where applicable
[ ] CPU/build/security checks where applicable
[ ] rollback path
```

checker/testを実行できなかった場合、実行済みと書かず理由を明記する。

---

# Progress persistence

`STATUS.md`が唯一のtask進捗正本。

終了時は単一wakeの作業結果を必ずPRへ保存する。

- 1wakeで全micro-unitが完了した場合: `REVIEW`（別レビュアー/CI待ち）、合格後`DONE`。
- 未解決障害がある場合: `BLOCKED`（再開条件とowner記載）。
- **正常な途中経過で、micro-unitがまだ残る場合**: 同一Draft PRのbranch `STATUS.md`に `IN_PROGRESS` を維持してよい。ただし有効owner、実行済みunit、テスト、次unit、PR link、HEADを必ず記録する（`TASK_MICRO_UNITS.md`）。mainのREADYを勝手に変更しない。

何のチェックポイントもない`IN_PROGRESS`の放置は禁止。

必要に応じて同じPRで更新:

- `STATUS.md`
- `CURRENT_ROUTES.md`
- `FRONTEND_FEATURES.md` / `frontend/*.md`
- `FUNCTION_INVENTORY.md` / `functions/*.md`
- `PRODUCT_REQUIREMENTS.md`
- `BACKEND_OPTIMIZATION.md`
- `ROUTE_MATRIX.md`
- `API_MATRIX.md`

通常taskはtask DONE + next dependency-ready task READYまで同じPRへ記録してsquash mergeする。

---

# Multi-agent coordination

repository/PRだけを共有状態の正本にする。

- 1 task = 1 writer
- Claude/Codex/Antigravityを同じtaskへ同時writerにしない
- 他agentはreview/audit/test analysisへ回す
- STATUS/同一ledger行/core permission/auth/schemaの同時編集を避ける

Handoffはrepoへ残す:

```text
state / owner
findings / evidence
UX/FN impact
requirement divergence
optimization findings
tests
blockers
next action
```

---

# `/loop` / continuous execution

```text
LOOP:
  read STATUS
  select exactly one READY MIG task
  obey Git workflow
  claim
  inventory CURRENT route/UX/FN/requirements
  implement or audit
  optimize only within preservation contract
  validate code quality + behavior
  persist STATUS + ledgers/matrices
  evaluate stop conditions
```

## Mandatory stop

- 対応タスクカード欠落、未実在ソースへの参照、CURRENTとの矛盾があり同一MIGで解決できない場合はBLOCKEDで再開条件を記録

- Overall/Task State = BLOCKED
- READY taskなし
- taskに必要な `OPEN_DECISIONS.md` のDecisionが `DECIDED` ではない（対象scopeの純粋ロジック部分だけ進める場合は境界を記録）
- 前wakeが作成したopen PRが同じMIGを所有し、resume/handoffができない
- 必須CI失敗、または独立レビューの証拠が無い状態でのDONE/merge要求
- Phase Gate review待ち
- production actionの明示承認待ち
- Remote D1 / secret / Worker Route / Custom Domain変更が必要
- auth/security/permission/visibility requirement conflict未解決
- required UX/FN inventoryが不明
- optimizationがfrontend behavior変更を要求
- UI visual taskだが`UI_REFERENCE.md = PENDING_HTML`
- test failureがtask scopeを超える
- rollback不能/未証明
- 別agentが対象taskを所有中

Phase Gateをagentが自動承認しない。

---

# MIG-0011 final blocker report

全棚卸し完了後、効率化の障害となる機能があれば必ず以下をユーザーへ提示する。

```text
Optimization blocker: <name>
Affected UX IDs:
Affected FN IDs:
Affected screens:
CURRENT frontend behavior:
Why it blocks simplification/efficiency:
Option A — preserve exactly:
  backend consequence:
  frontend impact: none
Option B — change behavior:
  backend benefit:
  exact frontend UX/function impact:
Recommendation:
Risk:
Approval required: yes
```

障害がなければ:

```text
Optimization blockers requiring frontend change: 0
```

と明示する。

---

# Completion format

```text
MIG-XXXX: <task>
Agent: <agent>
State: DONE | REVIEW | BLOCKED

Affected:
- UX-...
- FN-...
- routes/APIs/jobs

Changed:
- ...

Preserved:
- ...

Requirement reconciliation:
- ...

Optimization review:
- ...

Code quality review:
- ...

Validation:
- ...

Rollback:
- ...

Progress files updated:
- ...

Next:
- MIG-YYYY | Phase Gate review | BLOCKED(reason)
```

---

# Resumable loop / PR lifecycle contract（2026-10-09追補）

1. 各wakeにおいて最新mainとopen migration PRを読み込む。大型MIGは `TASK_MICRO_UNITS.md` の1unitを選び、branch STATUSのcheckpointから再開する。PR branchに当該taskの`IN_PROGRESS/REVIEW`があるなら、branch STATUSを優先し、新しいtask/PRを生成しない。
2. `OPEN_DECISIONS.md`の`Needed by`相当のMIG依存を解釈し、該当タスクについて`OPEN`/`PROVISIONAL`/`BLOCKED_ON_USER`を「許可済み」と解釈しない。決定の証拠（decision ID / owner / date）をPRへ記録する。
3. task claimはGitHubの単一atomic transactionではない。draft PRを作成する前後で同一MIGのopen PRを照合し、重複したら作業せずowner調整へ止める。mainの`READY`のみで未所有とみなさない。
4. 実装は一taskずつ、大型MIGは1wakeにつき1micro-unitずつ。期待する関数・経路・静的情報が足りないときに「作業済み」と扱わない。失敗テストの修正は同scope内2回まで。その後は`BLOCKED`として証拠と再開条件を残す。
5. `REVIEW`は必ず独立したレビュアーによるレビューと、対象branchの必須CI成功を必要とする。`DONE`へ進む前にレビュー時のhead SHA、レビュー結論、run URL、rollback証拠をPRに記録。新push後はレビュー/CIを再評価する。
6. 人間承認が必要なGate/認証/権限/visibility/DB schema/本番切替を、Loop維持のために自動承認しない。安全に進められる無関係taskがある場合も、明示的なdependencyとwriterの独立が条件。
7. merge後に最新mainのstatus/task/lock解消を再読込するまでは次taskへ移らない。hostが反復機構を持たなければ一回で終了する。
8. stale`IN_PROGRESS`/古いPRは自動削除しない。PRを根拠にhandoffし、claim譲渡・失敗理由・未実行チェック・次の実行者を明示する。

状態機械としての契約: `READY → IN_PROGRESS → REVIEW → DONE`。例外: `IN_PROGRESS/REVIEW → BLOCKED`（復旧条件明記）。`REVIEW`は合格を意味しない。`DONE`はreview/CIと依存完了を必要とする。フェーズGateはユーザーの明示承認を別に要する。
