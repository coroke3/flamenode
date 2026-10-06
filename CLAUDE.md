# CLAUDE.md

> Status: Active
> Last verified: 2026-10-06
> Verified against commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Source of truth: `AGENTS.md`

規範・不変条件・検査の正本は [`AGENTS.md`](AGENTS.md)。タスク別の次の1件は [`docs/AI_CONTEXT.md`](docs/AI_CONTEXT.md)。

## 開始

1. `AGENTS.md`
2. `docs/AI_CONTEXT.md` の該当タスク行
3. 対象コードと関連test
4. migration taskだけ `docs/migration/AGENT_PROTOCOL.md` → `docs/migration/STATUS.md`

`.claude/flamenode/source/`、`archive/`、完了済みphaseは、過去仕様調査を明示されたときだけ読む。

## 役割の選び方

| 状況 | 使うもの |
| --- | --- |
| 調査のみ（コード変更禁止） | `.claude/agents/flamenode-repo-cartographer.md` または `/flamenode-plan` |
| 境界が明確な通常実装 | `.claude/agents/flamenode-implementation-agent.md` |
| DB・権限・security・公開API・破壊的変更のレビュー | `.claude/agents/flamenode-architecture-reviewer.md` または `/flamenode-review` |
| **Next/OpenNextからの段階移行** | **`/flamenode-migration`** |
| **移行を反復実行** | **`/loop /flamenode-migration`** |

軽量モデルの停止条件は `AGENTS.md` を正本とする。

## Migration loop

`/flamenode-migration` は1回につき `docs/migration/STATUS.md` のREADY taskを1つだけ進めるClaude adapter。

共通実行契約の正本は [`docs/migration/AGENT_PROTOCOL.md`](docs/migration/AGENT_PROTOCOL.md)。`.claude/commands/flamenode-migration.md` と `.claude/skills/flamenode-migration/SKILL.md` は薄いadapterであり、仕様正本ではない。

`/loop`併用時も以下を守る。

- 1 iteration = 1 MIG task
- iteration開始/終了stateをSTATUSへ保存
- `IN_PROGRESS`のまま次へ進まない
- Phase Gateを自動承認しない
- production deploy / Worker Route / Custom Domain / Remote D1 / secret操作は明示承認まで停止
- BLOCKEDを無視して後続Phaseへ進まない
- redesign画面をfunction parity未確認のままDONEにしない

## 出力

通常実装:

- 実装前: 対象・非対象・変更予定・検査予定を短く
- 実装後: 変更・維持した挙動・検査・残課題だけ

migration:

- MIG task ID / state
- affected function IDs
- 変更
- 維持したcontract
- 検査
- rollback
- next task / blocker
