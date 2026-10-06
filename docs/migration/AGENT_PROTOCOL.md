# FlameNode Migration Agent Protocol

> Status: Active
> Last verified: 2026-10-06
> Verified against commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Source of truth: `docs/migration/README.md`, `docs/migration/STATUS.md`, current code/test
>
> Claude Code / OpenAI Codex / Google Antigravity 共通の移行実行契約。
> ツール固有ファイルは薄いadapterとし、仕様を複製しない。

## 1. Invocation

### Claude Code

1 task:

```text
/flamenode-migration
```

継続:

```text
/loop /flamenode-migration
```

Adapter:

- `.claude/commands/flamenode-migration.md`
- `.claude/skills/flamenode-migration/SKILL.md`

### OpenAI Codex

Repo skill:

- `.codex/skills/flamenode-migration/SKILL.md`

1 task:

```text
Use the flamenode-migration skill and execute exactly one READY MIG task.
```

継続はCodex Goalを使用してよい。

```text
/goal Continue the FlameNode migration using the flamenode-migration skill and repository migration protocol. Execute exactly one MIG task per iteration, persist STATUS/inventory changes after each task, and stop at any Phase Gate, blocker, or approval-required production action.
```

Goalよりrepositoryの`STATUS.md`を優先する。

### Google Antigravity

Slash command:

```text
/flamenode-migration
```

正本adapter:

- `.agents/workflows/flamenode-migration.md`

補助knowledge:

- `.agents/skills/flamenode-migration/SKILL.md`
- `.agents/rules/flamenode-project.md`

Antigravityではworkflowが`/`コマンド、skillがオンデマンド知識を担当する。
継続実行機能を使う場合も、1 iteration = 1 MIG taskと本書の停止条件を維持する。

### Generic agent

```text
Read docs/migration/AGENT_PROTOCOL.md and execute exactly one READY task from docs/migration/STATUS.md.
```

---

## 2. Canonical read order

毎iteration:

1. `AGENTS.md`
2. `docs/AI_CONTEXT.md` のmigration行
3. `docs/migration/README.md`
4. `docs/migration/STATUS.md`
5. `docs/migration/FUNCTION_INVENTORY.md` のindex
6. **対象domainだけ** `docs/migration/functions/*.md`
7. UI/frontendに触るなら `docs/migration/FRONTEND_FEATURE_INVENTORY.md` の対象section
8. backend/action/API/jobに触るなら `docs/migration/BACKEND_OPTIMIZATION_LEDGER.md` の対象candidate/原則
9. 必要な `ROUTE_MATRIX.md` / `API_MATRIX.md`
10. 対象コードと関連test
11. 必要ならActive文書を追加1件

正本の重複判断が必要な場合のみ `DOC_MAP.md` を読む。
Git branch/PR/merge判断は `GIT_WORKFLOW.md` を読む。

禁止:

- repo全体の無差別再読込
- Historical/archiveの一括投入
- 全function ledgerの毎回読込
- 全frontend/backend ledgerを対象外taskで毎回全文読込
- 前iterationでrepoへ保存済みの事実を理由なく再調査
- tool固有adapterを仕様正本にする
- chat履歴だけをhandoffに使う

---

## 3. One iteration contract

**1 iteration = exactly 1 MIG task.**

### Start

`STATUS.md`から確認:

- Current Phase
- Current/Next Task
- task dependencies
- Phase Gate
- blocker
- owner

`READY` taskがなければ勝手に別taskを選ばない。

Git運用は `GIT_WORKFLOW.md` に従う。

### Claim

対象taskを`IN_PROGRESS`にしownerを記録する。

```text
Task:
Owner: claude | codex | antigravity | other
CURRENT:
TARGET:
Scope:
Non-scope:
Affected function IDs:
Affected route/API IDs:
Frontend-visible contracts:
Backend optimization candidates touched:
Rollback:
Production action required: yes/no
```

### Inventory guard

実装前に:

1. `FUNCTION_INVENTORY.md`から対象function IDを特定
2. 対象domain ledgerだけ読む
3. UI/frontend変更なら`FRONTEND_FEATURE_INVENTORY.md`でユーザー視点の維持契約を確認
4. CURRENT詳細が未監査なら実装前に必要範囲を棚卸し
5. `DETAIL_AUDIT_REQUIRED` / unknown / unverifiedを移行済みにしない
6. 画面リデザインでは画面上の全capabilityをscopeまたはexplicit non-scopeへ分類
7. backendを触る場合、既存構造をそのまま複製する前に共通化/責務分離/CPU/I/O改善余地を確認
8. scope外の最適化候補は実装せず`BACKEND_OPTIMIZATION_LEDGER.md`へ記録

