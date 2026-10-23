// Shared jsdom + contract-fixture helpers for apps/app tests (not a test file).
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";

export const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://flamenode.test/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DIST = "../.test-dist";
const contracts = await import(`${DIST}/packages/contracts/src/personal/index.js`);
const { PersonalRoutes } = await import(`${DIST}/apps/app/src/routes/router.js`);
export const { createPersonalApi } = await import(`${DIST}/apps/app/src/api/personal.js`);

const must = (schema, value) => schema.parse(value);

/** Every fixture is parsed by the MIG-0611 contract schema, so a drifting contract fails the tests. */
export const user = (over = {}) =>
  must(contracts.PersonalUserSchema, {
    id: "u1", name: "Taro", image: null, role: "user", is_banned: 0, active_x_user_id: null,
    is_tos_accepted: 1, accepted_terms_version_id: "t1", terms_reaccept_required: 0, ...over,
  });
export const onboardingState = (over = {}) =>
  must(contracts.OnboardingStateSchema, {
    needsTermsAcceptance: false, xIdentityStatus: "none", requestedXId: null, activeApprovedXId: null,
    canReserveSlot: true, canPost: false, ...over,
  });
export const video = (id, over = {}) =>
  must(contracts.VideoCardSchema, {
    id, title: `title-${id}`, youtube_video_id: null, display_name: `name-${id}`, icon_url: null,
    creator_x_user_id: null, primary_event_id: null, scheduled_time: null, status: "public", ...over,
  });
export const chapter = (id, over = {}) =>
  must(contracts.ChapterItemSchema, {
    id, video_id: `v-${id}`, youtube_video_id: null, video_title: `vt-${id}`, chapter_time: 12.9,
    chapter_label: `label-${id}`, visibility: "public", created_at: 1, ...over,
  });
export const linkedX = (id, over = {}) =>
  must(contracts.LinkedXUserSchema, { id, x_name: `X ${id}`, icon_url: null, approval_status: "approved", ...over });
const preview = (items = [], hasMore = false) => ({ items, hasMore });

export const dashboard = (over = {}) =>
  must(contracts.DashboardResponseSchema, {
    user: user(), onboarding: onboardingState(), linkedXUsers: [], myVideos: preview(), collabVideos: preview(),
    myChapters: preview(), activeSlot: null, stats: { likes: 0, views: 0, video_count: 0, event_count: 0 }, ...over,
  });
export const library = (over = {}) =>
  must(contracts.LibraryResponseSchema, {
    tab: "like", page: 1, pageSize: 24, hasNextPage: false, hasOtherTabHits: false, activeApprovedXId: null,
    approvedXIdCount: 0, videos: [], chapters: [], ...over,
  });
export const settingsX = (id, over = {}) =>
  must(contracts.SettingsXIdSchema, {
    id, x_name: `X ${id}`, icon_url: null, approval_status: "approved", requested_at: 1_700_000_000, profile_text: null,
    portfolio_contact: null, youtube_channel_url: null, other_social_links: null, ...over,
  });
export const requestRow = (id, over = {}) =>
  must(contracts.XIdentityRequestRowSchema, {
    id, request_type: "new_link", requested_x_id: "reqx", source_x_user_id: null, target_x_user_id: null,
    parent_request_id: null, revert_deadline_at: null, status: "pending", requested_at: 1_700_000_000,
    updated_at: 1_700_000_000, ...over,
  });
export const settings = (over = {}) =>
  must(contracts.SettingsResponseSchema, {
    user: user(), xIds: [], requestHistory: [], panel: { xId: null, iconCandidates: [], channelCandidates: [] }, ...over,
  });
export const onboarding = (over = {}) =>
  must(contracts.OnboardingResponseSchema, { user: user(), state: onboardingState(), rules: null, ...over });

export const ok = (data) => ({ status: "ok", data });
const un = { status: "unavailable" };

/** Fake PersonalApi. Each endpoint is a result or a function (query) => result. `calls` records every read. */
export function fakeApi(results = {}) {
  const calls = [];
  const pick = (name, ...args) => {
    calls.push([name, ...args.filter((a) => a && typeof a === "object" && !("aborted" in a))]);
    const r = results[name];
    return Promise.resolve(typeof r === "function" ? r(args[0]) : (r ?? un));
  };
  return {
    calls,
    getSession: (s) => pick("getSession", s),
    getDashboard: (s) => pick("getDashboard", s),
    getLibrary: (q, s) => pick("getLibrary", q, s),
    getSettings: (q, s) => pick("getSettings", q, s),
    getOnboarding: (s) => pick("getOnboarding", s),
  };
}

/** Every endpoint answers with the same non-ok status (anonymous / banned / unavailable). */
export const uniformApi = (status) =>
  fakeApi(Object.fromEntries(["getSession", "getDashboard", "getLibrary", "getSettings", "getOnboarding"].map((n) => [n, { status }])));

export async function flush() {
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
}

export async function mount(path, api) {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(PersonalRoutes, { api })));
  });
  await flush();
  return { container, root, unmount: () => act(async () => root.unmount()) };
}
