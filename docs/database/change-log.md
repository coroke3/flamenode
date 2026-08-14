# DB Change Log

## 2026-08-15 — `0058_event_youtube_description_template.sql`

| Item | Content |
| --- | --- |
| Type | additive |
| Summary | Add an optional event-scoped plain-text template for YouTube descriptions. |
| Reason | Let each event define reusable work variables so creators can copy a ready-to-paste YouTube description. |
| Tables | `events` |
| Data migration | none |
| Compatibility | Existing events remain unset; the feature is opt-in and does not change public DTOs. |
| Data loss | none |
| Rollback | manual restore from backup; no destructive rollback is used. |
| Validation | `check:db-schema`, `check:db-migration`, `check:db-history`, template unit tests, typecheck |

## 2026-08-14 — `0055_notification_outbox_latest_idx.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | `/admin/notifications` の `ORDER BY created_at DESC LIMIT 100` 用 index を追加 |
| Reason | 既存の status 複合 index は status 未指定の最新一覧で利用されず、全件 scan + sort になっていたため |
| Tables | `notification_outbox` |
| Data migration | なし |
| Compatibility | 追加 index のみ。既存の配送・dedupe index は維持 |
| Data loss | none |
| Rollback | `DROP INDEX IF EXISTS notification_outbox_created_idx` |
| Validation | `EXPLAIN QUERY PLAN`、`check:db-schema`、`check:db-migration`、typecheck |

## 2026-08-14 — `0056_admin_operational_count_indexes.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive / partial index |
| Summary | 管理トップの pending X ID申請と open moderation 集計用 index を追加 |
| Reason | 既存 index は status が先頭列でなく、該当クエリが全件 scan になっていたため |
| Tables | `x_identity_requests`, `video_moderation_cases` |
| Data migration | なし |
| Compatibility | status 条件付きの追加 index のみ。既存 index は維持 |
| Data loss | none |
| Rollback | `DROP INDEX IF EXISTS x_identity_requests_pending_type_idx; DROP INDEX IF EXISTS video_moderation_cases_open_due_idx` |
| Validation | `EXPLAIN QUERY PLAN`、`check:db-schema`、`check:db-migration`、typecheck |

> Status: Active
> Last verified: 2026-08-14
> Verified against commit: `32b57e16`
> Source of truth: `migrations/` active path, `src/lib/db/schema.ts`

## 2026-08-14 — `0057_x_id_slot_bind_recovery.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive / partial index |
| Summary | X ID承認後の予約枠bindを `pending` / `complete` で追跡し、bounded recoveryとmigration前approved link/aliasの再検査を可能にする |
| Reason | 承認transaction後のslot bind失敗を再試行可能にし、30件超の予約枠を段階処理するため |
| Tables | `x_identity_requests`, `slots` |
| Data migration | 既存申請は `slot_bind_status=complete`、試行回数は `0` の既定値 |
| Compatibility | 旧slots予約主体列と `slot_reservation_groups` expand構造を維持 |
| Data loss | none |
| Rollback | 追加indexは `DROP INDEX IF EXISTS`、列はバックアップ復元 |
| Validation | `check:db-schema`、`check:db-migration`、reservation identity / slot bind tests |

## 2026-08-07 — `0053_slot_reserved_x_id_snapshot.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | 枠取得時 X ID スナップショット列 `reserved_x_id_snapshot` を追加し、既存の `x_user_id` がある行だけ安全にバックフィル |
| Reason | pending X 申請での枠確保や Active X 切替後も、確保時点の名義 X を公開・運営 UI で安定表示するため |
| Tables | `slots` |
| Data migration | `x_user_id IS NOT NULL` の行だけ `reserved_x_id_snapshot = x_user_id`。現在の active X / pending からの推測はしない |
| Compatibility | 旧列維持。`0052` 完了後に適用 |
| Data loss | none |
| Rollback | migration 適用前バックアップから復元 |
| Validation | `check:db-schema`, `check:db-history`, `check:slot-reservation-groups`, typecheck, slot contract test |
| PR | #169 |

## 2026-08-02 — `0052_video_interactions_auth_expand.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | Auth user 単位のいいね・セーブ正本 `video_interactions_auth` を追加し、owner が 1 人の既存行だけをバックフィル |
| Reason | Active X 切替でライブラリが変わらないよう、FlameNode 内反応を Auth user 正本へ移行するため |
| Tables | `video_interactions_auth` |
| Data migration | `video_interactions` から owner 1 人のみバックフィル。曖昧行は一時 report 後破棄 |
| Compatibility | 旧 `video_interactions` は維持。`0051` 完了後に適用 |
| Data loss | none |
| Rollback | migration 適用前バックアップから復元 |
| Validation | `check:db-schema`, `check:video-interactions-auth`, unit test, typecheck |
| PR | Agent E v9 第1波 |

