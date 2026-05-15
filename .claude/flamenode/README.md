# FlameNode Claude Code 実装インデックス

このディレクトリは、Claude CodeがFlameNode修正を実行しやすいように分割した命令セットである。

## 0. 読む順番

Claude Codeは、作業開始時に次の順で読むこと。

1. `/CLAUDE.md`
2. `/claude-code-subagent-assignment.md`
3. `/.claude/flamenode/README.md`
4. `/.claude/flamenode/source/flamenode_final_detailed_design.md`
5. `/.claude/flamenode/source/flamenode_final_implementation_checklist.md`
6. `/.claude/flamenode/source/flamenode_final_consistency_audit.md`
7. `/.claude/flamenode/requirements-map.md`
8. 必要なフェーズファイル

## 1. 4つの原典の扱い

今回の実装方針は、次の4ファイルを抜け漏れなく反映する。

| 原典 | 役割 | このリポジトリ内での反映先 |
|---|---|---|
| flamenode_final_detailed_design.md | ID・権限・投稿・スロット・部番号・チャプターコメント・公開API・health/securityの最終設計 | `.claude/flamenode/source/flamenode_final_detailed_design.md` / `claude-code-subagent-assignment.md` |
| flamenode_final_implementation_checklist.md | 実装完了判定・PR確認・マージ前確認 | `.claude/flamenode/source/flamenode_final_implementation_checklist.md` / `.claude/flamenode/checklists/final-gate.md` |
| flamenode_final_consistency_audit.md | 現行GitHub実装との矛盾精査・注意点 | `.claude/flamenode/source/flamenode_final_consistency_audit.md` / `.claude/flamenode/checklists/consistency-gate.md` |
| flamenode_revision_instructions_answered.md | 回答反映済みの116項目、A〜Qの全要求、NO項目の代替方針、保留事項 | `.claude/flamenode/requirements-map.md` / フェーズ別ファイル |

## 2. Claudeが実装前に必ず出すもの

コード変更前に、Claudeは必ず次を出す。

1. 読んだファイル一覧
2. 関連ファイル地図
3. PR分割案
4. どの原典のどの要求に対応するかのカバレッジ表
5. Opus判断が必要な箇所
6. まず触る最小PR

## 3. 作業フェーズ

| Phase | ファイル | 主担当 | 内容 |
|---:|---|---|---|
| 0 | `phases/00-repo-cartography.md` | Haiku/Sonnet | 現状調査・ファイル地図 |
| 1 | `phases/01-id-auth-write-guard.md` | Sonnet/Opus | ID・権限・共通書き込みガード |
| 2 | `phases/02-posting-youtube-id.md` | Sonnet | 投稿フロー・YouTube ID正規化 |
| 3 | `phases/03-slots-part-numbering.md` | Sonnet/Opus | 連続枠・部番号 |
| 4 | `phases/04-interactions-library.md` | Sonnet | いいね・セーブ・ライブラリ |
| 5 | `phases/05-chapter-comments.md` | Sonnet | チャプターコメント統合 |
| 6 | `phases/06-public-api-health-security.md` | Sonnet/Opus | 公開API・health/security |
| 7 | `phases/07-ui-ux-forms.md` | Sonnet | UI/UX・入力UI |
| 8 | `phases/08-db-legacy-ops.md` | Sonnet/Opus | DB整理・旧データ・危険操作 |
| 9 | `phases/09-final-review.md` | Opus | 最終レビュー |

## 4. モデル割当

- 探すだけ: Haiku
- 通常実装: Sonnet
- 設計判断、権限、DB、連続枠、security、公開API、最終レビュー: Opus

## 5. PR分割

1. `docs/implementation-plan`
2. `auth/id-write-guard`
3. `posting/youtube-id-and-active-x`
4. `slots/reservation-groups`
5. `slots/part-numbering`
6. `interactions/x-id-library`
7. `comments/chapter-comments-only`
8. `api/public-whitelist`
9. `admin/health-security`
10. `ui/navigation-entry-forms`
11. `db/cleanup-legacy-import`
12. `ops/notifications-workers-audit`

## 6. 作業開始プロンプト

```text
コード変更はまだしないでください。
CLAUDE.md、claude-code-subagent-assignment.md、.claude/flamenode/README.md、.claude/flamenode/source/、.claude/flamenode/requirements-map.md を読んでください。
4つの原典の要求が抜け漏れなく反映されているか確認し、Phase 0として関連ファイル地図とPR分割案を出してください。
```
