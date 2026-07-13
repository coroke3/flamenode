# CLAUDE.md

> Status: Active
> Last verified: 2026-07-13
> Source of truth: `AGENTS.md`

正本は `AGENTS.md`。まずそれを読む。以下は Claude Code 固有の追記のみ。

## サブエージェント / コマンド

- `.claude/agents/`: `flamenode-repo-cartographer` (調査) / `flamenode-implementation-agent` (実装) / `flamenode-architecture-reviewer` (レビュー)
- `.claude/commands/`: `/flamenode-plan`, `/flamenode-review`
- ルーティング: `.claude/flamenode-subagent-routing.yaml`

## モデル割当

- 調査・一覧化: Haiku
- 通常実装: Sonnet
- ID / 権限 / DB / 連続枠 / security / 公開 API / 仕様衝突 / 最終レビュー: Opus
