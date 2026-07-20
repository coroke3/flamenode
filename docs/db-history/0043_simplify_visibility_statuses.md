# 0043_simplify_visibility_statuses.sql

> Status: Active
> Last verified: 2026-07-20
> Implementation: PR #88
> Compatibility: 旧状態をmigrationで一括変換し、旧defaultは即時正規化、UPDATEで再流入を拒否
> Review: DB・保存処理・Worker・公開キャッシュ・管理UIを横断し、active baseline不変も確認
> Source of truth: `migrations/0043_simplify_visibility_statuses.sql`, `src/lib/db/schema.ts`

## 目的

作品とイベントで重複していた下書き・アーカイブ・限定公開の意味を整理し、FlameNode上の公開状態とYouTube上の公開区分を分離します。

## 正本

- 作品: `pending / public / private / voided`
- イベント: `private / public`
- イベントの開始前・開催中・終了済み、および募集前・募集中・募集終了は日時から算出
- YouTube限定公開: `video_youtube_metadata.youtube_privacy_status = unlisted`

## 変更内容

- 旧作品 `limited` は `public` へ移し、YouTube公開区分を `unlisted` として保持します。
- 旧作品 `draft / archived / hidden` は `private` へ移します。
- 旧イベント `draft` は `private`、`archived` は `public` へ移します。
- 旧partial unique indexで許されていたYouTube ID重複を全件検出します。
- 公開に近い状態・更新日時が新しい作品を代表として残し、重複側は行を削除せず `voided` にしてYouTube IDを解除します。
- 重複解消理由と元YouTube IDは `video_moderation_cases` に記録します。
- YouTube IDは `voided` を含む全状態で一意にします。
- active baselineと既存D1の列定義は変更せず、旧defaultをINSERT直後にcanonicalへ正規化し、UPDATEでは旧状態を拒否するtriggerを追加します。
- Drizzleの公開型はcanonical enumのみを持ち、物理defaultは0043のtriggerで即時正規化します。

## データ損失

作品・イベント行は削除しません。重複側作品から解除したYouTube IDはモデレーション履歴へ保存します。

## ロールバック

状態の意味とYouTube ID制約が変わるため完全自動ロールバックは行いません。適用前のD1バックアップから復元してください。

## 検証

- `npm run check:db-schema`
- `npm run check:db-history`
- `npm run typecheck`
- `npm run test:unit`
- `npm run test:workers`
- `npm run test:integration`
- 旧状態変換、全状態でのYouTube ID一意制約、DB triggerによるdefault正規化とUPDATE拒否をSQLite integration testで確認
