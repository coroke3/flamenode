// MIG-0701 U03: /onboarding states in CURRENT priority order; read-only (no forms, no completion write).
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { fakeApi, mount, ok, onboarding, onboardingState } from "./helpers.mjs";

const hrefs = (m) => [...m.container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
const page = (state, rules = null, path = "/onboarding") => mount(path, fakeApi({ getOnboarding: ok(onboarding({ state: onboardingState(state), rules })) }));
const noWrites = (m) => assert.equal(m.container.querySelectorAll("form, input, textarea").length, 0);

test("terms pending: summary list, default terms when the API has no rules, full-text toggle", async () => {
  const m = await page({ needsTermsAcceptance: true, canReserveSlot: false });
  const t = m.container.textContent;
  assert.match(t, /初期設定 1 \/ 2/);
  assert.match(t, /利用規約の確認/);
  assert.match(t, /投稿作品の取り扱い/);
  assert.match(t, /同意対象バージョン: 2026-07-31-liability-secondary-use/);
  assert.equal(m.container.querySelector("article"), null);
  await act(async () => m.container.querySelector("button").click());
  assert.match(m.container.querySelector("article").getAttribute("aria-label"), /利用規約全文/);
  assert.match(m.container.querySelector("article").textContent, /FlameNode 利用規約/);
  assert.match(m.container.textContent, /利用規約全文を閉じる/);
  noWrites(m);
  await m.unmount();
});

test("terms pending with published rules: version label and markdown blocks (h2/h3/ul/p) come from the API", async () => {
  const m = await page(
    { needsTermsAcceptance: true },
    { versionLabel: "v-test", bodyMarkdown: "# Top\n## Sub\npara\n- a\n- b" },
  );
  assert.match(m.container.textContent, /同意対象バージョン: v-test/);
  await act(async () => m.container.querySelector("button").click());
  const article = m.container.querySelector("article");
  assert.equal(article.querySelector("h2").textContent, "Top");
  assert.equal(article.querySelector("h3").textContent, "Sub");
  assert.equal(article.querySelector("p").textContent, "para");
  assert.deepEqual([...article.querySelectorAll("li")].map((li) => li.textContent), ["a", "b"]);
  await m.unmount();
});

test("canPost: 設定が完了しました with next / entry / settings(next=self) links", async () => {
  const m = await page({ xIdentityStatus: "approved", activeApprovedXId: "alpha", canPost: true }, null, "/onboarding?next=%2Fdashboard%2Flibrary");
  assert.match(m.container.textContent, /@alpha で作品投稿やイベント参加ができます。/);
  assert.match(m.container.textContent, /設定完了・投稿可能/);
  const h = hrefs(m);
  assert.ok(h.includes("/dashboard/library"));
  assert.ok(h.includes("/entry"));
  assert.ok(h.includes("/dashboard/settings?next=" + encodeURIComponent("/onboarding?next=%2Fdashboard%2Flibrary")));
  await m.unmount();
});

test("approved without Active X: 活動名義の選択", async () => {
  const m = await page({ xIdentityStatus: "approved", activeApprovedXId: null });
  assert.match(m.container.textContent, /活動名義の選択/);
  assert.match(m.container.textContent, /設定で Active X ID を選ぶ/);
  assert.ok(hrefs(m).includes("/dashboard"));
  await m.unmount();
});

test("pending: 申請完了・承認待ち with requested X ID or the generic label", async () => {
  const withId = await page({ xIdentityStatus: "pending", requestedXId: "req1" });
  assert.match(withId.container.textContent, /@req1 の連携を運営が確認しています。/);
  assert.match(withId.container.textContent, /申請完了・承認待ち/);
  assert.match(withId.container.textContent, /いいね・セーブ・作品投稿は承認後に利用可能/);
  assert.ok(hrefs(withId).includes("/entry"));
  await withId.unmount();
  const generic = await page({ xIdentityStatus: "pending" });
  assert.match(generic.container.textContent, /申請中の X ID の連携を運営が確認しています。/);
  await generic.unmount();
});

test("rejected: alert card with the requested X ID; the re-request form is MIG-0702 (not rendered)", async () => {
  const m = await page({ xIdentityStatus: "rejected", requestedXId: "bad" });
  assert.match(m.container.textContent, /X ID 連携を確認できませんでした/);
  assert.match(m.container.textContent, /申請した X ID: @bad/);
  assert.equal(m.container.querySelector('[role="alert"]') !== null, true);
  noWrites(m);
  await m.unmount();
  const noId = await page({ xIdentityStatus: "rejected" });
  assert.doesNotMatch(noId.container.textContent, /申請した X ID:/);
  await noId.unmount();
});

test("none: prepare screen (canReserveSlot -> 枠だけ確保 to /entry, else あとで -> next), then ?start=1 form step", async () => {
  const prepare = await page({ xIdentityStatus: "none", canReserveSlot: true });
  assert.match(prepare.container.textContent, /FlameNode を利用する準備/);
  assert.match(prepare.container.textContent, /所要時間：約1分/);
  const h = hrefs(prepare);
  assert.ok(h.includes("/onboarding?next=%2Fdashboard&start=1"));
  assert.ok(h.includes("/entry"));
  await prepare.unmount();

  const custom = await page({ xIdentityStatus: "none", canReserveSlot: true }, null, "/onboarding?next=%2Fentry%2Fslotted%3Fslot%3Dz");
  assert.ok(hrefs(custom).includes("/entry/slotted?slot=z"));
  await custom.unmount();

  const noReserve = await page({ xIdentityStatus: "none", canReserveSlot: false });
  assert.match(noReserve.container.textContent, /あとで/);
  assert.doesNotMatch(noReserve.container.textContent, /あとで枠だけ確保する/);
  await noReserve.unmount();

  const started = await page({ xIdentityStatus: "none", canReserveSlot: true }, null, "/onboarding?start=1");
  assert.match(started.container.textContent, /活動名義を登録/);
  assert.match(started.container.textContent, /運営による確認後、作品投稿が可能になります。/);
  assert.match(started.container.textContent, /あとで枠だけ確保する/);
  noWrites(started);
  await started.unmount();
});

test("onboarding next is sanitized (loop targets fall back to /dashboard) and failures map like CURRENT", async () => {
  const loop = await page({ xIdentityStatus: "pending" }, null, "/onboarding?next=%2Fonboarding%3Fx%3D1");
  assert.ok(hrefs(loop).includes("/dashboard"));
  await loop.unmount();
  const anon = await mount("/onboarding?next=%2Fdashboard%2Flibrary", fakeApi({ getOnboarding: { status: "anonymous" } }));
  assert.ok(anon.container.innerHTML.includes("/entry?next=%2Fonboarding%3Fnext%3D%252Fdashboard%252Flibrary"));
  await anon.unmount();
  const banned = await mount("/onboarding", fakeApi({ getOnboarding: { status: "banned" } }));
  assert.match(banned.container.textContent, /利用が停止されています/);
  await banned.unmount();
  const down = await mount("/onboarding", fakeApi({ getOnboarding: { status: "unavailable" } }));
  assert.match(down.container.textContent, /画面の表示中に問題が発生しました/);
  await down.unmount();
});

test("ported terms sources stay identical to CURRENT (drift guard until CURRENT is retired)", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
  for (const f of ["defaultTerms.ts", "legalMarkdown.ts"]) {
    assert.equal(await read(`../src/routes/ui/${f}`), await read(`../../../src/lib/terms/${f}`), f);
  }
});
