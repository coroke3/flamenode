# FlameNode Product Requirements Reconciliation

> Status: Active / requirement preservation source of truth
> Last updated: 2026-10-07
> Applies to: every `/flamenode-migration` task

移行では「今のコード」と「過去/現行の設計文書」のどちらか一方だけを正しいものとして扱わない。
CURRENT productionの挙動を保護しつつ、設計意図を照合し、矛盾を明示して改善候補へ変換する。

## Source precedence

### 1. CURRENT behavior evidence
最優先の事実確認元。

- production/current code
- tests
- DB schema/migrations
- Cloudflare config/bindings/routes
- current operational docs
- actual API/action/job contracts

### 2. Active product/design intent
CURRENT behaviorの意味・背景・未実装要件を確認する入力。

- `AGENTS.md`
- `.claude/flamenode/requirements-map.md`
- `.claude/flamenode/source/flamenode_final_detailed_design.md`
- `.claude/flamenode/source/flamenode_final_consistency_audit.md`
- `docs/operations/ui-acceptance.md`
- `docs/operations/*.md`
- `設計/` の現在参照されている仕様

### 3. Historical/archive material
背景確認専用。CURRENTへ自動復活させない。

## Requirement states

| State | Meaning |
| --- | --- |
| `CURRENT_CONFIRMED` | current code/test/configで観測・確認済み |
| `CURRENT_AUDIT_REQUIRED` | currentに存在する可能性が高いが詳細監査待ち |
| `REQUIREMENT_CONFIRMED` | design intentとCURRENTが一致 |
| `REQUIREMENT_ONLY` | 文書にはあるがCURRENT実装未確認 |
| `CURRENT_DIVERGENCE` | CURRENTが既存設計文書と意図的/実質的に異なる |
| `IMPROVEMENT_CANDIDATE` | UX/保守性/性能改善候補。未承認 |
| `REMOVAL_PROPOSED` | 削除候補。明示承認前は維持 |
| `REMOVED_APPROVED` | 明示承認済み |

## Reconciliation rule

矛盾を見つけた場合:

1. CURRENT code/test/configで実挙動を特定する。
2. 既存設計文書が期待している挙動を記録する。
3. frontend-visible impact、permission、安全性、data影響を比較する。
4. `CURRENT_DIVERGENCE`として記録する。
5. CURRENTを黙って設計文書へ戻さない。
6. 設計文書を黙ってCURRENTへ書き換えない。
7. 変更価値があれば`IMPROVEMENT_CANDIDATE`として提案する。
8. frontend behavior変更を伴う場合はユーザー承認までCURRENT維持をdefaultにする。ただし、この文書またはユーザー指示でTARGET requirementが明示確定した事項（例: Active X interaction ownership）はCURRENT維持defaultよりTARGET requirementを優先し、`CURRENT_DIVERGENCE`として記録する。

## Known reconciliation cautions

### Identity / interaction ownership

MIG-0011 Frontend reconciliationでTARGET identity原則を次として確定する。

```text
authentication principal = Auth User
acting/content/interaction identity = Active X
```

- Discord/Auth Userはlogin、session、account security、ban、role、security provenanceの正本として維持する。
- Active XはFlameNode上でどのX identityとして行動・投稿・interactionするかの主体。
- CURRENTのlike/bookmark/library interactionには `videoInteractionsAuth.auth_user_id` を使うpathがある。
- これらを「CURRENTなので維持」と判断しない。TARGETと不一致のため `CURRENT_DIVERGENCE` とする。
- migration実装時はinteraction ownershipをActive Xへreconcileする。MIG-0011 Frontend PRではproduction schema/codeを変更しない。
- `approved_by_auth_user_id`、`edit_granted_by_auth_user_id`、audit `actor_user_id`、notification delivery recipient、session/security identifiers等、security/account provenanceを表すAuth User IDを機械的にActive Xへ置換しない。
- event/video authorizationでは、Active Xを唯一のsecurity authz sourceにしない。Auth Userに紐づくapproved Xとcanonical permissionをserverで解決し、user-visible acting identityとauthorization principalを分離する。

詳細なdomain別dispositionは `gap-scan/FRONTEND_REQUIREMENTS.md` を正本とする。

#### Active X interaction 移行手順 (Migration Sequence)

1. **Step 1: データスキーマ準備 (Schema Migration)**
   - インタラクション（いいね・ブックマーク）の正本キーを `(video_id, x_user_id)` とし、`x_user_id` ベースのテーブル・インデックスを確立。
   - 監査要件のため、実行元の Auth User は監査ログ（`actor_user_id`）で追跡する Dual Attribution 構造を維持。
2. **Step 2: 既存データの引き継ぎ・バックフィル (Data Backfill)**
   - 既存 `video_interactions_auth`（`auth_user_id` 単位）のデータを、各ユーザーの承認済みアクティブ X ID（`users.active_x_user_id`）へ紐づけてバックフィル。
   - 承認済み X ID が未設定のユーザーのデータは退避テーブルへ保持し、X ID 連携完了時に自動反映。
