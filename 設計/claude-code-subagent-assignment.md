# FlameNode Claude Code サブエージェント割当ファイル

作成日: 2026-05-15
対象リポジトリ: `coroke3/flamenode`

このファイルは、FlameNode の大規模修正を Claude Code で進めるときに、メインエージェントがサブエージェントへ作業を割り振るための指示書である。

## 0. このファイルの役割

- 実装そのものの仕様正本ではなく、作業分解・モデル選択・レビュー順序の正本として扱う。
- 実装仕様は、既存の `設計/` 配下ドキュメント、修正指示書、詳細設計、チェックリスト、現行コードを照合して決める。
- Claude Code のメインエージェントは、このファイルを読んだうえで、作業内容ごとに適切なサブエージェントとモデルを選ぶ。
- 迷った場合は、安いモデルで突っ込ませず、Sonnet 以上に上げる。権限・DB・セキュリティ・連続枠はケチらない。

## 1. モデル選択の基本方針

### 1-1. 原則

- **基本は Sonnet**。
- **本当に簡単な読み取り・整理・文言修正だけ Haiku**。
- **メインエージェント、設計判断、矛盾解消、難所レビューは Opus**。
- Haiku は節約用であり、仕様判断・DB変更・権限変更・セキュリティ判断には使わない。
- Sonnet が2回連続で原因を特定できない、または修正が堂々巡りになったら Opus に上げる。

### 1-2. Haiku に渡してよい作業

Haiku は、次のような低リスク作業に限定する。

- ファイル探索、grep、該当箇所候補の列挙
- 既存ドキュメントの目次化
- 実装対象ファイルの候補リスト作成
- UI文言の単純な置換案
- Markdownチェックリスト化
- 既存テストコマンドの実行結果要約
- 型エラーやlintエラーの機械的な一覧化
- 明らかに独立したCSSの軽微な見た目崩れ調査

Haiku へ渡してはいけない作業:

- DB schema / migration 作成
- 認証、BAN、TOS、CostGuard、Active X ID の権限判定
- 公開APIの返却項目判断
- スロット予約・解放・グループ分割・結合
- 部番号再計算ロジック
- 既存データ移行
- `video_comments` 等 deprecated 項目の扱い判断
- セキュリティレビュー
- 「仕様が曖昧なので決めてよいか」を含む作業

### 1-3. Sonnet に渡す作業

Sonnet は標準の実装担当とする。

- 通常の機能実装
- Server Action / Route Handler の修正
- UIコンポーネント修正
- Drizzle query の修正
- 既存仕様が明確なDBアクセス修正
- テスト追加
- 型エラー修正
- 中規模のリファクタリング
- チェックリストに沿った実装確認

### 1-4. Opus に上げる作業

Opus は、メインエージェントまたは上級レビュー担当として使う。

- Discord ID / X ID / Active X ID の責務分離設計
- 共通書き込みガードの設計
- 枠なし投稿、枠あり投稿、未承認X IDの境界判断
- 連続枠の予約・部分解放・拡張・結合の整合性設計
- 部番号の再計算仕様
- 公開APIの漏洩レビュー
- DB migration の破壊的変更レビュー
- deprecated カラム・テーブルの扱い判断
- `/admin` と `/manage` の権限境界
- 自由HTML/CSS、独自タグ、サニタイズの安全設計
- Sonnet の修正結果が仕様に合っているかの最終レビュー

## 2. Claude Code 上の運用ルール

### 2-1. サブエージェント定義の置き方

Claude Code のプロジェクト用サブエージェントを作る場合は、原則として次に置く。

```text
.claude/agents/<agent-name>.md
```

各サブエージェント定義では、YAML frontmatter の `model` を明示する。

```md
---
name: flamenode-slot-auditor
description: FlameNode のスロット予約・解放・部番号ロジックを調査する
model: sonnet
tools: Read, Grep, Glob, Bash
---

あなたは FlameNode のスロットロジック調査担当です。
...
```

ただし、このファイル自体はサブエージェント定義ではなく、メインエージェントが作業を割り振るためのルーティング指示書である。

### 2-2. メインエージェントの役割

メインエージェントは次を必ず行う。

