# FlameNode Active X データ移行詳細計画書（Active X Data Migration Plan）

> 状態: Active / データ移行設計書
> 最終検証: 2026-10-09（実スキーマ `src/lib/db/schema.canonical.ts` および `0052_video_interactions_auth_expand.sql` に基づき改定）
> 関連ドキュメント: [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md), [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) (D-03, D-04)

## 1. 移行の背景と目的

CURRENT 実装では、動画への「いいね」「ブックマーク（保存）」が `video_interactions_auth`（Auth User 単位）に記録されています（`src/lib/actions/video/interaction.ts`）。
TARGET アーキテクチャ（[`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md)）では、**「認証主体 = Auth User」「行動・創作・インタラクション主体 = Active X」** として分離され、いいね・ブックマークの所有主体は Active X（`video_interactions`）へ戻します（`CURRENT_DIVERGENCE` の解消）。

既存 D1 には `video_interactions`（`x_user_id` 単位）と `video_interactions_auth`（`auth_user_id` 単位）が**両方定義済み**です。
新テーブルを新設するのではなく、既存の `video_interactions` を正本として位置づけ直し、安全にデータをバックフィル・切替する手順を定義します。

---

## 2. 対象テーブルとスキーマ構造（実コード基準）

### 1. 現在の書き込み正本: `video_interactions_auth`
```sql
CREATE TABLE video_interactions_auth (
  auth_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('like', 'bookmark')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (auth_user_id, video_id, interaction_type)
);
CREATE INDEX video_interactions_auth_video_type_idx
  ON video_interactions_auth (video_id, interaction_type, created_at);
```

### 2. 移行先正本: `video_interactions`
```sql
CREATE TABLE video_interactions (
  x_user_id TEXT NOT NULL REFERENCES x_users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('like', 'bookmark')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (x_user_id, video_id, interaction_type)
);
CREATE INDEX video_interactions_video_type_idx
  ON video_interactions (video_id, interaction_type, created_at);
```

※ 新たな `video_interactions_x` テーブルや `is_liked`, `is_bookmarked` フラグ列は作りません。

---

## 3. 移行名義 — D-03: 所有する全承認済みXへfan-out（決定済み）

旧 `video_interactions_auth` の **各1行を、そのAuth Userがownerとして持つ全承認済みX** に展開する。`users.active_x_user_id` の1件のみには限定しない。`x_user_account_links.auth_user_id` が一致し、`link_role='owner'`、`x_users.approval_status='approved'` の両方を満たすこと。manager権限だけのX、pending/rejected/imported状態は除外する。

1. 1名義/複数名義とも同じjoinで処理し、移行時点で有効な所有リンク集合を固定して記録する。元のX IDでのinteractionも含め、`(x_user_id,video_id,interaction_type)` でdedupe。
2. Xを所持していないAuth Userのinteractionは旧テーブルに保持する。後から承認済みownerリンクを持ったときの追補移行は監査付き・冪等・再照合必須。
3. `videos.app_like_count` はAuth Userの件数ではなく**Xごとのdistinct like件数**として全件再計算する。1 Auth→3 Xなら最大3いいねとしてカウントされうる。差分をレポートして承認対象にする。
4. 同一Xに複数Auth Userが紐づくときは同一video/typeが衝突する。重複行のtimestamp/削除競合・既存Xの先行操作を追跡して収束させる。既存レコードを無条件に上書きしない。
5. **この選択は過去interactionの移行方法のみ。切替後の新規like/bookmarkは選択中Active Xに作用し、所有する全Xへ自動連動しない**（全X同期の追加仕様は別の承認対象）。
6. fan-out件数は `old rows × owner approved links` に比例し、D1 Free枠の行数/CPU/statementを事前見積りする。数十万件なら複数実行枠に分割し、1リクエストで処理しない。

## 4. Cloudflare D1 Free 枠の制限遵守とバッチ設計

Cloudflare D1 Free 枠制限:
- **1日の行書き込み上限**: 100,000 行/日
- **1回の `db.batch()` ステートメント上限**: 50 ステートメント

### バックフィルバッチ仕様 (`scripts/migrate-interactions-to-active-x.mjs`)
1. **チャンクサイズ**: 1 バッチ最大 40 件の INSERT（50 ステートメント制限にマージンを確保）。
2. **安全弁**: 1 回のバッチ実行で最大 5,000 件まで処理し、日次 100,000 行上限を確実に下回る設計。
3. **べき等性**: 重複キーへの `INSERT OR IGNORE` は行重複防止に限る。削除済みデータの復活防止にはsnapshot/versionおよびwrite-freeze/差分照合が必要。
4. **移行チェックポイント**: 処理対象の安定したソートキーと時点を記録し、中断後の再開で新規/更新行を取りこぼさない。`last_processed_auth_user_id` だけで読取を進めず、`(auth_user_id, video_id, interaction_type)` の複合キー、実行単位のスナップショット/デルタを用いる。バッチ進捗・検証記録は処理結果と整合させる。
5. **監査ログ**: actorと対象件数・衝突件数・未割当件数・チェックポイント・切替時刻を記録。個人を特定する情報や秘密値を標準出力へ大量に出さない。
6. **検証**: type別の移行前後件数、(X ID,video,type)一意性、approved-link制約、未割当の残存件数、`videos.app_like_count` の再計算、R2/Queue派生データの整合性を照合。不一致ならflagを切り替えない。
7. **並走書き込み**: dry-runの時点からcutoverまでの更新・解除をdeltaとして捕捉するか、短いwrite-freeze + final backfill/照合を設計。単純な一度きりの`INSERT OR IGNORE`では後から取消されたlikeが復活するため不可。

---

## 5. 移行フェーズと実行順序

| Step | タイミング | 作業内容 |
|---|---|---|
| **Step 1** | Phase 3 (Domain) | `packages/domain` 内で `video_interactions` を対象とする interaction サービスの型・シグネチャを設計 |
| **Step 2** | Phase 6 (Hono API) | バックフィルスクリプトの作成・dry-run 検証、および本番バックフィル（要ユーザー承認） |
| **Step 3** | Phase 7 (Private SPA) | 全旧/新interaction書き込み経路を短時間停止 → 最終fan-outと取り消し差分照合 → `system_settings` の単一フラグで**同時に**読み書きをX正本へ切替（D-04）。旧経路は互換shimで新サービスを呼ぶ。未連携モーダル稼働 |
| **Step 4** | Phase 9 (Retirement) | 整合性検証期間を経て、旧 `video_interactions_auth` の安全な廃止 |

---

## 6. ロールバック手順

- 移行期間中は `video_interactions_auth` のデータを物理削除しない。ただし**保持だけでは正しいロールバックではない**。
- 書き込み正本をX側へ切り替えた後、X側にのみ行われた追加・解除はAuth側に自動反映されない。旧flagを戻すだけでは反映されない操作や件数が生じる。
- **安全な切戻しの必要条件**: (1)全write経路の停止/凍結、(2)時点・actor付きdeltaジャーナルまたは安全な逆同期の検証、(3)Auth側へ表現できる変更だけを同期し、表現不能なmany-to-manyやX merge衝突は隔離/判断、(4)総件数・各ユーザー状態・派生集計の再照合、(5)旧コードからの読み書きE2E通過。
- 上記を満たせないとき、機械的なflag巻き戻しは禁止。X経路をread-onlyとして維持したうえでforward-fixするか、ユーザー承認付きの代替復旧計画を選ぶ。
- ロールバック演習は非本番DBで「切替後の追加・解除・X統合・多重リンク・未承認」を含めて実施する。
