/**
 * OnboardingState 新仕様の契約テスト。
 * 型・フィールド名・権限ロジックをソースコード静的検査で確認する。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const onboarding = read("./onboarding.ts");
const authComplete = read("./authComplete.ts");
const layoutSrc = read("../../../app/(auth)/layout.tsx");
const dashboardSrc = read("../../../app/(auth)/dashboard/page.tsx");
const entrySrc = read("../../../app/(auth)/entry/page.tsx");
const slotAction = read("../actions/slot.ts");
const interactionAction = read("../actions/video/interaction.ts");
const writeGuard = read("./writeGuard.ts");
const videoDetailPage = read("../../../app/(public)/[id]/page.tsx");
const libraryPage = read("../../../app/(auth)/dashboard/library/page.tsx");
const interactionButton = read("../../components/video/InteractionButton.tsx");

test("OnboardingState は新仕様フィールドを持つ", () => {
  assert.match(onboarding, /XIdentityOnboardingStatus/);
  assert.match(onboarding, /"none" \| "pending" \| "approved" \| "rejected"/);
  assert.match(onboarding, /needsTermsAcceptance/);
  assert.match(onboarding, /xIdentityStatus/);
  assert.match(onboarding, /requestedXId/);
  assert.match(onboarding, /activeApprovedXId/);
  assert.match(onboarding, /canReserveSlot/);
  assert.match(onboarding, /canPost/);
  // 旧フィールドが残っていない
  assert.doesNotMatch(onboarding, /needsTosAccept:/);
  assert.doesNotMatch(onboarding, /hasLinkedXId:/);
  assert.doesNotMatch(onboarding, /hasPendingXIdRequest:/);
  assert.doesNotMatch(onboarding, /hasApprovedActiveXId:/);
  assert.doesNotMatch(onboarding, /isComplete:/);
});

test("OnboardingState: canReserveSlot は TOS 同意のみ（X 不要）", () => {
  assert.match(onboarding, /const canReserveSlot = db != null && !tosPending/);
});

test("OnboardingState: DB障害はfail-closedで canPost=false を返す", () => {
  // db=null のとき canPost=false, canReserveSlot=false
  assert.match(onboarding, /if \(!user\) return empty/);
  assert.match(onboarding, /canPost: false/);
  assert.match(onboarding, /canReserveSlot: false/);
});

test("OnboardingState: rejected は none として扱わない", () => {
  assert.match(onboarding, /xIdentityStatus = "rejected"/);
  assert.doesNotMatch(onboarding, /rejected.*none/);
});

test("OnboardingState: pending は申請済み申請またはリンク済み pending を含む", () => {
  assert.match(onboarding, /hasPendingLinked \|\| pendingRequests\.length > 0/);
});

test("requestXIdLink 成功時に onboarding_completed_at を記録する", () => {
  const xid = read("../actions/xid.ts");
  assert.match(xid, /maybeMarkOnboardingComplete/);
  assert.match(xid, /afterXIdLinkRequestAccepted/);
  assert.match(onboarding, /settings 等からの X 連携申請成功時に呼ぶ/);
});

test("onboarding_completed_at は認可非依存のbest-effort補助マーカーである", () => {
  assert.match(onboarding, /認可には使わない補助マーカー/);
  assert.match(
    onboarding,
    /export async function maybeMarkOnboardingComplete[\s\S]*try \{[\s\S]*\.update\(users\)[\s\S]*catch \(error\)/,
  );
  assert.match(onboarding, /service: "onboarding_marker"/);
});

test("onboardingUrls は sanitizeOnboardingNext で循環を拒否する", () => {
  const urls = read("./onboardingUrls.ts");
  assert.match(urls, /sanitizeOnboardingNext/);
  assert.match(urls, /sanitizeAuthCompleteNext/);
});

test("terms はオンボーディング用の redirect なし同意 Action を持つ", () => {
  const terms = read("../actions/terms.ts");
  assert.match(terms, /export async function acceptOnboardingTerms/);
  assert.match(terms, /commitAcceptLatestTerms/);
});

test("auth complete フォールバックは /dashboard で /onboarding ではない", () => {
  assert.match(authComplete, /fallback = "\/dashboard"/);
  assert.doesNotMatch(authComplete, /fallback = "\/onboarding"/);
});

test("auth complete は /onboarding と /rules を next から拒否する", () => {
  assert.match(authComplete, /"\/onboarding"/);
  assert.match(authComplete, /"\/rules"/);
});

test("auth layout は X ID 未設定リダイレクトをしない", () => {
  assert.doesNotMatch(layoutSrc, /needsXIdOnboarding/);
  assert.doesNotMatch(layoutSrc, /buildXIdOnboardingHref/);
  assert.doesNotMatch(layoutSrc, /redirect\(/);
});

test("ダッシュボードは needsTermsAcceptance / xIdentityStatus で案内を出す", () => {
  assert.match(dashboardSrc, /needsTermsAcceptance/);
  assert.match(dashboardSrc, /xIdentityStatus/);
  assert.match(dashboardSrc, /xIdentityStatus === "pending"/);
  assert.match(dashboardSrc, /activeApprovedXId/);
  assert.match(dashboardSrc, /申請完了・承認待ち/);
  assert.match(dashboardSrc, /作品投稿は承認後に利用可能/);
  assert.doesNotMatch(dashboardSrc, /isComplete/);
});

test("entry page は canReserveSlot / canPost を使う", () => {
  assert.match(entrySrc, /canReserveSlot/);
  assert.match(entrySrc, /canPost/);
  assert.match(entrySrc, /resolvePostHref/);
  assert.match(entrySrc, /resolveSlotHref/);
  assert.doesNotMatch(entrySrc, /onboarding\.isComplete/);
  assert.doesNotMatch(entrySrc, /onboarding\.needsTosAccept/);
});

test("writeGuard は identityRequirement: 'requested_x' オプションを持つ", () => {
  assert.match(writeGuard, /identityRequirement/);
  assert.match(writeGuard, /"requested_x"/);
  assert.match(writeGuard, /"approved_active_x"/);
  assert.match(writeGuard, /hasPendingXRequest/);
});

test("writeGuard は枠確保対象の pending 申請だけを hasPendingXRequest に使う", () => {
  assert.match(writeGuard, /pendingSlotReservationXRequestWhere/);
  assert.match(writeGuard, /orderBy\(desc\(xIdentityRequests\.requested_at\), desc\(xIdentityRequests\.id\)\)/);
});

test("枠確保は identityRequirement: 'none' を使う（X 不要）", () => {
  for (const fn of ["reserveSlot", "extendOwnSlotGroup", "mergeOwnSlotGroups"]) {
    const start = slotAction.indexOf(`export async function ${fn}`);
    assert.ok(start >= 0, fn);
    const next = slotAction.indexOf("\nexport async function ", start + 1);
    const block = next < 0 ? slotAction.slice(start) : slotAction.slice(start, next);
    assert.match(block, /identityRequirement: "none"/, fn);
    assert.doesNotMatch(block, /requireActiveXId: true/, fn);
    assert.doesNotMatch(block, /requireApprovedActiveXId: true/, fn);
  }
  // x_user_id は承認済み active X があるときだけ canonical に設定する
  assert.match(slotAction, /resolveReservationXIdentity/);
  assert.match(slotAction, /reserved_x_id_snapshot: identity\.snapshotXId/);
});

test("枠確保は reserved_by_user_id を正本として設定する", () => {
  // reserveSlot 内で x_user_id: guard.activeXId を直接使わない (identity を経由)
  assert.match(slotAction, /reserved_by_user_id: guard\.user\.id/);
  assert.match(slotAction, /x_user_id: identity\.canonicalXUserId/);
  // reserveSlot 関数内に guard.activeXId をスロット x_user_id に直書きしていない
  const sliceFn = (fn) => {
    const start = slotAction.indexOf(`export async function ${fn}`);
    const next = slotAction.indexOf("\nexport async function ", start + 1);
    return next < 0 ? slotAction.slice(start) : slotAction.slice(start, next);
  };
  const reserveBlock = sliceFn("reserveSlot");
  assert.doesNotMatch(reserveBlock, /x_user_id: guard\.activeXId/);
  const extendBlock = sliceFn("extendOwnSlotGroup");
  assert.doesNotMatch(extendBlock, /x_user_id: guard\.activeXId/);
  const mergeBlock = sliceFn("mergeOwnSlotGroups");
  assert.doesNotMatch(mergeBlock, /x_user_id: guard\.activeXId/);
  assert.match(slotAction, /function isOwnReservedSlot/);
  assert.match(slotAction, /row\.reserved_by_user_id === userId/);
});

test("いいね/セーブ は Auth user 単位で writeGuard を通し Active X を要求しない", () => {
  assert.match(interactionAction, /requireActiveXId: false/);
  assert.match(interactionAction, /videoInteractionsAuth/);
  assert.doesNotMatch(interactionAction, /requireApprovedActiveXId: true/);
});

test("作品詳細の canInteract はログインと規約同意を見る（Active X は不要）", () => {
  assert.match(videoDetailPage, /viewerNeedsTermsAcceptance/);
  assert.match(videoDetailPage, /!viewerNeedsTermsAcceptance/);
  assert.match(
    videoDetailPage,
    /canInteract[\s\S]*viewerUser\?\.id[\s\S]*!viewerNeedsTermsAcceptance/,
  );
  assert.doesNotMatch(
    videoDetailPage,
    /canInteract[\s\S]*viewerActiveX[\s\S]*viewerXApproved/,
  );
});

test("ライブラリは Auth user の interaction 正本を直接JOINする", () => {
  assert.match(libraryPage, /videoInteractionsAuth/);
  assert.match(libraryPage, /auth_user_id, user\.id/);
  assert.doesNotMatch(libraryPage, /activeX/);
});

test("InteractionButton の JSDoc は Auth user 単位の実効要件を説明する", () => {
  assert.match(interactionButton, /video_interactions_auth/);
  assert.match(interactionButton, /Active X ID は不要/);
});
