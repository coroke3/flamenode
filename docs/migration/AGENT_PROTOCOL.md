# FlameNode Migration Agent Protocol

> Status: Active
> Last verified: 2026-10-06
> Source of truth: `docs/migration/README.md`, `docs/migration/STATUS.md`, current code/test
>
> Claude Code / OpenAI Codex / Google Antigravity 共通の移行実行契約。
> ツール固有ファイルは薄いadapterとし、仕様を複製しない。

## Invocation

### Claude Code

```text
/flamenode-migration
/loop /flamenode-migration
```

### OpenAI Codex

Repo skill: `.codex/skills/flamenode-migration/SKILL.md`

```text
Use the flamenode-migration skill and execute exactly one READY MIG task.
```

継続はCodex Goalを利用してよいが、repository `STATUS.md` を優先する。

### Google Antigravity

```text
/flamenode-migration
```

正本adapter: `.agents/workflows/flamenode-migration.md`

### Generic agent

```text
Read docs/migration/AGENT_PROTOCOL.md and execute exactly one READY task from docs/migration/STATUS.md.
```

---

# Canonical read order

毎iteration:

1. `AGENTS.md`
2. `docs/AI_CONTEXT.md` のmigration行
3. `docs/migration/README.md`
4. `docs/migration/STATUS.md`
5. `docs/migration/FUNCTION_INVENTORY.md`
6. task種別に応じて:
   - frontend/UI/route/redesign → `FRONTEND_FEATURES.md`
   - backend/action/API/domain/job → `BACKEND_OPTIMIZATION.md`
   - 両方なら両方
7. **対象domainだけ** `docs/migration/functions/*.md`
8. 必要な `ROUTE_MATRIX.md` / `API_MATRIX.md`
9. 対象コードと関連test
10. 必要ならActive文書を追加1件

正本重複判断が必要な場合だけ `DOC_MAP.md` を読む。
Git操作は `GIT_WORKFLOW.md` を正本とする。

禁止:

- repo全体の無差別再読込
- Historical/archiveの一括投入
- 全function ledgerの毎回読込
- chat履歴だけをhandoffに使う
- tool固有adapterを仕様正本にする
- frontend capabilityを画面URLだけから推測して完了扱い
- backend最適化をLOC削減として評価

---

# One iteration contract

**1 iteration = exactly 1 MIG task.**

## Start / Claim

`STATUS.md`からCurrent Phase / Current Task / dependencies / gate / blocker / ownerを確認する。

`READY` taskをclaimし、PR branch上で`IN_PROGRESS`にする。

```text
Task:
Owner: claude | codex | antigravity | other
CURRENT:
TARGET:
Scope:
Non-scope:
Affected function IDs:
Affected frontend capability IDs:
Affected route/API IDs:
Rollback:
Production action required: yes/no
```

同一MIG taskのopen owner PRが存在する場合、新branchを作らない。

## Inventory guard

実装前に必ず:

1. `FUNCTION_INVENTORY.md`から対象function IDを特定
2. frontendに露出する場合は`FRONTEND_FEATURES.md`で観測契約を確認
3. 対象domain ledgerだけ読む
4. CURRENT詳細が未監査なら必要範囲を先に棚卸し
5. `DETAIL_AUDIT_REQUIRED` / unknown / unverifiedを移行済みにしない
6. 画面リデザインではprimary/secondary/destructive/permission-dependent capabilityを全てscopeまたはexplicit non-scopeへ分類
7. loading / error / empty / forbidden / pending / retry / responsive / deep-link semanticsを機能の一部として扱う

**Visual completion is not functional completion.**

## Backend optimization review

backendを触るtaskは `BACKEND_OPTIMIZATION.md` に従い、CURRENTを機械的に移植せず以下を評価する。

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

重要:

- 共通化は義務ではない。
- permission/failure/audit semanticsが違う処理は別のままでよい。
- LOC削減を理由に抽象化しない。
- frontend capability/使い心地を維持することが最優先。
- UX/機能変更が必要な最適化は`UX_IMPACT_REVIEW_REQUIRED`として停止し、ユーザー判断までCURRENT behavior維持をdefaultとする。

## Implement

- 1 MIG task = 1 branch = 1 PRを原則とする
- CURRENT contractをcode/testから固定
- framework-neutral domain logicを優先
- compatibility bridgeを明示
- 新経路導入と同時に旧経路を削除しない
- Big Bang rewrite禁止
- redesignでもcapability coverageを落とさない
- target stackだからという理由だけで新技術を導入しない

## Validate

最低限:

- task Acceptance
- affected function Acceptance
- affected frontend capability UX states
- relevant regression tests
- 必要なCPU/build/UI/security checks
- backend taskならoptimization review

## Finish

必ず `DONE` / `REVIEW` / `BLOCKED` のいずれかへ遷移する。
`IN_PROGRESS`のまま終わらない。

必要に応じて更新:

