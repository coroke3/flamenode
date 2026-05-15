# /flamenode-review

FlameNode実装後の最終レビューコマンド。

## 実行内容

次を読む。

1. `CLAUDE.md`
2. `claude-code-subagent-assignment.md`
3. `.claude/flamenode/README.md`
4. `.claude/flamenode/requirements-map.md`
5. `.claude/flamenode/phases/09-final-review.md`
6. `.claude/flamenode/source/flamenode_final_detailed_design.md`
7. `.claude/flamenode/source/flamenode_final_implementation_checklist.md`
8. `.claude/flamenode/source/flamenode_final_consistency_audit.md`

その上で、現在の差分を4原典に照らしてレビューしてください。

## 推奨モデル

Opus。

## 必ず確認するコマンド

```sh
npm run typecheck
npm run build
```

DB変更がある場合は、package.jsonを見てDB migrationコマンドも確認してください。

## ブロッカー

以下がある場合はマージ不可。

- フロントだけで権限制御している。
- API直叩きで権限なし更新ができる。
- Discord IDとX IDの主体が混ざっている。
- 未承認X IDで投稿・チャプターコメント・いいね・セーブ・ライブラリができる。
- owner_discord_user_idだけで作品編集できる。
- contact_x_id自由入力で即公開できる。
- 連続枠の部分解放・拡張でグループ整合性が壊れる。
- submitted枠を通常解放できる。
- 部番号が前方追加や休憩閾値で再計算されない。
- video_commentsを新規利用している。
- marker_kind依存の分岐を増やしている。
- 公開APIで内部情報を返している。
- build/typecheckが通らない。

## 出力

```md
# FlameNode 最終レビュー

## 結論
- マージ可 / 要修正 / 追加調査

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