## 2026-08-02 — `0051_slot_reservation_groups_expand.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | 連続枠予約主体を正規化する `slot_reservation_groups` テーブルを追加 |
| Reason | slots 各行への主体重複保存を段階的に解消し、expand 期間は旧列を維持するため |
| Tables | `slot_reservation_groups` |
| Data migration | なし（`backfill:slot-reservation-groups` で手動補完） |
| Compatibility | expand 期間中は slots 旧列を維持。`0050` 完了後に適用 |
| Data loss | none |
| Rollback | migration 適用前バックアップから復元 |
| Validation | `check:db-schema`、`check:slot-reservation-groups`、typecheck |
| Pending | `docs/database/pending/slot-reservation-groups-contract.sql` |
| PR | Agent D |

## Pending — moderation open case partial unique

| 項目 | 内容 |
| --- | --- |
| Type | pending contract |
| Summary | (video_id, case_type) の open case 重複を防ぐ partial unique index |
| Reason | void 化・moderation 作成時の open case 再利用と整合させるため |
| Location | `docs/database/pending/video-moderation-open-unique.sql` |
| Validation | `check:moderation-open-cases` で重複0件を確認してから適用 |

## 2026-08-02 — `0050_x_identity_request_decisions.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | `x_identity_requests` に判断メタデータ列を追加し、`audit_logs` に `actor_x_user_id` を追加 |
| Reason | X ID申請の判断理由・判断者・判断日時と監査 actor X を正本へ残すため |
| Tables | `x_identity_requests`, `audit_logs` |
| Data migration | なし |
| Compatibility | `0049` 完了後に適用 |
| Data loss | none |
| Rollback | 適用前 D1 バックアップから復元 |
| Validation | `check:db-schema`, typecheck |
| PR | Agent C |

## 2026-08-02 — `0049_public_visibility_fences.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | 非公開化フェンス追跡用 `public_visibility_fences` テーブルを追加 |
| Reason | R2 manifest と D1 の token 一致解除、非公開化順序の監査を可能にするため |
| Tables | `public_visibility_fences` |
| Data migration | なし |
| Compatibility | `0048` 完了後に適用。未適用時は fence 書き込みを fail-closed |
| Data loss | none |
| Rollback | migration 適用前バックアップから復元 |
| Validation | `check:db-schema`、`check:public-visibility-fences`、typecheck |
| PR | （本変更） |

## 2026-08-02 — `0048_cleanup_video_visibility_indexes.sql`

| 項目 | 内容 |
| --- | --- |
| Type | cleanup |
| Summary | 公開 static target probe 向けの video partial index を追加 |
| Reason | public miss 時の D1 probe を index 付きで安定化するため |
| Tables | `videos`（index のみ） |
| Data migration | なし |
| Compatibility | additive index のみ。既存 index は削除しない |
| Data loss | none |
| Rollback | 追加 index を DROP（本番ではバックアップ復元を推奨） |
| Validation | `check:db-schema`、publicData unit test |
| PR | （本変更） |
## 2026-08-01 窶・`0047_backfill_youtube_metadata_pending.sql`

| 鬆・岼 | 蜀・ｮｹ |
| --- | --- |
| Type | data-migration |
| Summary | YouTube ID 繧呈戟縺､譌｢蟄倅ｽ懷刀縺ｮ縺・■縲∵ｬ謳阪＠縺ｦ縺・ｋ `video_youtube_metadata` 陦後ｒ `pending` 縺ｧ陬懷ｮ・|
| Reason | YouTube 蜷梧悄蟇ｾ雎｡縺九ｉ貍上ｌ縺ｦ縺・◆譌ｧ菴懷刀繧貞ｮ牙・縺ｫ蜀肴､懆ｨｼ縺励ヽ2 `top.json` 縺ｮ縲梧≒縺九＠縺ｮ譏蜒上榊呵｣懊∈蜿肴丐縺ｧ縺阪ｋ繧医≧縺ｫ縺吶ｋ縺溘ａ |
| Tables | `video_youtube_metadata`・亥盾辣ｧ: `videos`・・|
| Data migration | 髱・`voided`繝ｻYouTube ID 縺ゅｊ繝ｻmetadata 谺謳阪・菴懷刀縺縺・`INSERT OR IGNORE`縲よ里蟄伜酔譛溽ｵ先棡縺ｯ譖ｴ譁ｰ縺励↑縺・|
| Compatibility | `0046` 螳御ｺ・ｾ後↓驕ｩ逕ｨ縲ょ酔譛欷orker縺・`pending` 繧貞・逅・＠縲∝・髢九・髯仙ｮ壼・髢九→遒ｺ隱阪〒縺阪◆菴懷刀縺縺鷹撕逧ЙSON縺ｸ謗ｲ霈・|
| Data loss | none |
| Rollback | migration 驕ｩ逕ｨ蜑阪ヰ繝・け繧｢繝・・縺ｨ縺ｮ蟾ｮ蛻・↓縺ゅｋ `pending` 陦後□縺代ｒ蜑企勁 |
| Validation | `check:db-schema`縲（ntegration test縲仝orker test縲》ypecheck |
| PR | ・域悽螟画峩・・|

