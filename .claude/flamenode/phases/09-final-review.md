# Phase 9: 最終レビュー・マージ判定

## 目的

実装差分が4つの原典要求を抜け漏れなく満たしているか確認し、マージ可能か判定する。

## 推奨モデル

- 最終レビュー: Opus
- build/typecheck結果の要約: Haiku可
- 修正: Sonnet

## 必ず読むファイル

- `/CLAUDE.md`
- `/claude-code-subagent-assignment.md`
- `/.claude/flamenode/README.md`
- `/.claude/flamenode/requirements-map.md`
- `/.claude/flamenode/source/flamenode_final_detailed_design.md`
- `/.claude/flamenode/source/flamenode_final_implementation_checklist.md`
- `/.claude/flamenode/source/flamenode_final_consistency_audit.md`
- 該当フェーズファイル

## 最終確認コマンド

```sh
npm run typecheck
npm run build
```

DB変更がある場合は、package.jsonに定義されたDB migrationコマンドを確認して実行する。

```sh
cat package.json
```

## 原典カバレッジ確認

PR本文に以下を含める。

```md
## 対応した要求ID

## 対応しない要求ID
- 今回のPR範囲外: ...

## Opus判断が必要な要求ID

## 4原典の反映確認
- [ ] flamenode_final_detailed_design.md
- [ ] flamenode_final_implementation_checklist.md
- [ ] flamenode_final_consistency_audit.md
- [ ] flamenode_revision_instructions_answered.md / requirements-map.md
```

## ブロッカー

以下が1つでもある場合はマージ不可。

- フロントだけで権限制御している。
- API直叩きで権限なし更新ができる。
- Discord IDとX IDの主体が混ざっている。
- 未承認X IDで投稿、チャプターコメント、いいね、セーブ、ライブラリができる。
- owner_discord_user_idだけで作品編集できる。
- contact_x_id自由入力で即公開できる。
- 連続枠の部分解放・拡張でグループ整合性が壊れる。
- submitted枠を通常解放できる。
- 部番号が前方追加や休憩閾値で再計算されない。
- video_commentsを新規利用している。
- marker_kind依存の分岐を増やしている。
- 公開APIで内部情報を返している。
- health/securityチェック項目が未実装のまま、実装済み扱いになっている。
- build/typecheckが通らない。

## 最終レビュー出力形式

```md
# Phase 9 最終レビュー

## 結論
- マージ可 / 要修正 / Opus再判断

## 実行コマンド

## 4原典カバレッジ
| 原典 | 反映状況 | 不足 |
|---|---|---|

## 要求IDカバレッジ
| 要求ID | 状態 | 備考 |
|---|---|---|

## ブロッカー

## 非ブロッカー

## 次PRへ回してよい項目

## 修正指示
```
