# FlameNode 実装計画・最終版

## 0. 読んだファイル一覧

| ファイル | 役割 |
|---|---|
| `AGENTS.md` | エントリポイント（.Codex/flamenode/ 参照はstale、.claude/flamenode/ を使う） |
| `.claude/flamenode/README.md` | 実装ロードマップ・フェーズ構成・PR分割案 |
| `.claude/flamenode/requirements-map.md` | 116項目の要求カバレッジマップ（A〜Q） |
| `.claude/flamenode/source/flamenode_final_detailed_design.md` | ID設計・共通ガード・投稿・スロット・部番号・チャプター・API・health/security 最終設計 |
| `.claude/flamenode/source/flamenode_final_implementation_checklist.md` | 実装完了判定チェックリスト（12セクション） |
| `.claude/flamenode/source/flamenode_final_consistency_audit.md` | 現行実装との矛盾精査レポート |
| `claude-code-subagent-assignment.md` | サブエージェント割当・完全統合版（1557行） |
| `.claude/flamenode/phases/00〜09` | 10フェーズの詳細タスク定義 |

---

## 1. 現状評価：実装済み vs 不足

### 1-1. 完全実装済み（確認済み）

| 領域 | 状態 | 根拠 |
|---|---|---|
| **WriteGuard（共通書き込みガード）** | 完全 | `src/lib/auth/writeGuard.ts` — 10段階拒否チェーン（認証→DB→BAN→TOS→TOS再同意→CostGuard×2→ActiveX未設定→ActiveX却下→ActiveX未承認） |
| **所有権/RBAC** | 完全 | `src/lib/auth/ownership.ts`（593行）— 4権限モード（normal/admin/event/any）、セクションキー粒度、コラボレーターホワイトリスト |
| **DBスキーマ** | 完全 | `src/lib/db/schema.ts`（949行、27+テーブル）— 全ドメインエンティティをカバー |
| **/admin ルート** | 完全 | 30+ admin ページ（ダッシュボード、ユーザー、動画、イベント、インポート、X-link、YouTube同期、アナウンス、コストガード、モデレーション、通知、セキュリティ、health、監査、API、スプレッドシート、静的ビルド） |
| **/manage ルート** | 完全 | 11 event-management ページ（ダッシュボード、X-link、通知、イベント詳細/編集/スタッフ/スロット/動画/観客/レビュー） |
| **通知システム** | 完全 | `src/lib/notifications/`（8ファイル）+ `workers/notification-dispatcher/` — 20+通知タイプ、outboxキュー、dispatcher worker |
| **チャプターコメント** | 完全 | `src/lib/actions/chapter.ts`（476行）— CRUD + CSV一括インポート + WriteGuard + 所有権チェック + 通知 + 監査ログ |
| **スロット予約グループ** | 完全 | `src/lib/actions/slot.ts` + `slot-admin.ts` + `slotGroupingCore.ts` — reservation_group_id による予約/解放/分割/拡張/結合 |
| **公開動画API** | 完全 | `app/api/videos/route.ts`（54行）— ホワイトリスト返却、ページネーション、キャッシュヘッダー |
| **health/security チェック** | 完全 | `src/lib/admin/healthChecks.ts` — 全チェック項目をカバー（integration/voided/overlap/user-mix等） |
| **Worker** | 完全 | notification-dispatcher、json-generator、cleanup、youtube-sync、score-recalc — 5つのWorker |
| **マイグレーション** | 完全 | 27ファイル（0000-0026） |
| **ユーザー管理ページ** | 完全 | `app/(public)/users/[username]/` — プロフィール、動画一覧、ライブラリ、保存済み、X-linkリクエスト |
| **ダッシュボード** | 完全 | `app/(auth)/dashboard/` — 編集ページ（権限サブページ）、ライブラリ、設定、アイコン管理 |

### 1-2. 潜在的な不足・要確認

