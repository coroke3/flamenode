# CLAUDE.md

このリポジトリでClaude Codeを使う場合は、最初にこのファイルを読むこと。

## 最重要

FlameNodeの修正作業では、次の正本を必ず参照する。

1. `claude-code-subagent-assignment.md`
2. `.claude/flamenode/README.md`
3. `.claude/flamenode/source/flamenode_final_detailed_design.md`
4. `.claude/flamenode/source/flamenode_final_implementation_checklist.md`
5. `.claude/flamenode/source/flamenode_final_consistency_audit.md`

この5つは、Claude Codeが実装を進めるための入口である。

## 4つの原典について

今回の実装方針は、以下4ファイルの内容を抜け漏れなく反映する必要がある。

- `flamenode_final_detailed_design.md`
- `flamenode_final_implementation_checklist.md`
- `flamenode_final_consistency_audit.md`
- `flamenode_revision_instructions_answered.md`

このうち、前3つは `.claude/flamenode/source/` に原典として格納済み。4つ目の長大な回答反映版は、`claude-code-subagent-assignment.md` と `.claude/flamenode/README.md` 以下の分割命令に反映済みとして扱う。ただし、実装前レビューでは Appendix A の全領域 A〜Q が欠けていないか必ず確認する。

## 作業の基本順序

1. いきなり実装しない。
2. まず `.claude/flamenode/README.md` を読む。
3. Phase 0 の調査を実施する。
4. PR分割案を出す。
5. 最初の実装PRは `auth/id-write-guard` から始める。
6. 1PRで1テーマだけ触る。
7. `npm run typecheck` と `npm run build` を実行する。
8. 最終レビューで `.claude/flamenode/source/flamenode_final_implementation_checklist.md` をすべて確認する。

## モデル選択

- 探索・一覧化・単純な要約だけ Haiku。
- 通常実装は Sonnet。
- ID/権限/DB/連続枠/security/公開API/仕様衝突/最終レビューは Opus。

## 絶対禁止

- フロントだけで権限を守ったことにする。
- API直叩きで更新できる穴を残す。
- Discord IDとX IDを混同する。
- owner_discord_user_idだけで作品編集を許可する。
- 未承認X IDで投稿・チャプターコメント・いいね・セーブ・ライブラリを許可する。
- contact_x_id自由入力を投稿主体にする。
- 連続枠を表示だけでまとめ、DB整合性を放置する。
- video_commentsを新規利用する。
- marker_kind依存の分岐を増やす。
- 公開APIで内部情報を返す。
- 未実装機能を実装済みのように見せる。

## 推奨開始プロンプト

```text
まずコード変更はしないでください。
CLAUDE.md、claude-code-subagent-assignment.md、.claude/flamenode/README.md、.claude/flamenode/source/ の原典3ファイルを読んでください。
その上で、Phase 0として関連ファイル地図、PR分割案、最初に着手すべき最小PRを出してください。
4つの原典の内容が抜け漏れなく反映されるかも同時に確認してください。
```
