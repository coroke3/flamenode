# レガシーデータ・インポート設計 (`/admin/import`)

## 1. 概要
旧システムで運用されていた JSON データ（`video.json`, `eventinfo.json` 等）と CSV データを、現在の D1 データベース構造へ一括移行するための管理ツール。
旧データ互換の詳細仕様は `FlameNode-Legacy-Data-Compatibility.md` を正とし、このページでは管理画面上の導線と実行フローを定義する。

## 2. デザイン方針

- **コンセプト**: "Legacy Bridge" (過去の資産を未来へ繋ぐ)
- **レイアウト**:
    - **インポート種別選択**: 「動画データ (`video.json`)」「過去イベント (`eventinfo.json`)」「CSV一括入力」を切り替えるタブまたはラジオボタン。
    - **アップロードエリア**: ドラッグ＆ドロップ対応のファイル選択エリア。
    - **フィールドマッピングプレビュー**: 読み込んだデータが D1 のどのカラムに反映されるかを確認できるテーブル。
    - **進捗モニター**: 1件ずつのインポート成否と、エラー内容をリアルタイム表示。
- **視覚演出**:
    - 変換中のアイテムにはローディングアニメーション。
    - 正常終了は Success Green、エラーは Danger Red で色分けし、通常操作の黄色アクセントと混同しない。

---

## 3. インポート変換ロジック (コア仕様)

### 3-1. アイコン URL の正規化 (Google Drive 対策)
旧形式の Google Drive リンクを、ブラウザやアプリで直接表示可能な直リンク形式へ自動変換する。
- **変換前例**: `https://drive.google.com/open?id=1t3u_qcTMwr9T0gpmV5XAGek48BkZBxUW`
- **変換ロジック**: 正規表現で `id` を抽出し、以下のいずれかの形式に置換。
    - `https://lh3.googleusercontent.com/d/{id}` (推奨)
    - `https://drive.google.com/thumbnail?id={id}&sz=w1000` (バックアップ)

### 3-2. メンバー情報の 1:1 対応ロジック
`member` (名前) と `memberid` (X ID) がそれぞれカンマ区切りで提供される変則的な運用に対応する。
- **ロジック**: 
    1. 両フィールドを `,` で `split` して配列化。
    2. 配列のインデックス番号をキーとして、名前と ID をペアリング。
    3. `video_members` テーブルに1行ずつ `INSERT`。
    4. **例外処理**: 名前と ID の数が不一致の場合、名前を優先し ID は NULL または空文字として扱う。

### 3-3. タイムスタンプのマッピング
過去の作品を「その当時の作品」として正しく扱うための処理。
- **対象フィールド**: `time` (ISO 8601 形式)
- **マッピング先**:
    - `videos.created_at`: `time` を UNIX タイムスタンプに変換して代入。
    - `videos.scheduled_time`: 上映日時として `time` を代入。
    - `videos.status`: インポートされた過去作品は原則 `public` 状態で登録。

### 3-4. 詳細フィールドマッピング定義 (完全版)

`video.json` および `eventinfo.json` の関連フィールドを以下の通り D1 スキーマへマッピングする。動画作品の詳細は `video.json`、イベント本体は §3-6 の `eventinfo.json` で扱う。

