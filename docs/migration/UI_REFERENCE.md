# FlameNode Migration UI Reference

> Status: `PENDING_HTML`
> Last updated: 2026-10-07
> Applies to: UI redesign / Phase 2 / route migration acceptance

## Current state

新しいUI/visual designの正本は**まだ登録されていない**。
ユーザーが後日提供するHTML mockを受領してから、この文書へ参照元とmappingを登録する。

旧`docs/design-redesign/`は廃止し、移行のvisual sourceとして使用しない。
`app/(redesign)`や過去のmock実装も、新しいdesign targetを推測する根拠にしない。

## Before HTML mock arrives

許可:

- CURRENT機能/route/API/job/auth/permission棚卸し
- domain抽出設計
- backend optimization検討
- tests/fixtures/contracts整備
- Cloudflare/CPU baseline
- current UI behavior contractの固定

禁止:

- 旧mockを新デザインとして移植する
- 新visual hierarchyをagentが独自決定する
- visual redesignをDONE扱いする
- 見た目を理由にCURRENT capabilityを削除/統合する

## When HTML mock arrives

以下をこのファイルへ登録する。

```text
Reference status: READY
Reference file(s):
Received at:
Version/hash:
Scope:
Excluded surfaces:
```

その後MIG taskで:

1. HTML mockのsurfaceを`CURRENT_ROUTES.md`へ対応付ける。
2. 各surfaceへ`UX-*` capabilityをmappingする。
3. mockに見えないCURRENT capabilityも消さずに配置方針を決める。
4. loading/empty/error/forbidden/pending/degraded/destructive stateを補完する。
5. mobile/tablet/desktop、keyboard/focus、deep-link/reload/back-forwardを補完する。
6. visual差とproduct behavior差を分離する。
7. product behavior変更が必要なら別途承認を得る。

## Authority boundary

HTML mockが正本になる範囲:

- layout
- visual hierarchy
- typography
- spacing
- navigation placement
- component appearance
- density
- responsive intent
- information architecture

HTML mockだけでは変更しない範囲:

- auth/permission
- owner rules
- validation/business rules
- public/private visibility
- database ownership
- API semantics
- Queue/retry/idempotency
- notification/audit side effects
- URL/canonical compatibility
- destructive operation semantics

これらは`PRODUCT_REQUIREMENTS.md`、`FRONTEND_FEATURES.md`、`FUNCTION_INVENTORY.md`、CURRENT code/testが正本。

## Design acceptance gate

`PENDING_HTML`中はPhase 2のvisual acceptanceを開かない。
HTML受領後も、各screenは次を満たすまでDONEではない。

```text
visual target implemented
+ required UX IDs mapped
+ CURRENT behavior parity verified
+ permissions verified
+ loading/error/empty/pending/degraded states verified
+ responsive/accessibility verified
+ URL/history behavior verified
+ backend side effects verified where applicable
```
