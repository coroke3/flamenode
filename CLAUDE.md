# CLAUDE.md

> Status: Active
> Last verified: 2026-07-14
> Verified against commit: `6dbe07a`
> Source of truth: `AGENTS.md`

共通規則は`AGENTS.md`へ集約する。作業開始時は次だけを読む。

1. `AGENTS.md`
2. `docs/AI_CONTEXT.md`の該当タスク行
3. 対象コードと関連test

`.claude/flamenode/source/`、`archive/`、完了済みphase資料は、過去仕様の調査を明示された場合だけ読む。

## エージェント

- 調査: `.claude/agents/flamenode-repo-cartographer.md`
- 実装: `.claude/agents/flamenode-implementation-agent.md`
- 高リスクレビュー: `.claude/agents/flamenode-architecture-reviewer.md`
- 計画: `/flamenode-plan`
- レビュー: `/flamenode-review`

## モデル割当

- Luna / Haiku等の軽量モデル: 検索、一覧化、単純置換、限定的な文書修正、test結果整理
- Terra / Sonnet等の中位モデル: 境界が明確な通常実装、局所リファクタ
- Sol / Opus等の上位モデル: DB、認証・認可、security、公開API、破壊的変更、仕様衝突、最終レビュー

軽量モデルは次の場合に実装を断定しない。

- 正本が一意に決まらない
- 変更が3領域以上へ波及する
- migration、権限緩和、データ削除、公開項目追加を含む
- 既存testと依頼が衝突する

## 出力

実装前は対象、非対象、変更予定、検査予定を短く示す。実装後は変更、維持した挙動、検査結果、残課題だけを報告する。