| 領域 | 状態 | 詳細 |
|---|---|---|
| **ユニットテスト：コア認証ガード** | **不足** | `writeGuard.ts`、`ownership.ts` のユニットテストがない |
| **ユニットテスト：サーバーアクション** | **不足** | `video.ts`、`chapter.ts`、`slot.ts` のサーバーアクションにユニットテストがない |
| **公開API個別動画ルート** | **要確認** | `app/api/videos/[id]` が存在するか確認が必要（リストのみ実装済み） |
| **video_chapters deprecated カラム** | **要確認** | `video_member_id` がstill schemaにあり @deprecated（migration 0017で移行済み） |
| **contact_x_id 自由入力の無効化** | **要確認** | 投稿フォームでcontact_x_idがまだ入力可能か確認が必要 |
| **YouTube ID正規化** | **要確認** | URL/短縮URL/ID入力の内部正規化が実装済みか確認が必要 |

---

## 2. PR分割戦略（12 PR）

README.md の既存PR分割案をベースに、現行実装の成熟度に応じて調整。

### PR 1: `docs/implementation-plan`
- **目的**: 本計画書のマージ + 実装状況Markdownの整備
- **内容**: `.claude/flamenode/IMPLEMENTATION_PLAN.md` の追加、要件カバレッジ表の更新
- **リスク**: 低（ドキュメントのみ）
- **要求ID**: A-2, A-3, L-1, L-6
- **推奨モデル**: Haiku

### PR 2: `auth/id-write-guard`
- **目的**: WriteGuard + ownership のテスト追加 + コンプライアンス確認
- **内容**:
  - `writeGuard.ts` のユニットテスト追加（全10段階の拒否チェーン）
  - `ownership.ts` のユニットテスト追加（4権限モード × セクションキー）
  - TOS状態がCurrentUser/Contextで取得可能かの確認
  - canEditVideo の requiredKey 省略が発生していないかの確認
- **リスク**: 低（テスト追加のみ、既存実装は完全）
- **要求ID**: B-1〜B-7, D-6, E-1〜E-6, G-1〜G-7
- **推奨モデル**: Sonnet

### PR 3: `posting/youtube-id-and-active-x`
- **目的**: 投稿フローのコンプライアンス確認 + YouTube ID正規化の検証
- **内容**:
  - 枠なし投稿でcontact_x_id自由入力が無効化されているかの確認
  - 未連携X IDを自動作成して即公開しないことの確認
  - YouTube URL/短縮URL/ID入力の正規化が実装済みかの確認
  - 必要に応じてテスト追加
- **リスク**: 中（投稿フローの権限確認）
- **要求ID**: D-1〜D-7, G-1, G-2, G-3, O-3, O-5
- **推奨モデル**: Sonnet

### PR 4: `slots/reservation-groups`
- **目的**: 連続枠ロジックのテスト追加 + コンプライアンス確認
- **内容**:
  - `slot.ts` のユニットテスト追加（予約/解放/分割/拡張/結合/ロールバック）
  - reservation_group_id の整合性確認
  - submitted枠が通常解放されないことの確認
  - 中央解放でグループ分割されることの確認
- **リスク**: 中（スロット整合性）
- **要求ID**: F-1〜F-6, J-10
- **推奨モデル**: Sonnet

### PR 5: `slots/part-numbering`
- **目的**: 部番号算出ロジックのテスト追加 + コンプライアンス確認
- **内容**:
  - 部番号算出ロジックのユニットテスト追加
  - デフォルト30分、異常値30分の確認
  - 日付変更・slot_kind変更で部が分かれることの確認
  - 管理画面で算出根拠を確認できることの確認
- **リスク**: 低
- **要求ID**: F-4, F-5, Q-3
- **推奨モデル**: Sonnet

### PR 6: `interactions/x-id-library`
- **目的**: いいね/セーブ/ライブラリがX ID単位かの確認 + テスト追加
- **内容**:
  - `videoInteractions` の保存主体がX IDかの確認
  - Active X ID切替で内容が切り替わることの確認
  - 未承認X ID/BAN/TOS/CostGuard が効くことの確認
  - 全て再生プレイリストが正しく出ることの確認
- **リスク**: 低
- **要求ID**: A-5, G-1〜G-7, I-1, I-3, J-14
- **推奨モデル**: Sonnet