## 2026-08-01 窶・`0046_video_creator_profile_snapshot.sql`

| 鬆・岼 | 蜀・ｮｹ |
| --- | --- |
| Type | additive |
| Summary | videos 縺ｫ謠仙・閠・・繝ｭ繝輔ぅ繝ｼ繝ｫ繧ｹ繝翫ャ繝励す繝ｧ繝・ヨ蛻・`creator_profile_text` / `creator_other_social_links` 繧定ｿｽ蜉縺励∵里蟄倩｡後ｒ x_users 縺九ｉ繝舌ャ繧ｯ繝輔ぅ繝ｫ |
| Reason | 菴懷刀謠仙・譎らせ縺ｮ繝励Ο繝輔ぅ繝ｼ繝ｫ繧・videos 蛛ｴ縺ｸ蝗ｺ螳壹＠縲∝ｾ後°繧・x_users 縺悟､峨ｏ縺｣縺ｦ繧る℃蜴ｻ菴懷刀陦ｨ遉ｺ繧貞ｮ牙ｮ壹＆縺帙ｋ縺溘ａ |
| Tables | `videos` |
| Data migration | `creator_profile_text` / `creator_other_social_links` 繧・x_users 縺九ｉ繧ｳ繝斐・縲Ａcreator_youtube_channel_url` / `creator_icon_url` 縺・NULL 縺ｮ陦後ｂ蜷梧ｧ倥↓陬懷ｮ・|
| Compatibility | `0045` 螳御ｺ・ｾ後・ canonical 迥ｶ諷九・縺ｿ驕ｩ逕ｨ縲る℃蜴ｻ謠仙・譎らせ縺ｮ蛟､縺ｯ蠕ｩ蜈・ｸ榊庄・亥ｮ溯｡梧凾轤ｹ縺ｮ x_users 繧貞崋螳夲ｼ・|
| Data loss | none |
| Rollback | migration 驕ｩ逕ｨ蜑阪・ D1 繝舌ャ繧ｯ繧｢繝・・縺九ｉ蠕ｩ蜈・|
| Validation | `check:db-schema`縲（ntegration test縲》ypecheck |
| PR | ・域悽螟画峩・・|

## 2026-07-31 窶・`0045_align_visibility_defaults.sql`

| 鬆・岼 | 蜀・ｮｹ |
| --- | --- |
| Type | cleanup |
| Summary | events/videos 縺ｮ迚ｩ逅・default 繧・`private` / `pending` 縺ｫ謠・∴縲！NSERT 豁｣隕丞喧 trigger 繧貞炎髯､ |
| Reason | Drizzle 豁｣譛ｬ縺ｨ迚ｩ逅・DB default 縺ｮ荳堺ｸ閾ｴ縲√♀繧医・ `INSERT RETURNING` 譎ゅ・蛟､縺壹ｌ繝ｪ繧ｹ繧ｯ繧定ｧ｣豸医☆繧九◆繧・|
| Tables | `events`縲～videos` |
| Data migration | 縺ｪ縺暦ｼ域里蟄倩｡後・ visibility_status 縺ｯ螟画峩縺励↑縺・ｼ・|
| Compatibility | `0044` 螳御ｺ・ｾ後・ canonical 迥ｶ諷九・縺ｿ驕ｩ逕ｨ縲Ｓeject/update trigger 縺ｯ邯ｭ謖・|
| Data loss | none |
| Rollback | migration 驕ｩ逕ｨ蜑阪・ D1 繝舌ャ繧ｯ繧｢繝・・縺九ｉ蠕ｩ蜈・|
| Validation | `check:db-schema`縲（ntegration test縲》ypecheck縲「nit縲『orkers |
| PR | ・域悽螟画峩・・|

## 2026-07-20 窶・`0044_simplify_visibility_statuses.sql`