1. 修正対象をフェーズに分ける。
2. 仕様判断が必要な箇所を先にOpusまたは自分で確定する。
3. Haikuには探索・整理だけを投げる。
4. Sonnetに実装を投げる。
5. 実装後、別サブエージェントにレビューを投げる。
6. 最後にメインエージェントが差分を統合確認する。

メインエージェントが避けるべきこと:

- 大きな修正を1つのサブエージェントに丸投げする。
- Haikuに仕様判断をさせる。
- UIだけ直してサーバー側の権限チェックを放置する。
- DB変更とUI変更を同じPRで無秩序に混ぜる。
- deprecated項目を便利だから再利用する。

## 3. 仕様の優先順位

仕様が衝突した場合は、次の順で解決する。

1. 現在このプロジェクトで確定済みの修正指示書・詳細設計・チェックリスト
2. 現行GitHub実装と既存 `設計/` ドキュメント
3. README に書かれた技術スタック・ディレクトリ構成
4. 実装上の制約
5. 見た目や好みの調整

ただし、現行実装が修正指示書と衝突している場合は、現行実装を正としない。現行実装は「修正前の状態」として扱う。

## 4. 全サブエージェント共通の禁止事項

- Discord ID と X ID の責務を混ぜない。
- `owner_discord_user_id` だけで作品編集を許可しない。
- Active X ID なしで投稿・いいね・セーブ・ライブラリ・チャプターコメントを書き込ませない。
- 未承認X IDで作品投稿やチャプターコメント投稿を許可しない。
- 未承認X IDで許可してよいのは枠確保のみ。
- フロントの disabled だけで権限を守ったことにしない。
- API / Server Action の直叩きで更新できる穴を残さない。
- `contact_x_id` の自由入力を投稿主体として扱わない。
- YouTube URL文字列をDB上の正データにしない。保存は動画IDへ正規化する。
- YouTube側 unlisted と FlameNode内部 unlisted を混同しない。
- 独立コメント欄を復活させない。
- `video_comments` を新規利用しない。
- `marker_kind` 依存の分岐を増やさない。
- 連続枠を画面表示だけでまとめ、DB整合性を放置しない。
- submitted枠を通常解放できるようにしない。
- 公開APIで Discord ID、email、role、BAN状態、TOS状態、token、private note を返さない。
- 未実装機能を実装済みのようにUIやデプロイ手順へ載せない。

## 5. 作業フェーズと割当

### Phase 0: 現状把握・差分地図作成

推奨モデル: Haiku または Sonnet

Haikuでよい作業:

- 関連ファイル候補の列挙
- 既存API / Server Action / component / schema の所在調査
- TODOリスト化

Sonnetにする作業:

- 修正指示書とのズレを判断する
- どの順序でPRを切るべきか決める
- 仕様上のリスクを分類する

サブエージェント名例:

```text
flamenode-repo-cartographer
```

プロンプト:

```text
FlameNode の現行コードから、ID/権限、投稿、スロット、部番号、いいね/セーブ/ライブラリ、チャプターコメント、公開API、health/security に関係するファイルを探してください。

出力は以下の形式にしてください。

1. 領域名
2. 関連ファイル
3. そのファイルが担っていそうな責務
4. 修正指示書とのズレの可能性
5. Haikuで触ってよいか、Sonnet以上が必要か

コード変更はしないでください。
```

完了条件:

- 修正対象ファイルの候補が領域別に出ている。
- いきなり実装に入っていない。
- 危険領域がHaiku担当になっていない。

---

### Phase 1: ID・権限・共通書き込みガード

推奨モデル: Sonnet
Opus条件: Active X ID、TOS、BAN、CostGuard、承認状態の境界が曖昧な場合

サブエージェント名例:

```text
flamenode-auth-id-guard-architect
flamenode-auth-id-guard-implementer
flamenode-auth-id-guard-reviewer
```

設計担当プロンプト:

```text
FlameNode の Discord ID / X ID / Active X ID / TOS / BAN / CostGuard / 承認済みX ID の責務を整理し、全書き込み操作で使う共通ガードを設計してください。

必ず守ること:
- Discord ID はログイン、BAN、TOS、通知、admin/moderator role の主体。
- X ID は作者、作品、プロフィール、アイコン、いいね、セーブ、ライブラリ、チャプターコメント投稿者の主体。
- Active X ID は現在どのX IDとして操作しているかを示す。
- 未承認X IDで許可するのは枠確保のみ。
- 投稿、編集、いいね、セーブ、ライブラリ、チャプターコメントは共通ガードを通す。
- フロントだけでなくサーバー側で必ず拒否する。

出力:
1. 既存コードの問題点
2. 共通ガードの責務
3. ガード関数/APIの候補名
4. 呼び出し元一覧
5. テスト観点
6. 実装順序
```

実装担当プロンプト:

```text
設計済みの共通書き込みガードを FlameNode に実装してください。

対象:
- 投稿
- 編集
- 枠確保
- 枠提出
- いいね
- セーブ
- ライブラリ
- チャプターコメント

要件:
- UI disabled だけでなく Server Action / Route Handler 側で拒否する。
- owner_discord_user_id だけで編集許可しない。
- Active X ID が必要な操作では必ず存在確認する。
- 承認済みX IDが必要な操作では必ず承認状態を確認する。
- BAN/TOS/CostGuard を共通的に確認する。

出力:
- 変更ファイル一覧
- 各書き込み操作がどのガードを通るか
- 追加・修正したテスト
- 残課題
```

レビュー担当プロンプト:

```text
実装された ID/権限/共通ガード修正をレビューしてください。

重点確認:
- Discord IDとX IDが混ざっていないか。
- owner_discord_user_idだけで編集できないか。
- 未承認X IDで投稿・チャプターコメントできないか。
- 枠確保だけは未承認X IDでも許可されるか。
- TOS/BAN/CostGuardが全書き込み操作に効くか。
- API直叩きで突破できないか。

結論は `OK / 要修正 / Opus判断が必要` のいずれかで出してください。
```

---

### Phase 2: 投稿フロー・YouTube ID正規化

推奨モデル: Sonnet
Opus条件: 枠なし即公開と審査・承認状態の衝突が出る場合

サブエージェント名例:

```text
flamenode-post-flow-implementer
flamenode-youtube-id-normalizer
```

プロンプト:

```text
FlameNode の投稿フローを修正してください。

必須方針:
- 枠なし投稿は、ログイン済み・BANなし・TOS同意済み・CostGuard許可・連携済みActive X IDあり・承認済みX IDなら即 public。
- 枠なし投稿で contact_x_id 自由入力を投稿主体にしない。
- 未連携X IDを自動作成して即公開しない。
- 枠あり提出は承認済みActive X ID必須。
- 未承認X IDでは枠確保のみ可能。
- YouTube URL / 短縮URL / ID を受け取っても、DBには YouTube動画ID として保存する。
- YouTube側unlistedでも FlameNode内public なら通常公開扱い。

出力:
1. 変更した投稿経路
2. YouTube ID正規化関数の所在
3. contact_x_id自由入力を無効化した箇所
4. テストケース
5. 互換性リスク
```

---

### Phase 3: 連続枠・部分解放・拡張・部番号

推奨モデル: Sonnet
Opus条件: reservation_group_id の再設計、migration、既存データ補正、部番号定義で迷う場合

サブエージェント名例:

```text
flamenode-slot-group-architect
flamenode-slot-group-implementer
flamenode-part-number-implementer
flamenode-slot-reviewer
```

設計担当プロンプト:

```text
FlameNode の連続枠ロジックを設計してください。

必須方針:
- reservation_group_id で連続枠をまとめる。
- 同一グループには同じevent、同じDiscordユーザー、同じX IDの枠だけを含める。
- 連続予約時は全枠available、時間順に隣接、上限内であることを確認する。
- 一部更新失敗時は更新済み枠を戻す。
- 端解放では残りは同一グループ。
- 中央解放では左右にグループ分割。
- 全解放ではavailableへ戻す。
- submitted枠は通常解放不可。
- 前方/後方隣接枠の追加、中間空き枠を埋めた結合を許可する。
- 上限超過、時間重複、他ユーザー混在は禁止。

出力:
1. 既存実装とのズレ
2. 必要な関数一覧
3. 予約・解放・拡張・結合の疑似コード
4. 失敗時ロールバック方針
5. テストケース
```