| 旧フィールド (JSON) | 新物理カラム (D1) | 変換・正規化ロジック |
| :--- | :--- | :--- |
| `title` | `videos.title` | 文字列をそのまま代入。 |
| `creator` | `videos.display_name` | 作成者名。 |
| `yomi` | `videos.display_name_yomi` | 作成者名の読み。 |
| `tlink` | `videos.contact_x_id` | 先頭の `@` を除去。`x_users` テーブルのプライマリキーとしても使用。 |
| `ychlink` | `x_users.youtube_channel_url` | ユーザー情報の拡張として保存。 |
| `icon` | `videos.icon_url` | §3-1 のロジックで直リンク形式に変換。 |
| `time` / `data` | `videos.scheduled_time` | `data`(MM/DD) と `time`(HH:mm) を結合し、当該年度の ISO 日時を生成。 |
| `timestamp` | `videos.created_at` | 数値(Excel形式)の場合は UNIX 秒へ変換、ISO 形式はそのまま Parse。 |
| `ylink` | `videos.youtube_video_id` | `youtu.be/ID` または `v=ID` から 11 桁の正規化 ID を抽出。 |
| `music` | `videos.music` | 楽曲名。 |
| `credit` | `videos.credit` | 楽曲クレジット。 |
| `ymulink` | `videos.music_reference_url` | 楽曲の参照 URL。 |
| `type1` | `videos.submission_type` | `"個人"` → `"individual"`, `"複数人"` → `"collab"` へ変換。 |
| `movieyear` | `videos.declared_experience` | 制作歴や参加区分を文字列としてそのまま保存。 |
| `comment` | `videos.intro_comment` | 作品紹介文。 |
| `beforecomment` | `videos.intro_comment` | `comment` が空の場合にフォールバック、または改行して結合。 |
| `aftercomment` | `videos.closing_comment` | 上映後コメントとして保存。 |
| `soft` | `videos.used_software` | 使用ソフト情報を文字列として保存。 |
| `hitokoto` | `videos.highlights` | 「ひとこと」を作品の見どころとして保存。 |
| `ycomment` | `videos.highlights` | YouTube コメント等の補足情報を `highlights` へ追記。 |
| `righttype` | `videos.stage_permission` | `"同意する"` 等の状態を元に、上映許可フラグとして解釈。 |
| `toudan` / `othersns` | `videos.custom_answers` | `{"toudan": "...", "othersns": "..."}` の形式で JSON オブジェクト化。 |
| `starts` / `ends` | `video_chapters` | 秒数指定がある場合、`chapter_time`, `chapter_label`, `marker_kind = "chapter"`, `show_on_player_bar = 1` のチャプターマーカー初期候補として保持。 |

### 3-5. 複数人/団体データの処理 (Junction Tables)
- **`video_members` への展開**:
  - `member` (名前) 配列と `memberid` (ID) 配列を走査。
  - 各ペアに対して `INSERT INTO video_members (video_id, name, x_user_id) ...` を実行。
  - `memberid` が `@` で始まっている場合は除去して正規化。
- **`x_users` への自動登録**:
  - `tlink` および `memberid` に出現する全ての X ID を `x_users` に `INSERT OR IGNORE` で登録。
  - これにより、インポート直後から作成者ページへのリンクが有効になる。

### 3-6. 過去イベントデータ・インポート (`eventinfo.json`)
動画データに先立ち、または同時にイベント自体の定義（名称、期間、代表者、運営メンバー、画像）をインポートする。`eventinfo.json` は配列形式を想定し、1要素を1イベントとして扱う。

#### `eventinfo.json` の完全仕様

```json
[
  {
    "eventid": "PVSF2026Sp",
    "start": "2026-03-27T18:00:00.000Z",
    "end": "2026-03-29T23:59:00.000Z",
    "type": "event",
    "icon": "https://drive.google.com/open?id=11Ks00gwNJZyvKWih3Xcf9StArJsW48eo",
    "eventname": "PVSF2026Sp",
    "member": "Mochi,あおね,おたこ",
    "memberid": "coroke3,hs_nozomizo13,012345rty",
    "menberpost": "主催,音楽,告知画像",
    "explanation": "映像連続投稿祭",
    "img": "https://i.gyazo.com/example.png"
  }
]
```

- `eventid` はイベントの一意キーとして使う。
- `start` / `end` は ISO 8601 文字列。`end` が空文字の場合は終了日時なしとして扱う。
- `type` は `event`, `collabo`, `type`, `other` のいずれかへ正規化する。
- `member`, `memberid`, `menberpost` はカンマ区切りで、同じインデックス同士を1人の運営メンバーとして扱う。
- 旧キー `menberpost` は誤字だが互換性のため正式に受け付ける。正しい `memberpost` が同時に存在する場合は `memberpost` を優先し、`menberpost` は補助として扱う。
- `icon` と `img` は空文字を許可する。Google Drive URL は直リンク化し、その他の URL は原則そのまま保持する。