| 鬆・岼 | 蜀・ｮｹ |
| --- | --- |
| Type | cleanup |
| Summary | 菫ｮ豁｣蠕轡B豁｣譛ｬ縺ｸ縺ｮ遘ｻ陦悟ｾ後↓縲∽ｽ懷刀繝ｻ繧､繝吶Φ繝医・繧｢繝励Μ驕狗畑迥ｶ諷九ｒ謨ｴ逅・＠縲〆ouTube髯仙ｮ壼・髢九ｒYouTube繝｡繧ｿ繝・・繧ｿ縺ｸ蛻・屬 |
| Reason | FlameNode蜀・・蜈ｬ髢狗ｯ・峇縺ｨYouTube荳翫・蜈ｬ髢句玄蛻・ｒ豺ｷ蝨ｨ縺輔○縺壹∽ｸ区嶌縺阪・繧｢繝ｼ繧ｫ繧､繝悶・驥崎､・＠縺溷ｽｹ蜑ｲ繧貞ｻ・ｭ｢縺吶ｋ縺溘ａ |
| Tables | `videos`縲～video_youtube_metadata`縲～video_moderation_cases`縲～events` |
| Data migration | 蜍慕判`limited`繧蛋public`縺ｸ遘ｻ縺雄ouTube蜈ｬ髢句玄蛻・ｒ`unlisted`縺ｨ縺励※菫晏ｭ倥ょ虚逕ｻ`draft / archived / hidden`繧貞次蜑㌔private`縲√う繝吶Φ繝・draft`繧蛋private`縲～archived`繧蛋public`縺ｸ遘ｻ陦後Ａarchived`縺九ｉ`private`縺ｸ縺ｮ螟画鋤縺ｧ譌｢蟄倬Κ蛻・ｸ諢丞宛邏・↓謚ｵ隗ｦ縺吶ｋ陦後□縺代〆ouTube ID繧剃ｿ晄戟縺励◆縺ｾ縺ｾ逶｣譟ｻ莉倥″縺ｧ`voided`縺ｸ謖ｯ繧雁・縺・|
| Compatibility | `0043`螳御ｺ・ｒguard縺ｧ遒ｺ隱阪よ立迚ｩ逅・efault逕ｱ譚･縺ｮ`draft`縺縺代ｒINSERT蠕後↓豁｣隕丞喧縺励√◎縺ｮ莉悶・譌ｧ迥ｶ諷九・INSERT繝ｻUPDATE繧呈拠蜷ｦ |
| Data loss | none縲ゆｽ懷刀繝ｻ繧､繝吶Φ繝郁｡後→`videos.youtube_video_id`縺ｯ蜑企勁縺励↑縺・|
| Rollback | 迥ｶ諷九・諢丞袖縺悟､峨ｏ繧九◆繧√［igration驕ｩ逕ｨ蜑阪・D1繝舌ャ繧ｯ繧｢繝・・縺九ｉ蠕ｩ蜈・|
| Validation | 41繝・・繝悶Ν409繧ｫ繝ｩ繝縺ｮ豁｣譛ｬ讀懈渊縲∬ｪ､鬆・ｺ城←逕ｨ縺ｮfail-fast縲ヾQLite integration縲》ypecheck縲´int縲「nit縲仝orker縲，loudflare螂醍ｴ・¨ext.js/Pages build縲∝・髢帰PI讀懈渊 |
| PR | `#88`・・#89`縺ｫ萓晏ｭ假ｼ・|

## 2026-07-20 窶・`0043_db_canonical_migration.sql`

