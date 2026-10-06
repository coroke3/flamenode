# FlameNode Migration Agent Protocol

> Status: Active
> Last verified: 2026-10-06
> Verified against commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Source of truth: `docs/migration/README.md`, `docs/migration/STATUS.md`, current code/test
>
> Claude Code / OpenAI Codex / Google Antigravity 共通の移行実行契約。
> ツール固有ファイルにはこの内容を複製せず、この文書を参照させる。

## 1. Invocation adapters

### Claude Code

```text
/flamenode-migration
```

adapter: `.claude/commands/flamenode-migration.md`

### OpenAI Codex

repo skill:

```text
flamenode-migration
```

adapter: `.codex/skills/flamenode-migration/SKILL.md`

明示する場合:

```text
Use the flamenode-migration skill and execute the next READY migration task.
```

### Google Antigravity

workspace skill:

```text
/flamenode-migration
```

adapter: `.agents/skills/flamenode-migration/SKILL.md`

必要なら `/agents` から `flamenode-migration` workspace agentを選択してもよい。

### Generic agent

root `AGENTS.md` を読めるエージェントは、次の依頼で同じプロトコルを実行できる。

```text
Read docs/migration/AGENT_PROTOCOL.md and execute exactly one READY task from docs/migration/STATUS.md.
```

---

## 2. Canonical read order

毎iterationで以下を順番に読む。

1. `AGENTS.md`
2. `docs/AI_CONTEXT.md` のmigration行
3. `docs/migration/README.md`
4. `docs/migration/STATUS.md`
5. `docs/migration/FUNCTION_INVENTORY.md`
6. taskに応じて `ROUTE_MATRIX.md` / `API_MATRIX.md`
7. 対象コードと関連test
8. 必要なActive文書を追加1件まで

禁止:

- repo全体の無差別読み直し
- Historical/archiveの一括投入
- 前iterationで確定した事実を毎回再調査
- tool固有adapterを仕様正本として扱うこと

---

## 3. One iteration contract

**1 iteration = 1 MIG task。**

### Start

`STATUS.md`から確認:

- Current Phase
- Next Task
- dependencies
- Phase Gate
- blockers

Next TaskがREADYでなければ別taskを勝手に選ばない。

### Claim

対象taskを`IN_PROGRESS`へ更新し、以下を固定する。

```text
Task:
CURRENT:
TARGET:
Scope:
Non-scope:
Affected function IDs:
Affected route/API IDs:
Rollback:
Production action required: yes/no
```

### Inventory guard

実装前に `FUNCTION_INVENTORY.md` を確認する。

- 対象機能IDを列挙する。
- 既存機能が未棚卸しなら、先にinventoryを補完する。
- `UNKNOWN` / `UNVERIFIED` の機能を移行済み扱いしない。
- 画面を作り直す場合、その画面の全機能IDをmigration scopeまたはexplicit non-scopeへ分類する。
- 「見た目が完成した」を機能parity完了とみなさない。

### Implement

原則:

- 1 PR = 1 migration boundary
- CURRENT contractをtest/codeから先に固定
- framework-neutral domainを優先
- compatibility bridgeを明示
- legacy pathを同時削除しない
- Big Bang rewrite禁止
- redesignと機能移行を同時に行う場合もfunction coverageを落とさない

### Validate

対象taskのAcceptance + 対応するfunction acceptanceを実行する。

### Finish

対象taskを必ず次のどれかへ遷移:

- `DONE`
- `REVIEW`
- `BLOCKED`

`IN_PROGRESS`のままiterationを終了しない。

更新対象:

- `STATUS.md`
- `FUNCTION_INVENTORY.md`（coverage/stateが変わる場合）
- `ROUTE_MATRIX.md` / `API_MATRIX.md`（該当時）

Last iteration:

```text
Agent: Claude | Codex | Antigravity | Other
Task:
Result:
Affected functions:
Validation:
PR/commit:
Rollback:
Blockers:
Next:
```

---

## 4. Multi-agent coordination

Claude / Codex / Antigravityを同時利用してよいが、**progress source of truthはGit repoだけ**にする。

### Ownership

1 taskは同時に1 agentだけが`IN_PROGRESS`にする。

推奨:

```text
Owner: claude
Owner: codex
Owner: antigravity
```

をSTATUSのcurrent task detailへ記録する。

### Parallel work

並列化してよい:

- read-only inventory
- test audit
- design comparison
- independent review
- CPU/build measurement analysis

同時編集を避ける:

- `STATUS.md`
- same domain service
- same matrix rows
- same route implementation
- DB/auth/visibility core

複数agentが分析した場合、Lead task ownerが結果を統合する。

### Handoff

agent交代時にチャット履歴へ依存しない。

必ずrepoへ残す:

- task state
- findings
- tests
- blocker
- next action

「前のagentが知っている」は無効。

---

## 5. `/loop` contract

`/loop`を使えるagentでは、本プロトコルをiteration bodyとして使う。

```text
LOOP:
  read STATUS
  execute exactly one READY MIG task
  validate
  update STATUS + inventories
  stop on gate/blocker/approval
```

停止条件:

- Overall State = BLOCKED
- Next Task無し
- Phase Gate = REVIEW
- production操作に明示承認が必要
- Remote D1 / secret / Worker Route / Custom Domain変更が必要
- auth/security/permission/visibilityで仕様衝突
- test failureがtask scopeを超える
- rollback不能
- function inventory coverageが不明

禁止:

- 複数taskをまとめてDONE
- Phase Gate自動承認
- BLOCKED迂回
- production deploy自動実行
- STATUS更新なしで次iteration

---

## 6. Redesign contract

UI redesignはmigrationの一部だが、機能削減ではない。

参照:

1. `docs/design-redesign/DESIGN_PRINCIPLES.md`
2. `docs/design-redesign/UX_AUDIT.md`
3. `docs/design-redesign/NAVIGATION.md`
4. `/dev/redesign`
5. `docs/design-redesign/PAGE_COVERAGE.md`
6. `docs/design-redesign/DECISIONS.md`
7. `docs/migration/FUNCTION_INVENTORY.md`

### Screen completion

画面をDONEにする条件:

- visual redesign complete
- responsive states complete
- loading/error/empty/permission states complete
- associated function IDs are `PARITY_VERIFIED` or intentionally `REMOVED_APPROVED`
- permission/server side-effects verified
- route/API dependencies migrated or explicit bridge exists
- current acceptance tests pass or replacement tests exist

画面の見た目だけ完成した状態は`UI_DONE_FUNCTIONS_PENDING`とする。

---

## 7. Function preservation invariant

移行完了条件:

```text
No UNKNOWN functions
No UNVERIFIED required functions
No screen with uncovered function IDs
No legacy action/route without disposition
No background job without disposition
No permission rule without parity evidence
No side effect without parity evidence
```

既存機能を削除する場合は、削除を「移行」として暗黙処理しない。

必須:

- inventory rowを`REMOVAL_PROPOSED`
- reason
- affected users/routes/data
- replacement if any
- explicit approval
- approval後のみ`REMOVED_APPROVED`

---

## 8. Tool-neutral completion format

```text
MIG-XXXX: <task>
Agent: <agent>
State: DONE | REVIEW | BLOCKED

Functions:
- FN-...

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
- FUNCTION_INVENTORY.md
- ROUTE_MATRIX.md / API_MATRIX.md

Next:
- MIG-YYYY | Phase Gate review | BLOCKED(reason)
```
