# Phase 2: 投稿フロー・YouTube ID正規化

## 目的

枠なし投稿・枠あり投稿の条件を整理し、YouTube URLではなく動画IDを正として保存する。

## 推奨モデル

- 実装: Sonnet
- 公開状態や審査方針が衝突する場合: Opus

## 対応要求ID

D-1〜D-7、E-1〜E-6、G-1、G-2、G-3、J-4、J-5、J-6、J-10、O-3、O-5

## 必須仕様

### 枠なし投稿

条件:

- ログイン済み
- BANなし
- TOS同意済み
- CostGuardで投稿可能
- 連携済みActive X IDあり
- Active X IDが承認済み

結果:

- `status = public`
- `scheduling_type = manual`
- `creator_id = Active X ID`
- `owner_discord_user_id = DiscordユーザーID`

禁止:

- `contact_x_id` 自由入力を投稿主体にする
- 未連携X IDを自動作成して即公開する
- Active X IDなしで投稿する

### 枠あり投稿

- 未承認X IDでは枠確保のみ可能
- 作品提出には承認済みActive X IDが必要
- 作品は原則pending開始
- 連続枠グループに紐づく場合はグループ内枠をsubmittedへ更新

### YouTube ID

- DBではYouTube動画IDを正とする
- URL、短縮URL、ID入力を受け付け、内部でIDへ正規化
- YouTube側unlistedはFlameNode内public相当
- FlameNode内部statusのunlistedとは混同しない

## 実装前に出す計画

```md
# Phase 2 実装計画

## 変更対象ファイル

## 投稿経路一覧
| 経路 | 現行仕様 | 修正後仕様 | 対応要求ID |
|---|---|---|---|

## YouTube ID正規化設計

## contact_x_id自由入力を無効化する箇所

## テスト計画
```

## 実装後チェック

- [ ] 枠なし投稿は連携済みActive X ID必須
- [ ] 枠なし投稿は承認済みX ID必須
- [ ] 条件を満たせば即public
- [ ] contact_x_id自由入力で即公開できない
- [ ] 未連携X IDを自動作成して即公開しない
- [ ] 枠あり提出は承認済みActive X ID必須
- [ ] YouTube IDはURLではなくIDとして保存
- [ ] YouTube側unlistedでもFlameNode内publicなら通常公開扱い

## PR名

`posting/youtube-id-and-active-x`