| 鬆・岼 | 蜀・ｮｹ |
| --- | --- |
| Type | destructive |
| Summary | X蜷咲ｾｩ繝ｻ逕ｳ隲九・繧､繝吶Φ繝・wner繝ｻ菴懷刀髢｢騾｣繝ｻ逶｣譟ｻ險ｭ螳壹ｒ41繝・・繝悶Ν409繧ｫ繝ｩ繝縺ｮ菫ｮ豁｣蠕梧ｭ｣譛ｬ縺ｸ遘ｻ陦後＠縲∵立繝・・繝悶Ν8莉ｶ繝ｻ譌ｧ繧ｫ繝ｩ繝25莉ｶ繝ｻ譌ｧ蜷咲ｧｰ2莉ｶ繧貞炎髯､ |
| Reason | 譛ｬ譬ｼ驕狗畑蜑阪↓驥崎､・ｭ｣譛ｬ縺ｨ逶ｴ謗･FK繧貞ｻ・ｭ｢縺励∽ｸ闊ｬ繝ｩ繝ｳ繧ｿ繧､繝繧呈眠豁｣譛ｬ縺縺代∈邨ｱ荳縺吶ｋ縺溘ａ |
| Tables | `x_identity_requests`縲～x_user_account_links`縲～x_users`縲～events`縲～event_staff`縲～videos`縲～video_members`縲～video_chapters`縲～system_settings`縺ｻ縺・|
| Data migration | 譌ｧX逕ｳ隲九・逶ｴ謗･user繝ｪ繝ｳ繧ｯ繝ｻowner繝ｻJSON繝√Ε繝励ち繝ｼ繝ｻYouTube蜍慕判ID繝ｻ逶｣譟ｻ險ｭ螳壹ｒ譁ｰ豁｣譛ｬ縺ｸ螟画鋤縲Ａevents.max_slots_per_video`縺ｯ菫晄戟 |
| Compatibility | 荳闊ｬ繝ｩ繝ｳ繧ｿ繧､繝縺ｮ蠕梧婿莠呈鋤縺ｯ謠蝉ｾ帙＠縺ｪ縺・よ立蠖｢蠑上う繝ｳ繝昴・繝医・蜈･蜉帙ｒcanonical plan縺ｸ螟画鋤縺励∵眠豁｣譛ｬ縺縺代∈菫晏ｭ・|
| Data loss | intentional縲ょｻ・ｭ｢貂医∩讖溯・縲∝､夜Κ逕ｱ譚･interaction縲∝呵｣懷ｱ･豁ｴ縲∵立遘ｻ陦檎ｮ｡逅・ユ繝ｼ繝悶Ν繧貞炎髯､ |
| Rollback | 驕ｩ逕ｨ蜑好1繝舌ャ繧ｯ繧｢繝・・縺ｨ0043驕ｩ逕ｨ蜑阪い繝励Μ繧ｱ繝ｼ繧ｷ繝ｧ繝ｳ繧貞酔譎ゅ↓蠕ｩ蜈・|
| Validation | Node SQLite縺ｮ遨ｺDB繝ｻ譌ｧfixture繝ｻ荳肴ｭ｣譌ｧ繝・・繧ｿ繝ｻ騾比ｸｭ迥ｶ諷・邉ｻ邨ｱ縺ｫ蜉縺医仝rangler繝ｭ繝ｼ繧ｫ繝ｫD1縺ｧ遨ｺDB/譌ｧfixture繧帝←逕ｨ縲・1繝・・繝悶Ν409繧ｫ繝ｩ繝縲∵立8繝・・繝悶Ν/譌ｧ25繧ｫ繝ｩ繝/譌ｧ蜷咲ｧｰ2莉ｶ荳榊ｭ伜惠縲｛wner/FK驕募渚0縲∽ｻｶ謨ｰ繝ｻ蜷咲ｧｰ螟画峩繝ｻmax_slots荳閾ｴ |
| PR | `agent/db-canonical-migration-v2` |

## 2026-07-13 窶・`0041_youtube_quota_budget.sql`

| 鬆・岼 | 蜀・ｮｹ |
| --- | --- |
| Type | additive |
| Summary | 蜊倅ｸYouTube API繧ｭ繝ｼ縺ｮ譌･谺｡quota菴ｿ逕ｨ驥上ｒ螟ｪ蟷ｳ豢区凾髢薙・譌･莉伜腰菴阪〒蜴溷ｭ千噪縺ｫ邂｡逅・☆繧九ユ繝ｼ繝悶Ν繧定ｿｽ蜉 |
| Reason | 讓呎ｺ・0,000 units/day縺ｮ80%・・,000 units繧巽lameNode蜈ｨ菴薙・荳企剞縺ｫ縺励∝酔譛溘・蟆・擂縺ｮ蜀咲函繝ｪ繧ｹ繝亥・逅・′蜷後§莠育ｮ励ｒ蜈ｱ譛峨〒縺阪ｋ繧医≧縺ｫ縺吶ｋ縺溘ａ |
| Tables | `external_api_quota_usage` |
| Data migration | 縺ｪ縺・|
| Compatibility | migration譛ｪ驕ｩ逕ｨ譎ゅ・YouTube蜷梧悄繧帝幕蟋九○縺喃ail-closed縺ｫ縺吶ｋ |
| Data loss | none |
| Rollback | `external_api_quota_usage`繧貞炎髯､ |
| Validation | schema/history讀懈渊縲仝orker/unit tests縲∫ｩｺDB縺ｸ縺ｮactive migration驕ｩ逕ｨ |
| PR | `agent/youtube-single-key-quota-budget` |

## 2026-07-13 窶・`0042_event_youtube_playlist_sync.sql`

| 鬆・岼 | 蜀・ｮｹ |
| --- | --- |
| Type | additive |
| Summary | 繧､繝吶Φ繝亥腰菴阪・YouTube蜀咲函繝ｪ繧ｹ繝亥酔譛溯ｨｭ螳壹→縲∝ｷｮ蛻・酔譛溽畑縺ｮ蜀咲函繝ｪ繧ｹ繝磯・岼邏｢蠑輔ｒ霑ｽ蜉 |
| Reason | 險ｭ螳壽ｸ医∩繧､繝吶Φ繝医□縺代ｒ蜀咲函繝ｪ繧ｹ繝医∈蜷梧悄縺励√Γ繧ｿ繝・・繧ｿ蜷梧悄縺ｨ蜷後§譌･谺｡80% quota莠育ｮ励ｒ蜈ｱ譛峨☆繧九◆繧・|
| Tables | `event_youtube_playlist_sync`縲～event_youtube_playlist_items` |
| Data migration | 縺ｪ縺励ょ・繧､繝吶Φ繝医〒蜷梧悄辟｡蜉ｹ縺九ｉ髢句ｧ・|
| Compatibility | migration譛ｪ驕ｩ逕ｨ譎ゅ・險ｭ螳夂判髱｢繝ｻ蜷梧悄Worker繧断ail-closed |
| Data loss | none |
| Rollback | 蜷梧悄繧堤┌蜉ｹ蛹門ｾ後・・岼邏｢蠑輔ユ繝ｼ繝悶Ν縲∬ｨｭ螳壹ユ繝ｼ繝悶Ν縺ｮ鬆・〒蜑企勁 |
| Validation | schema/history縲｝laylist parser/diff縲∝・譛衛uota縲仝orker縲¨ext.js/Pages build |
| PR | `agent/youtube-playlist-main-integration` |