| 旧フィールド (JSON) | 新物理カラム (D1) | 変換・補足 |
| :--- | :--- | :--- |
| `eventid` | `events.id` | 空白と先頭 `@` は除去し、既存 ID と重複する場合は更新/スキップを選べる。 |
| `eventname` | `events.title` | 文字化けが疑われる場合はプレビューで警告し、保存前の手動修正を必須にする。 |
| `type` | `events.event_type` | `event`, `collabo`, `type` などを保持。未知の値は `other` として原文を補足保存。 |
| `start` | `events.start_time` | ISO 8601 を UNIX タイムスタンプへ変換。 |
| `end` | `events.end_time` | 空文字の場合は NULL。 |
| `icon` | `events.icon_url` | Google Drive URL は §3-1 の形式へ正規化。 |
| `img` | `events.img_url` | バナー画像。Gyazo、pbs.twimg.com、Drive などをそのまま保持し、Drive のみ直リンク化。 |
| `explanation` | `events.explanation` | 原文を保持。 |
| `member` | `x_users.x_name` | カンマ区切りで分割し、`memberid` と同じインデックスで対応させる。 |
| `memberid` | `event_editors.x_user_id` | `@` を除去し、`x_users` に `INSERT OR IGNORE`。 |
| `menberpost` | `event_editors.public_role_label` | 旧データの誤字キー。互換のため `memberpost` も同義として受け付ける。 |

- **代表者推定**: `menberpost/memberpost` に「主催」「代表」「運営」相当の語がある最初のメンバーを `events.representative_x_user_id` の初期候補にする。判定できない場合は先頭メンバーを候補として表示し、確定は管理者が行う。
- **公開範囲**: 旧データから公開範囲が判断できない運営メンバーは、安全側に倒して `is_public = 0` を既定にする。プレビュー画面で「公開するメンバー」「管理画面だけで見えるメンバー」に分け、公開対象だけをイベント詳細へ出す。
- **過去イベントの公開状態**: 過去イベントは `is_active = 1`, `is_entry_open = 0` を既定とし、アーカイブとして公開する。非公開で取り込む場合は実行前に切り替えられる。
- **イベントアクセントカラー**: `eventinfo.json` に色がない場合は未設定にする。インポート後の編集画面で HEX 入力を受け付け、視認性が悪い色は警告する。
- **文字化け検出と確認**: `縺`, `譁`, `荳`, `蜷`, `�` など Mojibake の典型文字、制御文字、極端に日本語として不自然な文字列を検出した場合は「文字コードミス疑い」として扱う。UTF-8、Shift_JIS、Windows-31J の取り違え候補は補助表示に留める。管理者はプレビューで手動修正できるが必須にはせず、一括スキップして原文のまま取り込むこともできる。

### 3-7. CSV インポート共通仕様
各種入力欄で CSV の貼り付け、または `.csv` ファイルの投入を受け付ける。

- **対象タブ**: 作品、過去イベント、イベント運営メンバー、イベント協力者権限、スロット、カスタム質問、使用編集ソフト辞書。
- **CSV 作成プロンプトコピー**: 各タブの右上に「CSV作成プロンプトをコピー」ボタンを置く。コピーされる文面には、列名、必須列、値の例、出力を CSV のみにする指示、余計な説明を含めない指示を入れる。
- **例: イベント協力者権限 CSV 列**: `event_id,display_name,x_user_id,discord_user_id,permission_key,is_public_staff,public_role_label`
- **例: イベント運営メンバー CSV 列**: `event_id,name,x_user_id,role_label,is_public,internal_note`
- **プレビュー**: 読み込み後、候補 ID、重複、必須欠落、文字コード、列名ゆれを表示し、保存前に修正できる。
- **反映方法**: 追記のみを既定かつ基本動作にする。既存行と同じ X ID や同じ名前がある場合も自動更新しない。重複候補はプレビューで警告し、「取り込まない」または「警告しつつ追記」を行ごとまたは一括で選べるようにする。
- **列名ゆれ**: `お名前`, `名前`, `name`, `タイトル`, `title` など一般的な列名エイリアスは辞書・正規表現で自動判定する。自信が低い列は手動マッピングを必須にする。
- **時間なしスロット**: 日時が空の枠データは、時間なしスロットとして連番で取り込む。
- **外部画像URL**: 旧データやCSVに含まれる外部画像URLは Cloudflare/R2 へ再保存せず、参照URLとして保持する。Cloudflare に保存する画像は新規アイコン画像のみ。
- **X IDプレースホルダー**: 旧データ内の X ID は未承認 X ID として作成し、将来の本人確認・統合・付け替えに備える。