3. **Step 3: バックエンド・API 契約の切り替え (API Transition)**
   - Hono API / アクション層において、セッションの Auth User を検証した上で、操作主体として承認された `active_x_user_id` を解決して書き込み・トグルを実行。
   - 権限のない X ID による偽装をサーバ側で fail-closed 防御。
4. **Step 4: フロントエンド・ライブラリ表示の更新 (UI Reconciliation)**
   - `/dashboard/library` 等のライブラリ画面を「選択中の Active X に紐づく一覧」へ切り替え。
   - ヘッダー等での Active X 切り替えと連動し、行動主体がどの名義であるかを視覚的に明示。
   - **未連携ユーザーへの登録モーダル表示**: 承認済み Active X が未設定の一般ログインユーザーがいいねやブックマークを操作した場合、拒否・サイレント無視ではなく「Active X 登録・連携モーダル」をオーバーレイ表示してクリエイター名義の登録を促す（ユーザー合意確定）。
5. **Step 5: 旧パスの段階廃止 (Deprecation & Cleanup)**
   - 移行期間を経て、旧 `auth_user_id` 単位の書き込みパスを停止。整合性検証完了後に旧カラム/テーブルを安全に整理。

### Chapter/comment model
CURRENTは独立した自由コメント欄ではなく、時間付きchapter/comment体験を中心にしている。MIG-0011 Frontend reconciliationではこのCURRENT modelをTARGET product behaviorとして採用し、historicalな独立free-comment requirementは`OBSOLETE`とする。

- `video_chapters` / chapter UI / current codeを正本として扱う。
- historical table/field名や独立free-comment UIを移行先へ復活させない。
- public/private、approved Active X投稿主体、player seek、reflection delayなどobservable behaviorを維持する。
- **チャプター削除・変更時の挙動**: 親チャプターが削除された場合、紐づいていたコメントは物理削除せず論理保持（浮遊コメント化）し、動画全体のコメント一覧や「旧チャプター」としてフォールバック表示する。タイムスタンプ変更時はチャプターIDに追従して新しい秒数でシーク・連動する。

### UI redesign and Migration Strategy
以前の`docs/design-redesign`は移行入力から外す。

- 旧mock/旧visual proposalを新UI正本として使わない。
- **デザイン適用戦略（案A正式採用）**:
  - **公開画面（Phase 4/5）**: ユーザーから後日提供される新 HTML mock を適用。
  - **管理画面・ダッシュボード（Phase 7）**: 現行 UI/コンポーネント資産を `packages/ui` へ抽出し流用（移行効率を最優先）。
- **Phase 依存関係のアンブロック**:
  - UI デザインに依存しない **Phase 3（ドメイン抽出: MIG-0301〜MIG-0307）** は、Phase 2 の HTML モック提供を待たずに先行して着手可能とする。

### Astro SSG Build Trigger & Free Tier Budget
Cloudflare Free 枠（Pages 月500回ビルド等）の制約を遵守する:
- 投稿・更新のたびに全ページを SSG フルビルドしない。
- 主要ページ（トップ、一覧の1ページ目等）は事前静的生成し、作品個別ページは ISR / On-Demand または Queue バッチによるデバウンス（5分バッチ）SSG ビルドトリガーとする。

## Preservation contract

明示承認なしで変更しないもの:

- user-visible capabilityの存在
- URL/deep-link/query/history semantics
- role/permission semantics
- owner invariant
- login/session/account linking semantics
- validation/business rules
- destructive action semantics
- public/private visibility
- auditability
- notification/external side effects
- Queue retry/idempotency guarantees
- success/error/pending/degraded states
- data ownership and canonical source

変更可能:

- implementation framework
- module boundaries
- API transport
- data access/query organization
- cache/projection/build strategy
- commonization
- component composition
- visual hierarchy/layout after HTML mock is registered

ただし変更可能領域でもobservable behaviorを壊さない。

## Requirement ledger template

重要な矛盾または要件のみ存在する項目を見つけたら、対象domain ledgerまたはMIG task notesへ以下を記録する。

```text
Requirement:
Source:
State:
CURRENT evidence:
Design intent:
Frontend impact:
Permission/privacy impact:
Data/side-effect impact:
Recommendation:
Approval required:
Related UX IDs:
Related FN IDs:
Migration task:
```

## Phase 0 gate contribution

MIG-0011終了時:

```text
Unresolved CURRENT_DIVERGENCE affecting migration = 0
REQUIREMENT_ONLY without disposition = 0
Intentional feature removals without approval = 0
Frontend-changing optimization blockers without decision = 0
```

要件が不明な場合、簡略化を優先して消すのではなく、`BLOCKED`として保持する。