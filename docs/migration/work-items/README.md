# Per-task migration checkpoints

`STATUS.md` はmerge済みのtask/dependency/Phase状態の正本。`work-items/MIG-XXXX.md` はopen PR上の1taskのlive checkpointの正本。1 wakeごとに変更するのはtask固有ファイルだけ。前提taskがmainへmergeされるまで、下流taskを開始しない。

## Procedure

1. 最新mainのSTATUS、OPEN_DECISIONS、open migration PRと保有pathを確認。依存がDONEのREADYのみclaim。Draft PRの作成前後で同一MIGの重複PRを検索（Draft PRはatomic lockではない）。
2. 1 MIG = 1 short-lived branch = 1 draft PR。branch上に`work-items/MIG-XXXX.md`を作り、Owner/PR/既知のHead/Owned paths/現在unitを記録する。
3. 毎wake同じPRへcheckpoint、実テスト結果、blocker、nextをpush。**途中ではSTATUSを書き換えない。** 他taskのwork-itemや同一共有台帳行を編集しない。
4. 全unit終了でREVIEW、CIと独立review。高リスクtaskは別途人間承認。SHA変更後は必要な再レビュー。
5. merge直前に最新mainへ同期し、該当MIGのDONEと依存を解消したREADYだけをSTATUSへ反映する。共有台帳と検証を再実行してsquash merge。次wakeでmainの結果を再確認する。

重複pathの並列書き込みは禁止。並列例外でも各agentは独立したtaskファイルを所有する。手続きの正本は `../GIT_WORKFLOW.md`。PRの状態とCI/レビュー結果はGitHubの現物を確認し、MDだけで完了と判断しない。

## Checkpoint format

```markdown
# MIG-XXXX — task title
Task: MIG-XXXX
State: IN_PROGRESS
Owner: claude
Branch: migration/mig-xxxx-short-scope
PR: #123
Head: <40 hex SHA of previously existing source commit>
Owned paths: src/a.ts; packages/domain/src/a.ts
Current unit: U01
Validation: node --test ... — PASS (real evidence)
Evidence: PR review and CI URLs (or none before review)
Rollback: close PR or git revert squash commit; include data/route concerns
Next: next concrete bounded unit and resume condition

## Scope
In-scope/out-of-scope, UX/FN, acceptance.

## Checkpoints
Timestamp, actual tested commit/commands/results, blockers, handoff.
```

For `READY` (unclaimed), Owner/Branch/PR/Head/Owned paths/Current unit may be `none`. Never invent a future SHA/PR/CI result. `Head` is the last real source commit **before** the checkpoint commit, not the self-referential commit SHA.

`node scripts/check-migration-work-items.mjs` validates local checkpoint structure and duplicate declared ownership. It cannot inspect remote PRs, CI or reviews.