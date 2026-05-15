# Phase 5: チャプターコメント統合

## 目的

独立コメント欄を廃止し、コメントを必ず動画内時刻に紐づくチャプターコメントとして扱う。

## 推奨モデル

- 実装: Sonnet
- 既存コメント移行や公開範囲判断: Opus

## 対応要求ID

H-1〜H-8、G-1、E-1〜E-6、I-1、J-1〜J-3、N-5、O-2

## 必須仕様

- 独立コメント欄を作らない。
- `video_comments` は新規UI/APIで使わない。
- コメント本文はチャプター側の `note` として扱う。
- コメントは必ず時刻に紐づく。
- MVPでは1チャプターに複数コメントをぶら下げない。
- 返信・スレッドは作らない。
- チャプター種別はMVPでは分けず、すべてチャプターコメントとして扱う。
- `marker_kind` に依存した分岐を増やさない。必要なら固定値扱い。
- 投稿条件:
  - ログイン済み
  - BANなし
  - TOS同意済み
  - CostGuardで投稿可能
  - Active X IDあり
  - Active X ID承認済み
  - 対象動画がFlameNode内publicまたはunlisted
- YouTube側unlistedでFlameNode内publicなら投稿可。
- privateは投稿者本人、作品作者、admin、許可運営者のみ表示。
- スマホでは動画下に表示。
- PCでは右レールまたは動画横に表示。

## 実装前に出す計画

```md
# Phase 5 実装計画

## 変更対象ファイル

## 廃止・非使用にする独立コメント経路

## チャプターコメントのデータ設計

## 投稿・編集・削除権限

## 表示権限

## モバイル/PC表示方針

## テスト計画
```

## 実装後チェック

- [ ] 独立コメント欄がない
- [ ] video_commentsを新規利用していない
- [ ] コメントは必ず時刻に紐づく
- [ ] noteが本文として扱われる
- [ ] 返信・スレッドを作っていない
- [ ] 未承認X IDでは投稿不可
- [ ] BAN/TOS/CostGuardが効く
- [ ] public/unlisted以外には投稿不可
- [ ] YouTube側unlistedかつFlameNode内publicには投稿可
- [ ] private表示範囲が守られている
- [ ] marker_kindに依存した分岐を増やしていない

## PR名

`comments/chapter-comments-only`