部番号担当プロンプト:

```text
FlameNode の部番号算出を修正してください。

ソート順:
1. start_time あり
2. start_time 昇順
3. end_time 昇順
4. sort_order 昇順
5. id 昇順

新しい部にする条件:
- 前枠終了から次枠開始までの差が、イベント設定の部区切り時間以上
- 日付が変わる
- slot_kind が変わる
- 明示的な区切りがある
- 時間なし枠へ移る

部区切り時間:
- イベントごとに設定可能
- デフォルト30分
- 未設定・異常値は30分
- 管理画面で編集可能
- 変更後は再計算

出力:
- 算出ロジックの変更箇所
- 管理画面の表示・編集箇所
- 算出根拠の表示方法
- テストケース
```

レビュー担当プロンプト:

```text
連続枠・部番号修正をレビューしてください。

重点確認:
- 連続予約失敗時に一部だけ残らないか。
- 中央部分解放でグループが分割されるか。
- 隣接拡張でグループが結合されるか。
- グループ内に別ユーザー・別X IDが混在しないか。
- submitted枠が通常解放されないか。
- 前方追加で部番号が再計算されるか。
- 休憩閾値、日付変更、slot_kind変更で部が分かれるか。

結論は `OK / 要修正 / Opus判断が必要` のいずれかで出してください。
```

---

### Phase 4: いいね・セーブ・ライブラリ・再生リスト

推奨モデル: Sonnet
Haiku条件: 取得元ファイルの探索のみ

サブエージェント名例:

```text
flamenode-interaction-library-implementer
```

プロンプト:

```text
FlameNode のいいね・セーブ・ライブラリ・再生リストを X ID 主体に統一してください。

必須方針:
- Discord ID主体にしない。
- Active X ID切替で内容が切り替わる。
- いいね/セーブの保存先IDを開発環境で確認できるようにする。
- 共通書き込みガードを通す。
- 未承認X IDでの操作制限、TOS、BAN、CostGuardを確認する。

出力:
1. 取得クエリの変更箇所
2. 書き込み処理の変更箇所
3. X ID切替時の再取得方法
4. 再生リスト生成の修正内容
5. テストケース
```

---

### Phase 5: チャプターコメント統合

推奨モデル: Sonnet
Opus条件: 既存コメントデータ移行や公開範囲判断が必要な場合

サブエージェント名例:

```text
flamenode-chapter-comment-implementer
```

プロンプト:

```text
FlameNode のコメント機能をチャプターコメントへ統合してください。

必須方針:
- 独立コメント欄を作らない。
- video_comments を新規UI/APIで使わない。
- コメントは必ず時刻に紐づく。
- note を本文として扱う。
- 返信・スレッドは作らない。
- Active X IDあり、承認済み、BANなし、TOS同意済み、CostGuard許可を要求する。
- 対象動画が FlameNode 内 public または unlisted の場合のみ投稿可能。
- YouTube側unlistedで FlameNode内public なら投稿可能。
- private は投稿者本人、作品作者、admin、許可運営者のみ表示。
- スマホでは動画下に表示する。
- marker_kind に依存した分岐を増やさない。

出力:
1. 廃止・非使用にした独立コメント経路
2. チャプターコメント投稿API/Action
3. 表示権限ロジック
4. モバイル表示調整
5. テストケース
```

---

### Phase 6: 公開API・health・security

推奨モデル: Sonnet
Opus条件: 公開APIの漏洩レビュー、securityチェック、token保存、権限境界

サブエージェント名例:

```text
flamenode-public-api-reviewer
flamenode-health-security-implementer
```

公開APIプロンプト:

```text
FlameNode の公開APIをレビュー・修正してください。

返却してよいもの:
- public作品
- YouTube側unlistedだが FlameNode内public作品
- publicイベント
- publicクリエイター
- publicチャプターコメント
- publicメンバー情報
- 残り枠など公開してよい集計

返却してはいけないもの:
- Discord ID
- email
- role
- is_banned
- TOS状態
- active_x_user_id
- linked_discord_user_id
- verification_token
- internal_note
- private note
- void_detail_private
- notification payload
- access_token
- refresh_token
- 管理者向け履歴

出力:
1. APIごとの返却項目一覧
2. ホワイトリスト化した箇所
3. ページネーション/limit上限/キャッシュ方針
4. 漏洩リスク
5. テストケース
```