### PR 7: `comments/chapter-comments-only`
- **目的**: チャプターコメントのコンプライアンス確認
- **内容**:
  - 独立コメント欄がないことの確認
  - video_comments を新規利用していないことの確認
  - コメントが必ず時刻に紐づくことの確認
  - marker_kind に依存した分岐を増やしていないことの確認
  - private表示範囲が守られていることの確認
- **リスク**: 低
- **要求ID**: H-1〜H-8, J-1〜J-3
- **推奨モデル**: Sonnet

### PR 8: `api/public-whitelist`
- **目的**: 公開APIの返却項目ホワイトリスト確認 + リークテスト
- **内容**:
  - `check:public-api-leaks` スクリプトの実行
  - Discord ID/email/role/is_banned/TOS/active_x_user_id が返されていないことの確認
  - ページネーション・limit上限・キャッシュ戦略の確認
  - 個別動画APIルートの存在確認（必要に応じて追加）
- **リスク**: 中（セキュリティ）
- **要求ID**: J-13, N-1〜N-6, L-2
- **推奨モデル**: Sonnet/Opus

### PR 9: `admin/health-security`
- **目的**: health/security チェックの実装確認
- **内容**:
  - `healthChecks.ts` の全チェック項目がカバーされていることの確認
  - security チェック（access_token null、rejected X ID、BANユーザー書き込み等）の確認
  - 管理操作が historyLogs に残ることの確認
- **リスク**: 低
- **要求ID**: N-1〜N-6, P-4
- **推奨モデル**: Sonnet

### PR 10: `ui/navigation-entry-forms`
- **目的**: UI/UX のコンプライアンス確認
- **内容**:
  - 上部バーの情報量整理確認
  - エントリーページが2択中心かの確認
  - トップページに開催日時・募集期間・残り枠があることの確認
  - 編集フォームのセクション分割確認
  - 編集可能/不可がUIで分かることの確認
- **リスク**: 低
- **要求ID**: A-1〜A-4, B-4〜B-7, C-1〜C-8, I-1〜I-6, O-1〜O-5, Q-1〜Q-6
- **推奨モデル**: Sonnet

### PR 11: `db/cleanup-legacy-import`
- **目的**: DB整理 + 旧データ取り込みの安全確認
- **内容**:
  - video_comments が deprecated 扱いであることの確認
  - outro_comment/closing_comment の統一確認
  - 旧データ取り込みのDry Run確認
  - primary_event_id と video_events の同期確認
- **リスク**: 中（DB整合性）
- **要求ID**: J-1〜J-17, M-1〜M-5
- **推奨モデル**: Sonnet/Opus

### PR 12: `ops/notifications-workers-audit`
- **目的**: 通知/Worker/監査ログのコンプライアンス確認
- **内容**:
  - 通知キューが正しく動作することの確認
  - Worker実装状態のMarkdown化
  - 監査ログが重要操作で残ることの確認
  - 危険操作モーダル・影響件数表示の確認
- **リスク**: 低
- **要求ID**: K-1〜K-5, L-1〜L-6, P-1〜P-6
- **推奨モデル**: Sonnet

---

## 3. フェーズ実行順序

### Phase 0: 現状把握（完了）
- 関連ファイル地図の作成 ✓
- PR分割案の策定 ✓
- 実装済み/不足の分類 ✓

### Phase 1-3: コア権限・投稿・スロット（高リスク）
1. **PR 2** `auth/id-write-guard` — テスト追加 + コンプライアンス
2. **PR 3** `posting/youtube-id-and-active-x` — 投稿フロー確認
3. **PR 4** `slots/reservation-groups` — スロット整合性テスト
4. **PR 5** `slots/part-numbering` — 部番号テスト

### Phase 4-6: インタラクション・コメント・API（中リスク）
5. **PR 6** `interactions/x-id-library` — X ID主体確認
6. **PR 7** `comments/chapter-comments-only` — チャプターコメント確認
7. **PR 8** `api/public-whitelist` — APIリークテスト（Opusレビュー推奨）
8. **PR 9** `admin/health-security` — health/security確認

### Phase 7-8: UI・DB・運用（低〜中リスク）
9. **PR 10** `ui/navigation-entry-forms` — UI/UX確認
10. **PR 11** `db/cleanup-legacy-import` — DB整合性確認
11. **PR 12** `ops/notifications-workers-audit` — 通知/Worker確認