- `STATUS.md`
- `FRONTEND_FEATURES.md`
- `BACKEND_OPTIMIZATION.md`
- affected `functions/*.md`
- `FUNCTION_INVENTORY.md`
- `ROUTE_MATRIX.md`
- `API_MATRIX.md`

通常taskは同じPR内でtask `DONE` + 次dependency-ready taskの`READY`まで記録してからsquash mergeする。

---

# Multi-agent coordination

Git repositoryだけを共有状態の正本にする。

## Single writer

1 taskは同時に1 agentだけが`IN_PROGRESS`。
他agentはread-only review/auditに回れる。

並列化しやすい:

- read-only inventory
- test audit
- design comparison
- security review
- CPU/build analysis
- PR review
- optimization candidate review

同時編集を避ける:

- `STATUS.md`
- 同じfunction/capability ledger row
- 同じroute/API matrix row
- 同じdomain service
- DB/auth/permission/visibility core

## Handoff

agent交代前にrepo/PRへ残す:

- state / owner
- findings/evidence
- frontend capability impact
- optimization findings
- tests
- blocker
- next action

チャットだけのhandoffは無効。

---

# Continuous execution

```text
LOOP:
  read STATUS
  select exactly one READY MIG task
  claim
  inventory current contract
  implement/audit
  validate
  persist progress + ledgers/matrices
  evaluate stop conditions
```

## Mandatory stop

- Overall State = BLOCKED
- READY taskなし
- Phase GateがREVIEW待ち
- production actionに明示承認が必要
- Remote D1 / secret / Worker Route / Custom Domain変更が必要
- auth/security/permission/visibility仕様が衝突
- required function/frontend capability inventoryが不明
- optimization requires frontend behavior change
- test failureがtask scopeを超える
- rollback不能/未証明
- 別agentが対象taskを所有中

禁止:

- 複数MIG taskを1回のstate transitionでDONE
- Phase Gate自動承認
- BLOCKEDを飛ばす
- production deploy/routing/secret/Remote D1の自動変更
- progress MD更新なしで次iterationへ進む

---

# Redesign contract

Visual sources:

1. `docs/design-redesign/DESIGN_PRINCIPLES.md`
2. `docs/design-redesign/UX_AUDIT.md`
3. `docs/design-redesign/NAVIGATION.md`
4. `/dev/redesign`
5. `docs/design-redesign/PAGE_COVERAGE.md`
6. `docs/design-redesign/DECISIONS.md`

Functional sources:

- CURRENT code/tests
- `FRONTEND_FEATURES.md`
- `FUNCTION_INVENTORY.md` + relevant ledger
- `ROUTE_MATRIX.md`
- `API_MATRIX.md`

画面DONE条件:

- visual redesign complete
- responsive states complete
- loading/error/empty/permission/pending states covered
- 全required capability/functionが`PARITY_VERIFIED`または`REMOVED_APPROVED`
- permission/server side effects確認済み
- route/API dependencyが移行済みまたはbridgeあり
- current acceptance testまたはreplacement testあり
- direct navigation/reload/history/query semantics確認済み

見た目のみ完成は`UI_DONE_FUNCTIONS_PENDING`。

---

# Existing-function preservation invariant

Final migrationでは以下を残さない。

```text
UNKNOWN required functions
DETAIL_AUDIT_REQUIRED functions
unverified migrated functions
screens without complete capability mapping
frontend capabilities without UX-state mapping
legacy actions/routes without disposition
background jobs without disposition
permission rules without parity evidence
side effects without parity evidence
optimization blockers without frontend-impact disposition
```

機能削除はmigrationに紛れ込ませない。

削除手順:

1. ledger → `REMOVAL_PROPOSED`
2. frontend capability impactを具体化
3. affected users/routes/dataを記録
4. replacement if any
5. explicit Lead/user approval
6. approval後のみ`REMOVED_APPROVED`

---

# Phase 0 optimization-blocker report

MIG-0011で全棚卸しが完了した時点で、`BACKEND_OPTIMIZATION.md`の候補を再評価する。

効率化の障害となる機能があれば必ず:

- affected capability IDs/screens
- CURRENT frontend behavior
- preserveする場合のbackend consequence
- behaviorを変える場合の正確なfrontend impact
- recommendation/risk

をユーザーへ提示する。

frontend変更案は承認なしに採用しない。
障害がなければ `Optimization blockers requiring frontend change: 0` と明記する。

---

# Completion format

```text
MIG-XXXX: <task>
Agent: <agent>
State: DONE | REVIEW | BLOCKED

Functions / frontend capabilities:
- FN-...

Changed:
- ...

Preserved:
- ...

Optimization review:
- ...

Validation:
- ...

Rollback:
- ...

Progress files updated:
- STATUS.md
- relevant ledgers/matrices

Next:
- MIG-YYYY | Phase Gate review | BLOCKED(reason)
```
