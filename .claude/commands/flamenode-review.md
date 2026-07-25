# /flamenode-review

現在の差分を、現行コード・不変条件・test に照らしてレビューする。高リスク時は `flamenode-architecture-reviewer` と同じマージ不可基準を使う。

## 読むもの

1. `AGENTS.md`
2. `docs/AI_CONTEXT.md` の該当タスク行
3. 変更差分、対象コード、関連 test
4. 必要な Active 文書

## 確認順

1. 依頼範囲外の変更がないか。
2. 既存挙動が維持されているか。
3. UI迂回時も権限が守られるか。
4. DB・owner・監査・公開APIの不変条件を破らないか。
5. Active 文書がコードと一致するか。
6. 必要な検査が成功しているか。

## マージ不可

`AGENTS.md` 不変条件違反。詳細リストは `.claude/agents/flamenode-architecture-reviewer.md` §マージ不可。

## 出力

```md
## 結論
- マージ可 / 要修正 / 追加調査
## ブロッカー
| ファイル | 問題 | 影響 | 修正 |
| --- | --- | --- | --- |
## 非ブロッカー
## 検査結果
## 残余リスク
```
