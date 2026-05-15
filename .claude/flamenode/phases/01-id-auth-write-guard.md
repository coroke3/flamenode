# Phase 1: ID・権限・共通書き込みガード

## 目的

Discord ID / X ID / Active X ID の責務を分離し、投稿・編集・枠提出・いいね・セーブ・ライブラリ・チャプターコメントなど全書き込み操作を共通ガードに通す。

## 推奨モデル

- 実装: Sonnet
- 境界判断・権限拡張・現行実装との衝突: Opus
- Haiku禁止: 仕様判断、権限判断、DB変更

## 対応要求ID

B-1〜B-7、D-6、E-1〜E-6、G-1〜G-7、O-1〜O-5、P-4、N-3〜N-6

## 必須仕様

- Discord IDはログイン、通知、BAN、TOS、admin/moderator、Discord連絡の主体。
- X IDは作品作者、プロフィール、アイコン、いいね、セーブ、ライブラリ、チャプターコメント投稿者、イベント運営者表示の主体。
- Active X IDは現在どのX IDとして操作しているかを示す。
- Active X ID切替で、作品一覧、いいね、セーブ、ライブラリ、再生リスト、アイコン候補、プロフィール編集対象、枠確保名義、投稿作者、チャプターコメント投稿者が切り替わる。
- ログイン状態、BAN、TOS、admin role、通知先DiscordユーザーはActive X ID切替で変わらない。
- 未承認X IDで許可されるのは枠確保のみ。
- 投稿、編集、いいね、セーブ、ライブラリ、チャプターコメント、枠提出は承認済みActive X IDを必要に応じて要求する。
- owner_discord_user_idだけで作品編集を許可しない。
- UI disabledだけでなくServer Action / Route Handler側で必ず拒否する。
- canEditVideoのrequiredKey省略で広い権限を与えない。セクション単位でrequiredKeyを明示する。
- CurrentUserまたは共通ContextでTOS状態を見られるようにする。

## 実装前に出す計画

```md
# Phase 1 実装計画

## 変更対象ファイル

## 追加・修正する共通ガード

## 書き込み操作ごとのガード適用表
| 操作 | 必要条件 | ガード関数 | サーバー側チェック箇所 | UI側チェック箇所 |
|---|---|---|---|---|

## 権限を緩める可能性がある箇所

## Opus判断が必要な箇所

## テスト計画
```

## 実装後チェック

- [ ] Discord IDとX IDの責務が混ざっていない
- [ ] Active X ID切替で対象データが切り替わる
- [ ] いいね/セーブ/ライブラリがX ID単位
- [ ] owner_discord_user_idだけで編集許可していない
- [ ] 未承認X IDは枠確保のみ
- [ ] BAN/TOS/CostGuardが書き込み操作に効く
- [ ] UI disabledだけでなくサーバー側でも拒否している
- [ ] CurrentUserまたは共通ContextでTOS状態を見られる

## PR名

`auth/id-write-guard`