## 2026-07-13 窶・`0040_worker_free_tier_scale.sql`

| 鬆・岼 | 蜀・ｮｹ |
| --- | --- |
| Type | additive |
| Summary | 螟ｧ隕乗ｨ｡繝・・繧ｿ譎ゅ・繧ｹ繧ｳ繧｢蟾ｮ蛻・峩譁ｰ繧鍛ounded index scan縺ｫ縺吶ｋ隍・粋index繧定ｿｽ蜉 |
| Reason | 蜈ｨ莉ｶID cursor蟾｡蝗槭ｒ蟒・ｭ｢縺励∝､画峩貂医∩繝ｻ譛滄剞蛻・ｌ菴懷刀繧呈怙螟ｧ150莉ｶ縺壹▽1 SQL縺ｧ譖ｴ譁ｰ縺励（ndex entry繧貞性繧D1 rows written縺ｮ譌･谺｡菴呵｣輔ｒ遒ｺ菫昴☆繧九◆繧・|
| Tables | `videos` |
| Data migration | 縺ｪ縺・|
| Compatibility | migration譛ｪ驕ｩ逕ｨ縺ｧ繧よｩ溯・縺吶ｋ縺後∝､ｧ驥上ョ繝ｼ繧ｿ縺ｧ縺ｯrows read縺悟｢励∴繧・|
| Data loss | none |
| Rollback | `videos_score_refresh_idx`繧貞炎髯､ |
| Validation | schema/history讀懈渊縲仝orker/unit tests縲∫ｩｺDB縺ｸ縺ｮactive migration驕ｩ逕ｨ |
| PR | `agent/cloudflare-free-tier-scale-v3` |

## 2026-07-13 窶・`0039_search_relation_indexes.sql`

| 鬆・岼 | 蜀・ｮｹ |
| --- | --- |
| Type | additive |
| Summary | 蜈ｬ髢倶ｽ懷刀讀懃ｴ｢繝ｻ繧ｯ繝ｪ繧ｨ繧､繧ｿ繝ｼ髮・ｨ医・蜈ｬ髢九メ繝｣繝励ち繝ｼ讀懃ｴ｢縺ｮ隍・粋index繧定ｿｽ蜉 |
| Reason | 譌｢蟄倥・讀懃ｴ｢譚｡莉ｶ縺ｨ髮・ｨ育ｵ先棡繧貞､峨∴縺壹∫嶌髢｢EXISTS縺ｨcreator/member髮・ｨ医・襍ｰ譟ｻ驥上ｒ蜑頑ｸ帙☆繧九◆繧・|
| Tables | `videos`縲～video_members`縲～video_chapters` |
| Data migration | 縺ｪ縺・|
| Compatibility | 隱ｭ縺ｿ蜿悶ｊ邨先棡縺ｯ荳榊､峨Ｎigration譛ｪ驕ｩ逕ｨ縺ｧ繧よｩ溯・縺吶ｋ縺悟・逅・柑邇・′菴惹ｸ九☆繧・|
| Data loss | none |
| Rollback | `videos_creator_public_idx`縲～video_members_x_user_video_idx`縲～video_chapters_video_visibility_idx`繧貞炎髯､ |
| Validation | schema/history讀懈渊縲∝・髢帰PI繝ｻWorker繝ｻunit tests縲∫ｩｺSQLite縺ｸ縺ｮactive migration驕ｩ逕ｨ |
| PR | main逶ｴ謗･螳溯｣・|

