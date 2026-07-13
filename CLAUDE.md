# CLAUDE.md

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `d4d5432`
> Source of truth: `AGENTS.md`

共通の正本、変更規則、検証コマンドは`AGENTS.md`へ集約する。まず`AGENTS.md`を読み、このファイルにはClaude Code固有の設定だけを記載する。

## サブエージェント / コマンド

- `.claude/agents/`: `flamenode-repo-cartographer`（調査）、`flamenode-implementation-agent`（実装）、`flamenode-architecture-reviewer`（レビュー）
- `.claude/commands/`: `/flamenode-plan`、`/flamenode-review`
- ルーティング: `.claude/flamenode-subagent-routing.yaml`

## モデル割当

- 調査・一覧化: Haiku
- 通常実装: Sonnet
- ID、権限、DB、連続枠、security、公開API、仕様衝突、最終レビュー: Opus