#### CSV 作成プロンプトの内容
ボタンを押した時にコピーするプロンプトは、対象タブごとに以下の構造を持つ。

```text
次のデータを FlameNode のCSVインポート用に整形してください。
出力はCSVのみ。説明文、Markdown、コードブロックは不要です。
文字コードはUTF-8想定です。
必須列: event_id,display_name,x_user_id,permission_key
任意列: discord_user_id,is_public_staff,public_role_label
permission_key は次のいずれか: event.basic,event.slots,event.members,event.questions,videos.title,videos.music_credit,videos.members,videos.review_data,videos.youtube_id,videos.primary_event
collaborators.manage はイベント協力者には付与できません。協力者管理はイベント編集許可者以上が管理画面で行います。
同じ人に複数権限を付ける場合は、permission_key ごとに行を分けてください。
```

作品メンバー用、スロット用、イベント情報用、使用編集ソフト辞書用、カスタム質問用なども同じ形式で、必須列・任意列・許可値・例をタブごとに差し替える。

### 3-8. 旧データ形式エクスポート
インポートだけでなく、現在の D1 データを旧ツールで利用できる形式へ出力できる。

- **動画**: `video.json` 相当を出力する。`member` と `memberid` は `video_members.order_index` 順にカンマ区切りで出す。
- **イベント**: `eventinfo.json` 相当を出力する。互換性のため、役職キーは旧表記 `menberpost` を必ず含め、必要に応じて正表記 `memberpost` も併記する。
- **ID・名前対応表**: 名前から ID、ID から名前の候補生成に使える CSV/JSON を出力する。
- **対象範囲**: 通常エクスポートは公開データのみ。管理者向け詳細エクスポートは非公開データと管理画面専用メンバーを含められる。
- **状態別出力**: `x_reapply_required` は運営向け詳細CSVに状態フラグ付きで出力できるが、旧形式の上映順・連続再生対象からは除外する。`voided` は通常エクスポートと管理者向け詳細エクスポートには混ぜず、監査・統計専用の別レポートにのみ出力する。
- **文字コード**: 旧形式エクスポートは UTF-8 固定とする。

---

## 4. 実行フロー

1. **インポート種別選択**: 「イベント」を先にインポートし、基盤を作成する。
2. **ファイル選択**: 管理者が `eventinfo.json`, `video.json`, CSV のいずれかをアップロードまたは貼り付ける。
3. **パース & バリデーション**: JSON 構造をチェック。動画インポート時は `event_id` が D1 に存在するか確認。
4. **プレビュー**: 最初の 5 件を表示し、管理者が変換結果を確認。
5. **一括実行 (Bulk Insert)**: D1 の制限に合わせ、100件ずつのチャンクでインポートを実行。
6. **結果レポート**: 成功件数、失敗件数、失敗理由（ID重複等）をログとして表示。

---

## 5. ステート管理とセキュリティ

- **Auth**: 管理者のみがアクセス可能。
- **Idempotency**: 既に同じ YouTube ID または UUID が存在する場合はスキップし、データの重複登録を防止。
- **Transaction**: イベント単位での整合性を保つため、エラー時は当該チャンクをロールバック。