**Visual completion is not functional completion.**

### Frontend preservation priority

backend frameworkや内部構造は変更可能だが、明示承認なしに以下を退化させない。

- user-visible actions
- permissions/availability
- inputs/outputs
- loading/empty/error/forbidden/partial-failure states
- success/error feedback
- URL/navigation/reload/history behavior
- privacy/visibility
- destructive confirmation
- major mobile/keyboard operation reachability

コード行数削減はfrontend behaviorを変える理由にならない。

### Backend improvement obligation

移行はCURRENT backendの写経ではない。

対象コードを読む際に以下を探す:

- duplicate validation / permission / audit
- framework-business coupling
- duplicate public projection
- duplicate post-commit effects
- Queue retry/idempotency inconsistency
- external integration quota/error duplication
- request-time CPU/I/O hotspots
- common domain commands/queries
- unnecessary buffering/serialization

より良い設計が見つかった場合:

- frontend contractを維持できる → `BACKEND_OPTIMIZATION_LEDGER.md`へ候補/evidenceを記録し、active MIG scope内で承認済みなら実装
- frontend変更が必要 → `FRONTEND_DECISION_REQUIRED`として記録し、勝手に変更しない

### Implement

- 1 PR = 1 migration boundaryを原則とする
- CURRENT contractをcode/testから先に固定
- framework-neutral domain logicを優先
- compatibility bridgeを明示
- 新経路導入と同時に旧経路を削除しない
- Big Bang rewrite禁止
- redesignでもfunction coverageを落とさない
- target stackだからという理由だけで新技術を導入しない
- 行数削減そのものを目的に抽象化しない
- security/permission/audit/idempotencyを「共通化」で見えなくしすぎない

### Validate

最低限:

- task Acceptance
- affected function Acceptance
- affected frontend-visible contract
- relevant regression tests
- 必要なCPU/build/UI/security checks
- backend optimizationを主張する場合は、改善根拠とparity evidence

### Finish

必ず以下へ遷移:

- `DONE`
- `REVIEW`
- `BLOCKED`

`IN_PROGRESS`のまま終わらない。

必要に応じて更新:

- `STATUS.md`
- affected `functions/*.md`
- `FUNCTION_INVENTORY.md` totals/index
- `FRONTEND_FEATURE_INVENTORY.md`
- `BACKEND_OPTIMIZATION_LEDGER.md`
- `ROUTE_MATRIX.md`
- `API_MATRIX.md`

Last iteration:

```text
Agent:
Task:
Result:
Affected functions:
Frontend contracts:
Backend optimization findings:
Validation:
PR/commit:
Rollback:
Blockers:
Next:
```

---

## 4. Multi-agent coordination

Claude / Codex / Antigravityを併用してよいが、**Git repositoryだけを共有状態の正本**にする。

### Single writer

1 taskは同時に1 agentだけが`IN_PROGRESS`にする。
他agentはread-only review/auditに回せる。

### Parallel-safe

並列化しやすい:

- read-only inventory
- test audit
- frontend capability audit
- backend duplication/commonization audit
- design comparison
- security review
- CPU/build analysis
- PR review

同時編集を避ける:

- `STATUS.md`
- 同じfunction ledger row
- 同じfrontend contract row
- 同じoptimization candidate
- 同じroute/API matrix row
- 同じdomain service
- DB/auth/permission/visibility core

### Handoff

agent交代前にrepoへ残す:

- state / owner
- findings/evidence
- tests
- frontend behavior confirmed
- optimization candidates found
- blocker
- next action

チャットだけのhandoffは無効。

---

## 5. Continuous execution

Product別の長期実行機構は違っても、論理loopは同じ。

```text
LOOP:
  read STATUS
  select exactly one READY MIG task
  claim
  execute inventory/implementation
  preserve frontend contract
  record backend optimization findings
  validate
  persist STATUS + affected ledgers/matrices
  evaluate stop conditions
```

代表例:

- Claude Code: `/loop /flamenode-migration`
- Codex: `/goal ...` + `flamenode-migration` skill
- Antigravity: `/flamenode-migration` workflowを反復実行、または利用可能な継続実行機能から同workflowを呼ぶ

### Mandatory stop

- Overall State = BLOCKED
- READY taskなし
- Phase GateがREVIEW待ち
- production actionに明示承認が必要
- Remote D1 / secret / Worker Route / Custom Domain変更が必要
- auth/security/permission/visibility仕様が衝突
- test failureがtask scopeを超える
- rollback不能/未証明
- required function inventory coverageが不明
- 別agentが対象taskを所有中
- backend最適化のためfrontend behavior変更が必要で、承認されていない

### Continuous-mode prohibitions

- 複数MIG taskを1回のstate transitionでDONE
- Phase Gate自動承認
- BLOCKEDを飛ばして後Phaseへ進む
- production deploy/routing/secret/Remote D1の自動変更
- progress MD更新なしで次iterationへ進む
- frontend contract変更をbackend refactorへ紛れ込ませる

---

## 6. Redesign contract

UI redesignはmigrationの一部だが、機能削減ではない。

Visual sources:

1. `docs/design-redesign/DESIGN_PRINCIPLES.md`
2. `docs/design-redesign/UX_AUDIT.md`
3. `docs/design-redesign/NAVIGATION.md`
4. `/dev/redesign`
5. `docs/design-redesign/PAGE_COVERAGE.md`
6. `docs/design-redesign/DECISIONS.md`

Functional/behavior sources:

- CURRENT code/tests
- `FUNCTION_INVENTORY.md` + relevant function ledger
- `FRONTEND_FEATURE_INVENTORY.md`
- `ROUTE_MATRIX.md`
- `API_MATRIX.md`

### Screen completion

画面DONE条件:

- visual redesign complete
- responsive states complete
- loading/error/empty/permission/partial-failure states covered
- 全required functionが`PARITY_VERIFIED`または`REMOVED_APPROVED`
- frontend-visible contract parity confirmed
- permissionとserver side effects確認済み
- route/API dependencyが移行済みまたは明示bridgeあり
- current acceptance testまたはreplacement testあり
- direct navigation/reload/history semantics確認済み

見た目のみ完成は`UI_DONE_FUNCTIONS_PENDING`。

---

## 7. Existing-function preservation invariant

Final migrationでは以下を残さない。

```text
UNKNOWN required functions
DETAIL_AUDIT_REQUIRED functions
unverified migrated functions
frontend-visible functions without behavior contract
screens without complete function mapping
legacy actions/routes without disposition
background jobs without disposition
permission rules without parity evidence
side effects without parity evidence
unreported frontend blockers to selected backend optimization
```

機能削除はmigrationに紛れ込ませない。

削除手順:

1. ledger → `REMOVAL_PROPOSED`
2. reason
3. affected users/routes/data
4. exact frontend-visible impact
5. replacement if any
6. explicit Lead/user approval
7. approval後のみ`REMOVED_APPROVED`

---

## 8. Backend optimization decision rule

Phase 0では候補を発見・証拠化する。原則として大規模refactorはしない。

`MIG-0011`で全inventoryを横断し:

1. 重複/複雑性/CPU/I/O候補を整理
2. frontend contractを維持したまま改善できる候補を分類
3. frontend contractが障害となる候補を`FRONTEND_DECISION_REQUIRED`へ分類
4. frontend影響を明示してLead/userへ提示
5. 承認済み候補だけPhase 1/3/6等へ持ち込む

「変更すること」を目的にしない。
CURRENT実装が十分単純/安全なら`DEFERRED`または`REJECTED`でよい。

---

## 9. Completion format

```text
MIG-XXXX: <task>
Agent: <agent>
State: DONE | REVIEW | BLOCKED

Functions:
- FN-...

Frontend contracts:
- preserved: ...
- changed with approval: ...

Backend optimization findings:
- OPT-... | none

Changed:
- ...

Preserved:
- ...

Validation:
- ...

Rollback:
- ...

Progress files updated:
- STATUS.md
- relevant functions/*.md
- FRONTEND_FEATURE_INVENTORY.md (if relevant)
- BACKEND_OPTIMIZATION_LEDGER.md (if relevant)
- ROUTE_MATRIX.md / API_MATRIX.md

Next:
- MIG-YYYY | Phase Gate review | BLOCKED(reason)
```
