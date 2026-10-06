# FlameNode Product Requirements Reconciliation

> Status: Active / requirement preservation source of truth
> Last updated: 2026-10-07
> Applies to: every `/flamenode-migration` task

移行では「今のコード」と「過去/現行の設計文書」のどちらか一方だけを正しいものとして扱わない。
CURRENT productionの挙動を保護しつつ、設計意図を照合し、矛盾を明示して改善候補へ変換する。

## Source precedence

### 1. CURRENT behavior evidence
最優先の事実確認元。

- production/current code
- tests
- DB schema/migrations
- Cloudflare config/bindings/routes
- current operational docs
- actual API/action/job contracts

### 2. Active product/design intent
CURRENT behaviorの意味・背景・未実装要件を確認する入力。

- `AGENTS.md`
- `.claude/flamenode/requirements-map.md`
- `.claude/flamenode/source/flamenode_final_detailed_design.md`
- `.claude/flamenode/source/flamenode_final_consistency_audit.md`
- `docs/operations/ui-acceptance.md`
- `docs/operations/*.md`
- `設計/` の現在参照されている仕様

### 3. Historical/archive material
背景確認専用。CURRENTへ自動復活させない。

## Requirement states

| State | Meaning |
| --- | --- |
| `CURRENT_CONFIRMED` | current code/test/configで観測・確認済み |
| `CURRENT_AUDIT_REQUIRED` | currentに存在する可能性が高いが詳細監査待ち |
| `REQUIREMENT_CONFIRMED` | design intentとCURRENTが一致 |
| `REQUIREMENT_ONLY` | 文書にはあるがCURRENT実装未確認 |
| `CURRENT_DIVERGENCE` | CURRENTが既存設計文書と意図的/実質的に異なる |
| `IMPROVEMENT_CANDIDATE` | UX/保守性/性能改善候補。未承認 |
| `REMOVAL_PROPOSED` | 削除候補。明示承認前は維持 |
| `REMOVED_APPROVED` | 明示承認済み |

## Reconciliation rule

矛盾を見つけた場合:

1. CURRENT code/test/configで実挙動を特定する。
2. 既存設計文書が期待している挙動を記録する。
3. frontend-visible impact、permission、安全性、data影響を比較する。
4. `CURRENT_DIVERGENCE`として記録する。
5. CURRENTを黙って設計文書へ戻さない。
6. 設計文書を黙ってCURRENTへ書き換えない。
7. 変更価値があれば`IMPROVEMENT_CANDIDATE`として提案する。
8. frontend behavior変更を伴う場合はユーザー承認までCURRENT維持をdefaultにする。

## Known reconciliation cautions

### Interaction ownership
古い設計にはActive X IDをinteraction主体として扱う記述がある。一方CURRENTには`videoInteractionsAuth.auth_user_id`を用いる実装がある。

- 古い文書だけを見てX ID ownershipへ戻さない。
- MIG-0003/0004/0008でcurrent identity/permission contractを確定する。
- UI上のActive Xとaccount-owned interactionを混同しない。

### Chapter/comment model
CURRENTは独立した自由コメント欄ではなく、時間付きchapter/comment体験を中心にしている。

- `video_chapters` / chapter UI / current codeを優先して実態確認する。
- historical table/field名を移行先へ復活させない。
- public/private、投稿権限、player seek、reflection delayなどobservable behaviorを維持する。

### UI redesign
以前の`docs/design-redesign`は移行入力から外す。

- 旧mock/旧visual proposalを新UI正本として使わない。
- 新visual targetは後日ユーザーから提供されるHTML mockのみ。
- 詳細は`UI_REFERENCE.md`。

## Preservation contract

明示承認なしで変更しないもの:

- user-visible capabilityの存在
- URL/deep-link/query/history semantics
- role/permission semantics
- owner invariant
- login/session/account linking semantics
- validation/business rules
- destructive action semantics
- public/private visibility
- auditability
- notification/external side effects
- Queue retry/idempotency guarantees
- success/error/pending/degraded states
- data ownership and canonical source

変更可能:

- implementation framework
- module boundaries
- API transport
- data access/query organization
- cache/projection/build strategy
- commonization
- component composition
- visual hierarchy/layout after HTML mock is registered

ただし変更可能領域でもobservable behaviorを壊さない。

## Requirement ledger template

重要な矛盾または要件のみ存在する項目を見つけたら、対象domain ledgerまたはMIG task notesへ以下を記録する。

```text
Requirement:
Source:
State:
CURRENT evidence:
Design intent:
Frontend impact:
Permission/privacy impact:
Data/side-effect impact:
Recommendation:
Approval required:
Related UX IDs:
Related FN IDs:
Migration task:
```

## Phase 0 gate contribution

MIG-0011終了時:

```text
Unresolved CURRENT_DIVERGENCE affecting migration = 0
REQUIREMENT_ONLY without disposition = 0
Intentional feature removals without approval = 0
Frontend-changing optimization blockers without decision = 0
```

要件が不明な場合、簡略化を優先して消すのではなく、`BLOCKED`として保持する。