health/securityプロンプト:

```text
FlameNode の health / security チェックを実装または拡充してください。

healthで検出するもの:
- system_settings が global 1行か
- primary_event_id と video_events が同期しているか
- 存在しない event/video 参照がないか
- available slot に video_id がないか
- submitted slot に video_id があるか
- slot時間重複がないか
- reservation_group_id 内に別ユーザー混在がないか
- public動画に youtube_video_id があるか
- voided動画が公開されていないか
- like_count と実数が大きくズレていないか
- deprecated項目に新規データが増えていないか

securityで検出するもの:
- accounts.access_token が null か
- rejected X ID が active でないか
- 未承認X IDで投稿済み作品がないか
- BANユーザーの書き込みがないか
- TOS未同意ユーザーの書き込みがないか
- 公開APIに内部情報が出ていないか
- custom pageで危険HTMLが無効化されるか
- 管理操作が history_logs に残るか

出力:
- 実装したチェック一覧
- 管理画面上の表示方法
- Dry Run / 修復操作の有無
- テスト方法
```

---

### Phase 7: UI/UX・入力UI・文言

推奨モデル: Sonnet
Haiku条件: 文言置換案、CSS崩れ箇所列挙のみ

サブエージェント名例:

```text
flamenode-ui-ux-polisher
flamenode-copy-and-form-polisher
```

プロンプト:

```text
FlameNode の UI/UX を修正してください。

必須方針:
- 上部バーはロゴ・検索・投稿・テーマ切替・X ID切替・アカウントを中心に整理する。
- 作品一覧、イベント、クリエイター、おすすめ、ABOUT等の常時ナビは上部バーから外す。
- テーマ切替とX ID切替は奥に隠しすぎない。
- トップページに開催日時、募集期間、残り枠、イベント概要、参加方法を表示する。
- 「スロット確保する」は直接スロット確保画面へ飛ばす。
- エントリーページは「イベントに参加する」「過去の自分の作品を投稿する」の2択中心にする。
- 編集可能箇所と編集不可箇所を見た目で分ける。
- 文言は自然にする。
- 行高・配置崩れを直す。
- 狭い幅でも崩れないようにする。
- 編集ソフト欄は既存データを元に選択式へ寄せる。
- クレジット欄は入力例・候補・プレースホルダを出す。
- 時刻入力はピッカー、候補ボタン、連続追加UI、一括入力補助などで楽にする。

出力:
1. 変更した画面
2. 変更した導線
3. 編集可能/不可の見せ方
4. モバイル確認結果
5. 残ったUI課題
```

---

### Phase 8: DB整理・deprecated項目・旧データ

推奨モデル: Sonnet
Opus条件: migration、データ破壊、復元不能操作、既存データ補正

サブエージェント名例:

```text
flamenode-db-cleanup-planner
flamenode-legacy-import-safety-implementer
```

プロンプト:

```text
FlameNode のDB整理・旧データ取り込み安全設計を進めてください。

必須方針:
- deprecated項目へ新規書き込みしない。
- video_comments を使わない。
- outro_comment を新規利用しない。
- primary_event_id と video_events を同期する。
- system_settings は global 1行。
- 削除は論理削除・アーカイブ優先。
- 監査ログが必要操作で残る。
- 旧データ取り込みは管理者専用の危険操作として扱う。
- Dry Runで作成・更新・スキップ・エラー件数を表示する。
- ファイルサイズ・件数制限を設ける。
- 旧データ由来X IDは表示上通常X IDと大きく分けない。
- 本人編集権限はDiscord連携・承認状態に基づく。

出力:
1. DB項目の分類表
2. 新規書き込み禁止にした項目
3. migrationの有無
4. Dry Run表示内容
5. 監査ログ対象
6. Opusレビューが必要な箇所
```

---

### Phase 9: テスト・ビルド・最終レビュー

推奨モデル: Haiku for command result summary, Sonnet for fix, Opus for final architectural review

サブエージェント名例:

```text
flamenode-test-runner
flamenode-final-reviewer
```

テスト実行プロンプト:

