# CLAUDE.md

> Status: Active
> Last verified: 2026-07-25
> Verified against commit: `dc46eefa`
> Source of truth: `AGENTS.md`

規範・不変条件・検査の正本は [`AGENTS.md`](AGENTS.md)。タスク別の次の1件は [`docs/AI_CONTEXT.md`](docs/AI_CONTEXT.md)。

## 開始

1. `AGENTS.md`
2. `docs/AI_CONTEXT.md` の該当タスク行
3. 対象コードと関連 test

`.claude/flamenode/source/`、`archive/`、完了済み phase は、過去仕様調査を明示されたときだけ。

## 役割の選び方

| 状況 | 使うもの |
| --- | --- |
| 調査のみ（コード変更禁止） | `.claude/agents/flamenode-repo-cartographer.md` または `/flamenode-plan` |
| 境界が明確な通常実装 | `.claude/agents/flamenode-implementation-agent.md` |
| DB・権限・security・公開API・破壊的変更のレビュー | `.claude/agents/flamenode-architecture-reviewer.md` または `/flamenode-review` |

軽量モデルの停止条件は `AGENTS.md` §モデル選択と停止。

## 出力

実装前: 対象・非対象・変更予定・検査予定を短く。  
実装後: 変更・維持した挙動・検査・残課題だけ。
