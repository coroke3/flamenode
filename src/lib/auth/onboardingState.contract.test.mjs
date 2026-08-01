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

test("canPost は activeApprovedXId があるときだけ true", () => {
  assert.match(onboarding, /canPost = !tosPending && activeApprovedXId != null/);
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
  assert.doesNotMatch(dashboardSrc, /isComplete/);
});

test("entry page は canReserveSlot / needsTermsAcceptance を使う", () => {
  assert.match(entrySrc, /canReserveSlot/);
  assert.match(entrySrc, /needsTermsAcceptance/);
  assert.doesNotMatch(entrySrc, /onboarding\.isComplete/);
  assert.doesNotMatch(entrySrc, /onboarding\.needsTosAccept/);
});

test("writeGuard は identityRequirement: 'requested_x' オプションを持つ", () => {
  assert.match(writeGuard, /identityRequirement/);
  assert.match(writeGuard, /"requested_x"/);
  assert.match(writeGuard, /"approved_active_x"/);
  assert.match(writeGuard, /hasPendingXRequest/);
});

test("枠確保は identityRequirement: 'requested_x' を使う", () => {
  assert.match(slotAction, /identityRequirement: "requested_x"/);
  // x_user_id は承認済み active X があるときだけ設定する
  assert.match(slotAction, /slotXUserId/);
  assert.doesNotMatch(slotAction, /requireApprovedActiveXId: true/);
});

test("枠確保は reserved_by_user_id を正本として設定する", () => {
  // reserveSlot 内で x_user_id: guard.activeXId を直接使わない (slotXUserId を経由)
  assert.match(slotAction, /reserved_by_user_id: guard\.user\.id/);
  assert.match(slotAction, /x_user_id: slotXUserId/);
  // reserveSlot 関数内に guard.activeXId をスロット x_user_id に直書きしていない
  const reserveBlock = slotAction.match(/export async function reserveSlot[\s\S]*?^export/m)?.[0] ?? "";
  assert.doesNotMatch(reserveBlock, /x_user_id: guard\.activeXId/);
});

test("いいね/セーブ は approved active X を必須としない", () => {
  assert.doesNotMatch(interactionAction, /requireApprovedActiveXId: true/);
  // active X は引き続き必要 (DB 制約)
  assert.match(interactionAction, /requireActiveXId: true/);
});