### Phase 9: 最終レビュー（Opus必須）
12. **PR 1** `docs/implementation-plan` — 最終計画書マージ

---

## 4. リスクエリア：Opus判断が必要な箇所

| 要求ID | 箇所 | 理由 |
|---|---|---|
| C-8 | 状態バッジ | 保留扱い。情報過多を避けつつ必要画面では表示可 |
| J-9 | イベント編集者 | 保留。既存方針を崩さず、矛盾箇所だけ整理 |
| P-6 | 物理削除 | 要再検討。復元機能未実装の間は危険操作を制限 |
| J-7 | X ID再申請情報 | 当面作品本体に保持。別テーブル化は必須ではない |
| J-8 | 無効化情報 | 当面作品本体に保持。別テーブル化は必須ではない |
| G-2 | X ID却下時の枠解放 | 未提出枠解放は自動でなく手動。影響件数を表示し、解放/維持を選択 |
| D-1 | 枠なし投稿の即public | 連携済みActive X IDなら即public。条件を満たせば審査待ちにしない |

---

## 5. 検証戦略

### 各PR共通
```sh
npm run typecheck
npm run build
npm run test:unit
```

### PR別個別検証
| PR | 個別コマンド |
|---|---|
| PR 2 (auth) | テスト追加実行、API直叩きテスト（権限なしユーザーで全編集系操作を試行） |
| PR 3 (posting) | 投稿フローの手動テスト（枠なし/枠あり、Active X ID切替） |
| PR 4 (slots) | 連続枠テスト（予約→解放→分割→拡張→結合） |
| PR 5 (part-numbering) | 部番号再計算テスト |
| PR 6 (interactions) | Active X ID切替テスト |
| PR 7 (chapter) | チャプターコメント投稿テスト |
| PR 8 (api) | `npm run check:public-api-leaks` |
| PR 9 (health) | health/securityチェック画面の手動確認 |
| PR 10 (ui) | モバイル/PC両方でのUI確認 |
| PR 11 (db) | `npm run db:migrate`（ローカル）、Dry Run |
| PR 12 (ops) | 通知送信テスト、Worker動作確認 |

### マージ前最終確認（PR 12完了後）
1. `npm run typecheck` — 通ること
2. `npm run build` — 通ること
3. DB migration がローカルで通ること
4. 権限なしユーザーでAPI直叩きテスト済み
5. X ID切替テスト済み
6. 連続枠の部分解放テスト済み
7. 連続枠の拡張テスト済み
8. 部番号再計算テスト済み
9. チャプターコメント投稿テスト済み
10. 公開APIのリークチェック済み
11. health/securityチェック済み

---

## 6. ブロッカー（マージ不可条件）

以下の1つでも該当する場合はマージ不可：

- フロントだけで権限制御している
- API直叩きで権限なし更新ができる
- Discord IDとX IDの主体が混ざっている
- 未承認X IDで投稿、チャプターコメント、いいね、セーブ、ライブラリができる
- owner_discord_user_idだけで作品編集できる
- contact_x_id自由入力で即公開できる
- 連続枠の部分解放・拡張でグループ整合性が壊れる
- submitted枠を通常解放できる
- 部番号が前方追加や休憩閾値で再計算されない
- video_commentsを新規利用している
- marker_kind依存の分岐を増やしている
- 公開APIで内部情報を返している
- health/securityチェック項目が未実装のまま、実装済み扱いになっている
- build/typecheckが通らない

---

## 7. 4原典カバレッジ確認

各PRでPR本文に以下を含める：

```md
## 対応した要求ID
- 例: B-1, B-6, E-1, E-3, E-4

## 対応しない要求ID
- 今回のPR範囲外: ...

## Opus判断が必要な要求ID
- 例: C-8, J-9, P-6

## 4原典の反映確認
- [ ] flamenode_final_detailed_design.md
- [ ] flamenode_final_implementation_checklist.md
- [ ] flamenode_final_consistency_audit.md
- [ ] requirements-map.md
```

---

## 8. まだコード変更していないことの確認

本計画書は Phase 0 の調査結果であり、コード変更は一切行っていない。