```text
FlameNode の変更後チェックを実行し、結果を要約してください。

最低限確認:
- npm run typecheck
- npm run build
- DB migration がローカルで通るか
- 権限なしユーザーでAPI直叩きテスト
- X ID切替テスト
- 連続枠の部分解放テスト
- 連続枠の拡張テスト
- 部番号再計算テスト
- チャプターコメント投稿テスト
- 公開APIの漏洩チェック
- health/securityチェック

Haikuの場合は結果の要約まで。失敗修正はSonnet以上に渡してください。
```

最終レビュー担当プロンプト:

```text
今回の修正全体を、FlameNode 修正指示書・詳細設計・実装チェックリストに照らしてレビューしてください。

重点確認:
- PRの目的、DB変更、権限変更、UI変更、破壊的変更が明記されているか。
- ID/権限の責務が混ざっていないか。
- 投稿・編集・枠・チャプターコメントが共通ガードを通るか。
- 連続枠・部番号が破綻しないか。
- いいね/セーブ/ライブラリがX ID主体か。
- 公開APIで内部情報が漏れていないか。
- health/securityチェックがあるか。
- UIが情報過多・導線崩れになっていないか。
- build/typecheckが通るか。

出力:
1. マージ可否
2. ブロッカー
3. 非ブロッカー
4. 次PRに回してよい項目
5. Opusで再判断すべき項目
```

## 6. PR分割の推奨

大規模修正は次のようにPRを分ける。

1. `docs/implementation-plan`
   - 実装状況Markdown、作業順序、チェックリスト更新
2. `auth/id-write-guard`
   - Discord/X/Active X ID、TOS/BAN/CostGuard、共通ガード
3. `posting/youtube-id-and-active-x`
   - 枠なし投稿、枠あり提出、YouTube ID正規化
4. `slots/reservation-groups`
   - 連続枠、部分解放、拡張、結合
5. `slots/part-numbering`
   - 部番号、休憩閾値、管理画面設定
6. `interactions/x-id-library`
   - いいね、セーブ、ライブラリ、再生リスト
7. `comments/chapter-comments-only`
   - 独立コメント廃止、チャプターコメント統合
8. `api/public-whitelist`
   - 公開APIの返却項目整理、ページネーション、キャッシュ
9. `admin/health-security`
   - health/securityチェック、Dry Run、監査ログ
10. `ui/navigation-entry-forms`
    - 上部バー、エントリー、トップ、入力UI、文言

1PRに無理に全部入れない。特に `auth/id-write-guard` と `slots/reservation-groups` は他PRと混ぜない。

## 7. サブエージェント割当表

| 領域 | 推奨モデル | Haiku可否 | Opus条件 | 主な成果物 |
|---|---:|---:|---|---|
| リポジトリ探索 | Haiku | 可 | なし | 関連ファイル一覧 |
| 仕様差分監査 | Sonnet | 一部可 | 仕様衝突 | 差分表 |
| ID/権限設計 | Opus/Sonnet | 不可 | 原則Opusレビュー | 共通ガード設計 |
| ID/権限実装 | Sonnet | 不可 | 2回失敗・境界曖昧 | 実装・テスト |
| 投稿フロー | Sonnet | 不可 | 公開状態判断衝突 | 投稿処理修正 |
| YouTube ID正規化 | Sonnet | 探索のみ可 | 既存データ移行 | 正規化関数 |
| 連続枠設計 | Opus/Sonnet | 不可 | グループ再設計 | 疑似コード・実装方針 |
| 連続枠実装 | Sonnet | 不可 | migration/ロールバック難 | 実装・テスト |
| 部番号 | Sonnet | 不可 | 仕様衝突 | 算出ロジック |
| いいね/セーブ/ライブラリ | Sonnet | 探索のみ可 | ID主体が曖昧 | X ID主体化 |
| チャプターコメント | Sonnet | 不可 | 既存コメント移行 | 統合実装 |
| 公開API | Sonnet/Opus | 不可 | 漏洩レビュー | ホワイトリスト |
| health/security | Sonnet/Opus | 不可 | security判定 | 点検ページ |
| UI/UX | Sonnet | 文言/CSS調査のみ可 | 権限UIと絡む | 導線・画面修正 |
| DB整理 | Sonnet/Opus | 不可 | migration/破壊的変更 | 整理計画・実装 |
| テスト結果要約 | Haiku | 可 | なし | 失敗一覧 |
| テスト失敗修正 | Sonnet | 不可 | 2回失敗 | 修正差分 |
| 最終レビュー | Opus/Sonnet | 不可 | 原則Opus推奨 | マージ可否 |

