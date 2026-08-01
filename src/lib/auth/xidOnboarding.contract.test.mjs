import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("X ID onboarding exempt paths cover onboarding, rules, and settings", () => {
  const src = read("./xidOnboarding.ts");
  assert.match(src, /ONBOARDING_PATH = "\/onboarding"/);
  assert.match(src, /RULES_PATH = "\/rules"/);
  assert.match(src, /SETTINGS_PATH = "\/dashboard\/settings"/);
  assert.match(src, /path === ONBOARDING_PATH/);
  assert.match(src, /path === RULES_PATH/);
  assert.match(src, /path === SETTINGS_PATH/);
});

test("buildXIdOnboardingHref delegates to onboardingHref", () => {
  const src = read("./xidOnboarding.ts");
  const urls = read("./onboardingUrls.ts");
  assert.match(src, /return onboardingHref\(/);
  assert.match(urls, /return `\/onboarding\?next=\$\{encodeURIComponent\(safeNext\)\}`/);
  assert.doesNotMatch(src, /tab: "link"/);
  assert.doesNotMatch(src, /onboarding: "1"/);
});

test("auth layout は X ID 未設定による強制リダイレクトをしない", () => {
  const layout = read("../../../app/(auth)/layout.tsx");
  assert.doesNotMatch(layout, /needsXIdOnboarding/);
  assert.doesNotMatch(layout, /buildXIdOnboardingHref/);
  assert.doesNotMatch(layout, /isXIdOnboardingExemptPath/);
  assert.doesNotMatch(layout, /redirect\(buildXId/);
  assert.match(layout, /getLayoutAuthSurface/);
});

test("manage layout は X ID 未設定による強制リダイレクトをしない", () => {
  const layout = read("../../../app/(manage)/layout.tsx");
  assert.doesNotMatch(layout, /needsXIdOnboarding/);
  assert.doesNotMatch(layout, /buildXIdOnboardingHref/);
  assert.doesNotMatch(layout, /isXIdOnboardingExemptPath/);
  assert.doesNotMatch(layout, /redirect\(buildXId/);
  assert.match(layout, /getLayoutAuthSurface/);
});

test("settings onboarding=1 redirects to rules when TOS is not accepted", () => {
  const settings = read("../../../app/(auth)/dashboard/settings/page.tsx");
  assert.match(settings, /isOnboarding &&/);
  assert.match(settings, /user\.is_tos_accepted !== 1/);
  assert.match(settings, /user\.terms_reaccept_required === 1/);
  assert.match(settings, /onboardingRulesHref\(onboardingHref\(next \?\? "\/dashboard"\)\)/);
});