## 2026-07-13 窶・`0038_runtime_efficiency_resilience.sql`

| 鬆・岼 | 蜀・ｮｹ |
| --- | --- |
| Type | additive |
| Summary | Worker lease縺ｮ譛邨ょｮ溯｡檎憾諷句・縺ｨ縲∝・髢倶ｸ隕ｧ繝ｻ隱崎ｨｼ繝ｻ繧｢繧､繧ｳ繝ｳ陬懷ｮ後・鬆ｻ蜃ｺ隱ｭ蜿也畑隍・粋index繧定ｿｽ蜉 |
| Reason | Cron縺ｮ髫懷ｮｳ迥ｶ諷九ｒ菫晏ｭ倥＠縲∝・髢九・隱崎ｨｼ邨瑚ｷｯ繧鍛ounded query縺ｮ縺ｾ縺ｾ邯ｭ謖√☆繧九◆繧・|
| Tables | `worker_leases`縲～videos`縲～events`縲～x_users` |
| Data migration | 縺ｪ縺励りｿｽ蜉蛻励・譌｢蟄倩｡後〒`NULL`縺九ｉ髢句ｧ・|
| Compatibility | runtime DDL縺ｪ縺励ょ・繧定ｪｭ繧繧ｳ繝ｼ繝峨ｈ繧雁・縺ｫmigration驕ｩ逕ｨ縺悟ｿ・ｦ・|
| Data loss | none |
| Rollback | index蜑企勁縲りｿｽ蜉蛻励・髯､蜴ｻ縺悟ｿ・ｦ√↑蝣ｴ蜷医・migration蜑甲ackup縺九ｉ謇句虚蠕ｩ蜈・|
| Validation | schema/history讀懈渊縲仝orker/unit tests縲∫ｩｺDB縺ｸ縺ｮactive migration驕ｩ逕ｨ |
| PR | main逶ｴ謗･螳溯｣・|

## 2026-07-13 窶・`0003_large_collaboration_support.sql`

| 鬆・岼 | 蜀・ｮｹ |
| --- | --- |
| Type | additive |
| Summary | 螟ｧ隕乗ｨ｡蜷井ｽ懷髄縺代↓ audit_log_settings.max_payload_bytes 縺ｮ DEFAULT/蛟､繧・120000 縺ｸ蠑輔″荳翫￡ |
| Reason | 螳悟・縺ｪ繝｡繝ｳ繝舌・snapshot繧堤屮譟ｻ繝ｻ蠕ｩ蜈・庄閭ｽ縺ｪ遽・峇縺ｧ菫晄戟縺吶ｋ縺溘ａ |
| Tables | `audit_log_settings` |
| Data migration | 譌｢螳夊｡後・荳企剞蛟､縺・20000譛ｪ貅縺ｮ蝣ｴ蜷医□縺第峩譁ｰ |
| Compatibility | runtime fallback縺ｪ縺励Ｎigration譛ｪ驕ｩ逕ｨ譎ゅ・蟾ｨ螟ｧ繝｡繝ｳ繝舌・髮・粋縺ｮ逶｣譟ｻ縺後・繧､繝ｭ繝ｼ繝芽ｶ・℃縺ｫ縺ｪ繧翫≧繧・|
| Data loss | none |
| Rollback | migration蜑甲ackup縺九ｉ謇句虚蠕ｩ蜈・|
| Validation | schema/history讀懈渊縲》ypecheck |
| PR | main逶ｴ謗･螳溯｣・|

## 2026-07-13 窶・`0002_terms_reaccept_manual_cost_guard.sql`

| 鬆・岼 | 蜀・ｮｹ |
| --- | --- |
| Type | cleanup |
| Summary | 隕冗ｴ・・蜷梧э縺ｮbounded讀懃ｴ｢繧定ｿｽ蜉縺励，ostGuard繧呈焔蜍募宛蠕｡縺ｸ邨ｱ荳 |
| Reason | 螳滓ｸｬcollector縺ｮ縺ｪ縺・・蜍募愛螳壹ｒ豁｣譛ｬ縺ｫ縺帙★縲∝・蜷梧э蟇ｾ雎｡繧貞柑邇・ｈ縺乗歓蜃ｺ縺吶ｋ縺溘ａ |
| Tables | `user`縲～terms_versions`縲～user_tos_consents`縲～system_settings`縲Ａcost_usage_snapshots`縺ｯ蜑企勁 |
| Data migration | `user_tos_consents`繧巽K莉倥″縺ｮ譁ｰtable縺ｸ繧ｳ繝斐・縺励※鄂ｮ謠・|
| Compatibility | runtime fallback縺ｪ縺励よ眠繧ｳ繝ｼ繝峨・蜑阪↓驕狗畑閠・′backup縺ｨmigration驕ｩ逕ｨ繧堤｢ｺ隱・|
| Data loss | 譛ｪ險域ｸｬsnapshot table縺ｨ譛ｪ菴ｿ逕ｨ縺ｮ閾ｪ蜍募愛螳夊ｨｭ螳・蛻励ｒ蜑企勁 |
| Rollback | migration蜑甲ackup縺九ｉ謇句虚蠕ｩ蜈・|
| Validation | schema/history讀懈渊縲∝・蜷梧э/CostGuard unit繝ｻintegration |
| PR | main逶ｴ謗･螳溯｣・|

## 2026-07-13 窶・`0001_spreadsheet_import_runs.sql`

| 鬆・岼 | 蜀・ｮｹ |
| --- | --- |
| Type | additive |
| Summary | Spreadsheet import preview縺ｮHMAC nonce繧剃ｸ蠎ｦ縺縺大次蟄千噪縺ｫ豸郁ｲｻ縺吶ｋ遏ｭ譛殲un繧定ｿｽ蜉 |
| Reason | preview縺ｨapply縺ｮ蟾ｮ縺玲崛縺医・蜀榊茜逕ｨ繧帝亟縺弱∝酔荳plan縺縺代ｒ荳蠎ｦ驕ｩ逕ｨ縺吶ｋ縺溘ａ |
| Tables | `spreadsheet_import_runs` |
| Data migration | 縺ｪ縺・|
| Compatibility | runtime fallback縺ｪ縺励Ｎigration譛ｪ驕ｩ逕ｨ譎ゅ・preview/apply繧断ail-closed |
| Data loss | none |
| Rollback | manual |
| Validation | schema/history讀懈渊縲？MAC unit縲ヾQLite transaction integration |
| PR | main逶ｴ謗･螳溯｣・|

## 2026-07-11 窶・`0000_flame_node_baseline.sql`

| 鬆・岼 | 蜀・ｮｹ |
| --- | --- |
| Type | baseline |
| Summary | pre-production逕ｨ縺ｮ譛邨Ｄanonical schema繧堤ｩｺD1縺ｸ荳諡ｬ菴懈・縺吶ｋ縲・|
| Reason | 襍ｷ蜍墓凾縺ｮ閾ｪ蜍輔せ繧ｭ繝ｼ繝樣←逕ｨ縺ｨ譌ｧ蛻励・莠呈鋤邨瑚ｷｯ繧貞ｻ・ｭ｢縺励《chema縺ｨactive path繧剃ｸ諢丞喧縺吶ｋ縲・|
| Tables | Auth縲々 ID縲‘vent/slot/video縲∥udit縲〈ueue/outbox縲《tatic artifact縲『orker lease繧貞性繧蜈ｨactive table縲・|
| Data migration | 縺ｪ縺励よ立migration縺ｯ `migrations/historical/` 縺ｸ蜀・ｮｹ繧剃ｿ昴▲縺溘∪縺ｾ蛻・屬縲・|
| Compatibility | 譌ｧ蛻励・譌ｧtable縺ｨ縺ｮruntime莠呈鋤縺ｯ謠蝉ｾ帙＠縺ｪ縺・・|
| Data loss | intentional縲３emote D1繧・悽逡ｪ繝・・繧ｿ繧定・蜍募・譛溷喧縺励↑縺・・|
| Rollback | not safely reversible縲ょｿ・ｦ∵凾縺ｯ驕狗畑閠・′backup縺九ｉ蠕ｩ譌ｧ縺吶ｋ縲・|
| Validation | `check:db-schema`縲～check:db-history`縲∫ｩｺSQLite縺ｸ縺ｮbaseline驕ｩ逕ｨ縲・|
| PR | main逶ｴ謗･螳溯｣・|

譌ｧ蠖｢蠑上う繝ｳ繝昴・繝医・preview縺ｯ `spreadsheet_import_runs` 縺ｮ荳蠎ｦ髯舌ｊnonce縺ｨR2荳翫・canonical plan縺ｧ菫晁ｭｷ縺吶ｋ縲Ｂpply request body繧・立DB繝・・繝悶Ν繧呈ｭ｣譛ｬ縺ｫ縺励↑縺・・