## 8. エスカレーション基準

次のどれかに該当したら、SonnetからOpusへ上げる。

- 「現行実装はこうだが、修正指示書は逆」となる。
- DB migration が必要で、既存データ破壊の可能性がある。
- 権限を緩める可能性がある。
- 公開APIの返却項目を増やす。
- slot group の整合性が崩れる可能性がある。
- 2つ以上のID主体が絡む。
- YouTube側unlistedとFlameNode内部unlistedの扱いが絡む。
- 監査ログ、復元、危険操作に関わる。
- Sonnetが2回修正してもtypecheck/build/testが通らない。
- サブエージェント同士の結論が食い違う。

## 9. 完了チェックリスト

各PRで最低限確認する。

### 共通

- [ ] 目的が明確
- [ ] DB変更の有無が明記されている
- [ ] 権限変更の有無が明記されている
- [ ] UI変更の有無が明記されている
- [ ] 破壊的変更の有無が明記されている
- [ ] typecheckが通る
- [ ] buildが通る

### ID / 権限

- [ ] Discord IDとX IDの責務が混ざっていない
- [ ] Active X ID切替で対象データが切り替わる
- [ ] いいね/セーブ/ライブラリがX ID単位
- [ ] owner_discord_user_idだけで編集許可していない
- [ ] 未承認X IDは枠確保のみ
- [ ] BAN/TOS/CostGuardが書き込み操作に効く
- [ ] UI disabledだけでなくサーバー側でも拒否している

### スロット

- [ ] 連続枠にreservation_group_idが付く
- [ ] 連続予約失敗時に更新済み枠を巻き戻す
- [ ] グループ内に別ユーザーが混在しない
- [ ] グループ内に別X IDが混在しない
- [ ] 中央部分解放でグループが分割される
- [ ] 隣接拡張でグループが結合される
- [ ] submitted枠が通常解放されない

### チャプターコメント

- [ ] 独立コメント欄がない
- [ ] video_commentsを新規利用していない
- [ ] コメントは必ず時刻に紐づく
- [ ] 未承認X IDでは投稿不可
- [ ] BAN/TOS/CostGuardが効く
- [ ] public/unlisted以外には投稿不可
- [ ] private表示範囲が守られている

### 公開API / security

- [ ] Discord IDを返していない
- [ ] emailやroleを返していない
- [ ] private/internal noteを返していない
- [ ] ページネーションがある
- [ ] limit上限がある
- [ ] accounts.access_tokenがnull
- [ ] 管理操作がhistory_logsに残る

## 10. メインエージェント向け最初の投入プロンプト

Claude Code のメインエージェントへ最初に渡す場合は、次を使う。

```text
あなたは FlameNode のメイン実装エージェントです。

まず `設計/claude-code-subagent-assignment.md` を読み、作業をフェーズ分割してください。

モデル運用:
- 基本は Sonnet。
- 本当に簡単な探索・文言・要約のみ Haiku。
- ID/権限/DB/連続枠/security/公開API漏洩/仕様衝突は Opus またはメインエージェント判断。

最初に行うこと:
1. README と `設計/` 配下を確認する。
2. 修正指示書・詳細設計・チェックリストに対応する現行コードの所在を調査する。
3. Phase 0 のファイル地図を作る。
4. いきなり実装せず、PR分割案を出す。
5. 最初の実装PRは ID/権限/共通書き込みガードから始める。

禁止:
- Haikuに仕様判断をさせない。
- フロントだけで権限修正を済ませない。
- deprecated項目を新規利用しない。
- 連続枠を表示だけでごまかさない。
```

## 11. ひとことで覚える割当ルール

- **探すだけならHaiku。**
- **普通に直すならSonnet。**
- **壊したらやばいところはOpus。**
- **権限・DB・security・連続枠はケチらない。**
