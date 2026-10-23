import assert from "node:assert/strict";
import { test } from "node:test";
import { cookie, createD1, createSqlite, runUnderRootTsx } from "./support/personalHarness.mjs";
import { seed, USERS } from "./support/personalSeed.mjs";
import { NOW, seedEntry } from "./support/personalEntrySeed.mjs";

// MIG-0623 parity: the same seed is read by CURRENT's loaders (the real src/** helpers plus the drizzle queries
// copied from app/(auth)/entry/**/page.tsx) and by the Hono /api/personal/entry/* routes.
if (runUnderRootTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { and, asc, desc, eq, isNull, like, or, sql } = await import("drizzle-orm");
  const S = await import("../../../src/lib/db/schema.ts");
  const { app } = await import("../src/app.ts");
  const { getOnboardingState } = await import("../../../src/lib/auth/onboarding.ts");
  const { getHeaderLinkedXUsersForAuthUser } = await import("../../../src/lib/auth/headerLinkedXUsers.ts");
  const { resolveActiveXUserId } = await import("../../../src/lib/auth/resolveActiveXId.ts");
  const { getLinkedXUsersForAuthUser } = await import("../../../src/lib/auth/xIdentity.ts");
  const { getLatestPublishedMajorTerms, termsReacceptRequiredValue } = await import("../../../src/lib/terms/reaccept.ts");
  const { normalizeXId } = await import("../../../src/lib/utils/xid.ts");
  const { fetchActiveEvents } = await import("../../../src/lib/db/queries.ts");
  const eventStatusLib = await import("../../../src/lib/utils/eventStatus.ts");
  const { compareEventsByUpcomingPriority } = await import("../../../src/lib/utils/eventOrdering.ts");
  const { getXIconCandidates } = await import("../../../src/lib/db/xIconResolution.ts");
  const { getYoutubeChannelCandidates } = await import("../../../src/lib/db/youtubeChannelCandidates.ts");
  const { getUsedSoftwareSuggestions } = await import("../../../src/lib/db/videoFormSuggestions.ts");
  const { unslottedEventEligibilityWhere } = await import("../../../src/lib/video/resolveUnslottedEventSyncTarget.ts");
  const { fetchActiveCustomQuestionsForEvents } = await import("../../../src/lib/video/customQuestionAnswers.ts");
  const { loadStagePermissionFormSettingsJsonByEvents } = await import("../../../src/lib/video/stagePermissionQuestions.ts");
  const { resolvePartFromSlot } = await import("../../../src/lib/video/slotPart.ts");
  const { buildSlotParts } = await import("../../../src/lib/utils/slotGroupingCore.ts");
  const { computeEventStatus: apiComputeStatus, isAcceptingEntries: apiAccepting, compareEventsByUpcomingPriority: apiCompare } =
    await import("../src/routes/personal/entry/eventStatus.ts");

  const sqlite = createSqlite();
  seed(sqlite);
  seedEntry(sqlite);
  const refDb = drizzle(async (text, params, method) => {
    const statement = sqlite.prepare(text);
    if (method === "run") {
      statement.run(...params);
      return { rows: [] };
    }
    const rows = statement.all(...params).map((row) => Object.values(row));
    return { rows: method === "get" ? rows[0] : rows };
  });

  const canon = (value) => JSON.parse(JSON.stringify(value ?? null));
  const NAMES = USERS.filter((u) => u !== "banned");
  const stats = {};

  const parseBody = (text) => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  };

  async function call(path, token, options = {}) {
    const d1 = options.d1 ?? createD1(sqlite);
    const response = await app.request(path, { method: options.method ?? "GET", headers: token ? cookie(token) : {} }, { DB: d1 });
    const text = await response.text();
    const result = { status: response.status, headers: response.headers, text, body: parseBody(text), stats: d1.stats };
    const key = path.split("?")[0];
    (stats[key] ??= []).push(d1.stats);
    return result;
  }

  // ---------- CURRENT reference loaders ----------
  async function refUser(name) {
    const id = `u_${name}`;
    const requiredMajor = await getLatestPublishedMajorTerms(refDb);
    const row = (
      await refDb
        .select({
          id: S.users.id, name: S.users.name, image: S.users.image, role: S.users.role, is_banned: S.users.is_banned,
          active_x_user_id: S.users.active_x_user_id, is_tos_accepted: S.users.is_tos_accepted,
          accepted_terms_version_id: S.users.accepted_terms_version_id,
          terms_reaccept_required: termsReacceptRequiredValue(requiredMajor),
        })
        .from(S.users)
        .where(eq(S.users.id, id))
        .limit(1)
    )[0];
    const linked = await getHeaderLinkedXUsersForAuthUser(refDb, id);
    const active = await resolveActiveXUserId(refDb, id, normalizeXId(row.active_x_user_id) || null, linked);
    return {
      id: row.id, name: row.name ?? "ゲスト", image: row.image ?? null,
      role: row.role === "admin" || row.role === "moderator" ? row.role : "user",
      is_banned: row.is_banned ?? 0, active_x_user_id: active, is_tos_accepted: row.is_tos_accepted ?? 0,
      accepted_terms_version_id: row.accepted_terms_version_id ?? null,
      terms_reaccept_required: row.terms_reaccept_required === 1 ? 1 : 0,
    };
  }
  const stripState = (s) => ({
    needsTermsAcceptance: s.needsTermsAcceptance, xIdentityStatus: s.xIdentityStatus, requestedXId: s.requestedXId,
    activeApprovedXId: s.activeApprovedXId, canReserveSlot: s.canReserveSlot, canPost: s.canPost,
  });

  // app/(auth)/entry/page.tsx (logged-in branch)
  async function refIndex(name) {
    const sessionUser = await refUser(name);
    const db = refDb;
    const onboarding = await getOnboardingState(db, sessionUser);
    const activeEventsRaw = await fetchActiveEvents(db).catch(() => []);
    const activeEvents = activeEventsRaw
      .filter((event) => eventStatusLib.isAcceptingEntries(event))
      .sort((a, b) => {
        const endDiff = (a.entry_end_time ?? Number.POSITIVE_INFINITY) - (b.entry_end_time ?? Number.POSITIVE_INFINITY);
        return endDiff || (a.start_time ?? 0) - (b.start_time ?? 0);
      });
    const slotCounts = new Map();
    if (activeEvents.length > 0) {
      const rows = await db
        .select({ event_id: S.slots.event_id, count: sql`COUNT(*)` })
        .from(S.slots)
        .where(eq(S.slots.status, "available"))
        .groupBy(S.slots.event_id);
      for (const row of rows) slotCounts.set(row.event_id, Number(row.count ?? 0));
    }
    const activeX = sessionUser?.active_x_user_id ?? null;
    const ownerWhere = activeX
      ? and(eq(S.slots.reserved_by_user_id, sessionUser.id), or(eq(S.slots.x_user_id, activeX), isNull(S.slots.x_user_id)))
      : and(isNull(S.slots.x_user_id), eq(S.slots.reserved_by_user_id, sessionUser.id));
    const reservedSlots = await db
      .select({
        id: S.slots.id, event_id: S.slots.event_id, video_id: S.slots.video_id, slot_label: S.slots.slot_label,
        start_time: S.slots.start_time, sort_order: S.slots.sort_order, status: S.slots.status,
        reserved_by_user_id: S.slots.reserved_by_user_id, x_user_id: S.slots.x_user_id, display_name: S.slots.display_name,
        reservation_group_id: S.slots.reservation_group_id, updated_at: S.slots.updated_at,
        event_title: S.events.title, event_entry_end_time: S.events.entry_end_time,
      })
      .from(S.slots)
      .leftJoin(S.events, eq(S.slots.event_id, S.events.id))
      .where(and(ownerWhere, or(eq(S.slots.status, "reserved"), eq(S.slots.status, "submitted"))))
      .orderBy(S.slots.start_time, S.slots.sort_order, S.slots.id) // + id tie-break (only difference: CURRENT is undefined on ties)
      .limit(24);
    reservedSlots.sort((a, b) => {
      const aNeeds = !a.video_id && a.status === "reserved";
      const bNeeds = !b.video_id && b.status === "reserved";
      if (aNeeds !== bNeeds) return aNeeds ? -1 : 1;
      const deadlineDiff = (a.event_entry_end_time ?? Number.POSITIVE_INFINITY) - (b.event_entry_end_time ?? Number.POSITIVE_INFINITY);
      return deadlineDiff || (a.start_time ?? Number.POSITIVE_INFINITY) - (b.start_time ?? Number.POSITIVE_INFINITY);
    });
    return canon({
      user: sessionUser,
      state: stripState(onboarding),
      events: activeEvents.map((e) => ({ id: e.id, title: e.title, entry_end_time: e.entry_end_time ?? null, slots_available: slotCounts.get(e.id) ?? 0 })),
      reservedSlots: reservedSlots.map((s) => ({
        id: s.id, event_id: s.event_id, video_id: s.video_id ?? null, slot_label: s.slot_label ?? null, start_time: s.start_time ?? null,
        status: s.status, event_title: s.event_title ?? null, event_entry_end_time: s.event_entry_end_time ?? null,
      })),
      truncated: false,
      nextOffset: null,
    });
  }

  const shapeQuestion = (q) => q; // CURRENT CustomQuestion objects already have the wire shape

  // app/(auth)/entry/slotted/page.tsx
  async function refSlotted(name, slotId) {
    const user = await refUser(name);
    const db = refDb;
    if (!slotId) return { kind: "redirect", to: "/entry" };
    const activeXId = user.active_x_user_id ?? null;
    const slotOwnerWhere = activeXId
      ? or(
          and(eq(S.slots.reserved_by_user_id, user.id), or(eq(S.slots.x_user_id, activeXId), isNull(S.slots.x_user_id))),
          and(eq(S.slots.status, "reserved"), eq(S.slots.x_user_id, activeXId)),
        )
      : eq(S.slots.reserved_by_user_id, user.id);
    const slot = (await db.select().from(S.slots).where(and(eq(S.slots.id, slotId), slotOwnerWhere)).limit(1))[0];
    if (!slot) return { status: 404 };
    if (slot.status === "submitted" && slot.video_id) return { kind: "redirect", to: `/dashboard/edit/${slot.video_id}` };
    if (slot.status !== "reserved") return { kind: "redirect", to: "/entry" };
    if (slot.x_user_id && activeXId && slot.x_user_id !== activeXId) return { kind: "redirect", to: "/entry" };
    const ev = (await db.select().from(S.events).where(eq(S.events.id, slot.event_id)).limit(1))[0];
    if (!ev) return { status: 404 };
    let slotStart = slot.start_time;
    let slotEnd = slot.start_time;
    let groupSize = 1;
    if (slot.reservation_group_id) {
      const groupRows = await db
        .select({ start_time: S.slots.start_time })
        .from(S.slots)
        .where(and(eq(S.slots.event_id, slot.event_id), eq(S.slots.reservation_group_id, slot.reservation_group_id)));
      if (groupRows.length > 0) {
        groupSize = groupRows.length;
        const starts = groupRows.map((r) => r.start_time).filter((v) => typeof v === "number");
        const ends = groupRows.map((r) => r.start_time).filter((v) => typeof v === "number");
        if (starts.length > 0) slotStart = Math.min(...starts);
        if (ends.length > 0) {
          const configuredGapMinutes = ev.slot_part_gap_minutes ?? 15;
          const slotGapSeconds = Number.isFinite(configuredGapMinutes) && configuredGapMinutes >= 0 ? configuredGapMinutes * 60 : 15 * 60;
          slotEnd = Math.max(...ends) + slotGapSeconds;
        }
      }
    }
    const activeX = slot.x_user_id ?? activeXId;
    const reservedAtXId = slot.reserved_x_id_snapshot ?? slot.x_user_id ?? null;
    const xRow = activeX ? (await db.select().from(S.xUsers).where(eq(S.xUsers.id, activeX)).limit(1))[0] : null;
    const xIdOptions = (await getLinkedXUsersForAuthUser(db, user.id, { approvedOnly: true }))
      .map((row) => ({ id: row.x_user_id, x_name: row.x_name }))
      .sort((a, b) => a.x_name.localeCompare(b.x_name, "ja"));
    const softwareSuggestions = await getUsedSoftwareSuggestions(db);
    const iconCandidates = activeX ? await getXIconCandidates(db, activeX) : [];
    const channelCandidates = activeX && db ? await getYoutubeChannelCandidates(db, activeX) : [];
    const { acceptingEntriesWhere } = eventStatusLib;
    const acceptingEvents = (
      await db
        .select({
          id: S.events.id, title: S.events.title, parts_json: S.events.parts_json,
          youtube_description_template: S.events.youtube_description_template,
          required_video_fields_json: S.events.required_video_fields_json,
        })
        .from(S.events)
        .where(and(acceptingEntriesWhere(Math.floor(Date.now() / 1000)), eq(S.events.allow_user_video_event_links, 1)))
    ).sort((a, b) => (a.id < b.id ? -1 : 1)); // API order is deterministic (CURRENT has no ORDER BY)
    const slotEventOption = {
      id: ev.id, title: ev.title, parts_json: ev.parts_json,
      youtube_description_template: ev.youtube_description_template, required_video_fields_json: ev.required_video_fields_json,
    };
    const rawEventOptions = acceptingEvents.some((o) => o.id === ev.id) ? acceptingEvents : [slotEventOption, ...acceptingEvents];
    const formSettingsByEvent = await loadStagePermissionFormSettingsJsonByEvents(db, rawEventOptions.map((o) => o.id));
    const customQuestionsByEvent = await fetchActiveCustomQuestionsForEvents(db, rawEventOptions.map((o) => o.id));
    const eventOptions = rawEventOptions.map((option) => ({
      id: option.id, title: option.title, parts_json: option.parts_json ?? null,
      youtube_description_template: option.youtube_description_template ?? null,
      required_video_fields_json: option.required_video_fields_json ?? null,
      video_form_settings_json: formSettingsByEvent.get(option.id) ?? null,
      custom_questions: (customQuestionsByEvent.get(option.id) ?? []).map(shapeQuestion),
    }));
    const slotPart = await resolvePartFromSlot(db, slot);
    const status = xRow?.approval_status ?? null;
    const submitBlock = !activeXId ? "no_active_x" : status === "pending" ? "pending" : status === "rejected" ? "rejected" : status !== "approved" ? "not_approved" : null;
    return canon({
      kind: "ready",
      user,
      activeXId: activeX ?? null,
      submitBlock,
      initialProfile: {
        display_name: slot.display_name ?? xRow?.x_name ?? user.name,
        icon_url: xRow?.icon_url ?? user.image ?? null,
        profile_text: xRow?.profile_text ?? null,
        youtube_channel_url: xRow?.youtube_channel_url ?? null,
        other_social_links: xRow?.other_social_links ?? null,
      },
      xIdOptions,
      softwareSuggestions,
      iconCandidates,
      channelCandidates,
      slot: {
        id: slot.id, slot_label: slot.slot_label ?? null, display_name: slot.display_name ?? null,
        has_reservation_group: Boolean(slot.reservation_group_id), reserved_at_x_id: reservedAtXId,
        start_time: slotStart ?? null, end_time: slotEnd ?? null, group_size: groupSize,
      },
      event: { id: ev.id, title: ev.title },
      activeXName: xRow?.x_name ?? null,
      slotPart,
      eventOptions,
      truncated: false,
      nextOffset: null,
    });
  }

  // app/(auth)/entry/unslotted/page.tsx
  async function refUnslotted(name, rawQuery) {
    const user = await refUser(name);
    const db = refDb;
    const activeX = user.active_x_user_id;
    const eventQuery = (rawQuery ?? "").trim().slice(0, 100);
    const now = Math.floor(Date.now() / 1000);
    const xRow = activeX ? (await db.select().from(S.xUsers).where(eq(S.xUsers.id, activeX)).limit(1))[0] : null;
    const xIdOptions = await db
      .select({ id: S.xUsers.id, x_name: S.xUsers.x_name })
      .from(S.xUserAccountLinks)
      .innerJoin(S.xUsers, eq(S.xUserAccountLinks.x_user_id, S.xUsers.id))
      .where(and(eq(S.xUserAccountLinks.auth_user_id, user.id), eq(S.xUsers.approval_status, "approved")))
      .orderBy(asc(S.xUsers.x_name), asc(S.xUsers.id));
    const softwareSuggestions = await getUsedSoftwareSuggestions(db);
    const eventOptions = await db
      .select({
        id: S.events.id, title: S.events.title, start_time: S.events.start_time, end_time: S.events.end_time,
        allow_unslotted_posts: S.events.allow_unslotted_posts, parts_json: S.events.parts_json,
        youtube_description_template: S.events.youtube_description_template,
        required_video_fields_json: S.events.required_video_fields_json,
      })
      .from(S.events)
      .where(
        and(
          unslottedEventEligibilityWhere(now),
          eventQuery ? or(like(S.events.title, `%${eventQuery}%`), like(S.events.id, `%${eventQuery}%`)) : undefined,
        ),
      )
      .orderBy(desc(S.events.end_time), desc(S.events.start_time), asc(S.events.id))
      .limit(120);
    const questionsByEvent = await fetchActiveCustomQuestionsForEvents(db, eventOptions.map((o) => o.id));
    const iconCandidates = activeX ? await getXIconCandidates(db, activeX) : [];
    const channelCandidates = activeX ? await getYoutubeChannelCandidates(db, activeX) : [];
    const activeXIsLinked = !activeX || xIdOptions.some((o) => o.id === activeX);
    const submitBlock = !activeX ? "no_active_x" : !activeXIsLinked ? "not_linked" : xRow?.approval_status !== "approved" ? "not_approved" : null;
    return canon({
      user,
      activeXId: activeX ?? null,
      submitBlock,
      initialProfile: {
        display_name: xRow?.x_name ?? user.name,
        icon_url: xRow?.icon_url ?? user.image ?? null,
        profile_text: xRow?.profile_text ?? null,
        youtube_channel_url: xRow?.youtube_channel_url ?? null,
        other_social_links: xRow?.other_social_links ?? null,
      },
      xIdOptions,
      softwareSuggestions,
      iconCandidates,
      channelCandidates,
      eventQuery,
      eventOptions: eventOptions.map((event) => ({
        id: event.id, title: event.title, parts_json: event.parts_json ?? null,
        youtube_description_template: event.youtube_description_template ?? null,
        required_video_fields_json: event.required_video_fields_json ?? null,
        custom_questions: questionsByEvent.get(event.id) ?? [],
        status_label: event.end_time != null && event.end_time <= now ? "終了済" : "開催前・開催中の個別許可",
      })),
      truncated: false,
      nextOffset: null,
    });
  }

  const slotIds = sqlite.prepare("SELECT id FROM slots ORDER BY id").all().map((r) => r.id);

  // ---------------- access control ----------------
  test("auth: 401 without a session / with an expired one, 403 for banned, every response private,no-store; GET only", async () => {
    for (const path of ["/api/personal/entry", "/api/personal/entry/slotted?slot=sl-g1", "/api/personal/entry/unslotted"]) {
      for (const token of [undefined, "tok-expired", "tok-nope"]) {
        const r = await call(path, token);
        assert.equal(r.status, 401, `${path} ${token}`);
        assert.equal(r.headers.get("cache-control"), "private, no-store");
        assert.equal(r.stats.statements <= 1, true, "only the session lookup runs");
      }
      const banned = await call(path, "tok-banned");
      assert.equal(banned.status, 403, path);
      assert.equal(banned.headers.get("cache-control"), "private, no-store");
      const post = await call(path, "tok-alice", { method: "POST" });
      assert.equal(post.status, 404, `${path} POST is not routed`);
    }
  });

  // ---------------- entry index ----------------
  test("T04 index: events, slot counts, onboarding state and reserved slots equal CURRENT for every user", async () => {
    for (const name of NAMES) {
      const r = await call("/api/personal/entry", `tok-${name}`);
      assert.equal(r.status, 200, name);
      assert.equal(r.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(r.body, await refIndex(name), name);
    }
  });

  test("T05 index: only accepting public events, ordered by entry deadline; reserved slots: unsubmitted first, then deadline", async () => {
    const { body } = await call("/api/personal/entry", "tok-alice");
    const ids = body.events.map((e) => e.id);
    assert.deepEqual(new Set(ids), new Set(["e_open1", "e_open2", "e_open3", "e_open4"]));
    for (const hidden of ["e_point", "e_closed", "e_ended", "e_private", "e_noentry", "e_future_entry"]) assert.ok(!ids.includes(hidden), hidden);
    assert.equal(body.events.find((e) => e.id === "e_open1").slots_available, 6, "5 open slots + sl-avail");
    assert.equal(body.events.find((e) => e.id === "e_open2").slots_available, 3);
    assert.equal(body.events.find((e) => e.id === "e_open3").slots_available, 0);
    const sorted = body.events.map((e) => e.entry_end_time ?? Infinity);
    assert.deepEqual([...sorted].sort((a, b) => a - b), sorted);
    const needs = body.reservedSlots.map((s) => !s.video_id && s.status === "reserved");
    assert.deepEqual(needs, [...needs].sort((a, b) => Number(b) - Number(a)), "needs-submission slots come first");
    assert.ok(body.reservedSlots.length > 0);
  });

  test("IDOR index: reserved slots are only the caller's (X snapshot rule applies); 24 max", async () => {
    const alice = (await call("/api/personal/entry", "tok-alice")).body.reservedSlots.map((s) => s.id);
    for (const foreign of ["sl-bob", "sl-foreign", "sl-foreign-sub", "sl-frank", "sl-ivy", "s-bob", "s-erin", "s-other", "sl-other-x"]) {
      assert.ok(!alice.includes(foreign), `${foreign} must not be listed for alice`);
    }
    assert.ok(!alice.includes("av1-0"), "available slots are never listed");
    const bobText = (await call("/api/personal/entry", "tok-bob")).text;
    assert.ok(!/sl-g1|sl-p2|u_alice|alice_x/.test(bobText), "bob never sees alice's slots or X IDs");
    const many = (await call("/api/personal/entry", "tok-many")).body;
    assert.equal(many.reservedSlots.length, 24);
    assert.deepEqual(many, await refIndex("many"));
  });

  test("S2 budget: index = session lookup + context + 1 data statement (3, no batch, <= 100 binds)", async () => {
    const r = await call("/api/personal/entry", "tok-alice");
    assert.deepEqual({ statements: r.stats.statements, batches: r.stats.batches, writes: r.stats.writes }, { statements: 3, batches: 0, writes: 0 });
    assert.ok(r.stats.maxBinds <= 100);
  });

  // ---------------- slotted ----------------
  test("T04 slotted: redirects, 404s and the ready payload equal CURRENT for every user x slot", async () => {
    const seen = new Set();
    for (const name of NAMES) {
      for (const slotId of [...slotIds, "", "nope"]) {
        const path = `/api/personal/entry/slotted${slotId === "" ? "" : `?slot=${encodeURIComponent(slotId)}`}`;
        const r = await call(path, `tok-${name}`);
        const expected = await refSlotted(name, slotId);
        if (expected.status === 404) {
          assert.equal(r.status, 404, `${name} ${slotId}`);
          assert.deepEqual(r.body, { error: "not_found" });
          seen.add("404");
        } else {
          assert.equal(r.status, 200, `${name} ${slotId}`);
          assert.deepEqual(r.body, canon(expected), `${name} ${slotId}`);
          seen.add(expected.kind === "redirect" ? `redirect:${expected.to.split("/")[1]}` : "ready");
        }
        assert.equal(r.headers.get("cache-control"), "private, no-store");
        assert.equal(r.stats.writes, 0);
      }
    }
    assert.ok(seen.has("404") && seen.has("ready") && seen.has("redirect:entry") && seen.has("redirect:dashboard"), [...seen].join());
  });

  test("T05 slotted: group span, part, stage settings, custom questions and candidates (alice / sl-g1)", async () => {
    const { body } = await call("/api/personal/entry/slotted?slot=sl-g1", "tok-alice");
    assert.equal(body.kind, "ready");
    assert.equal(body.slot.group_size, 3);
    assert.equal(body.slot.end_time - body.slot.start_time, 1800 + 900, "last start + gap (15 min)");
    assert.equal(body.slot.reserved_at_x_id, "alice_x_snap");
    assert.equal(body.slotPart, "A部");
    assert.equal((await call("/api/personal/entry/slotted?slot=sl-p2", "tok-alice")).body.slotPart, (await refSlotted("alice", "sl-p2")).slotPart);
    const e1 = body.eventOptions.find((o) => o.id === "e_open1");
    assert.deepEqual(e1.custom_questions.map((q) => q.question_key), ["extra_select", "extra_text", "stage_permissionX"]);
    assert.equal(e1.custom_questions[0].options.join("|"), "A|B|C", "options trimmed and de-duplicated, non-strings dropped");
    assert.equal(e1.custom_questions[2].type, "textarea");
    assert.equal(e1.custom_questions[2].visibility, "review");
    assert.equal(JSON.parse(e1.video_form_settings_json).stage_permissions.length, 2, "stage rows include inactive ones (CURRENT)");
    assert.equal(body.eventOptions.find((o) => o.id === "e_open3"), undefined, "events without allow_user_video_event_links are not options");
    assert.ok(body.eventOptions.some((o) => o.id === "e_point"), "point events accept entries");
    assert.ok(body.softwareSuggestions.includes("PremierePro") && body.softwareSuggestions.includes("Blender"));
    assert.equal(new Set(body.softwareSuggestions).size, body.softwareSuggestions.length);
    assert.ok(!body.iconCandidates.includes("https://ic.test/private.png"));
    assert.ok(body.channelCandidates.length > 0);
    assert.equal(body.submitBlock, null);
  });

  test("IDOR slotted: other users' slots are 404, foreign reservation only while 'reserved' with a matching active X", async () => {
    const get = async (user, slot) => (await call(`/api/personal/entry/slotted?slot=${slot}`, `tok-${user}`));
    assert.equal((await get("alice", "sl-bob")).status, 404, "bob's slot");
    assert.equal((await get("bob", "sl-g1")).status, 404, "alice's slot");
    assert.equal((await get("alice", "sl-foreign")).body.kind, "ready", "reserved for alice_x by another Discord account");
    assert.equal((await get("alice", "sl-foreign-sub")).status, 404, "submitted foreign slot is not reachable");
    assert.equal((await get("frank", "sl-g1")).status, 404);
    assert.equal((await get("erin", "sl-frank")).status, 404);
    const aliceText = (await get("alice", "sl-g1")).text;
    assert.ok(!/u_bob|u_frank|bob_x/.test(aliceText), "no other users' ids leak");
    const ready = (await get("alice", "sl-g1")).body;
    assert.ok(!("reserved_by_user_id" in ready.slot) && !JSON.stringify(ready).includes("email"));
  });

  test("S2 budget: slotted = session lookup + context + 1 data statement (3, no batch, <= 100 binds)", async () => {
    for (const slot of ["sl-g1", "sl-bob", "sl-sub", "nope"]) {
      const r = await call(`/api/personal/entry/slotted?slot=${slot}`, "tok-alice");
      assert.ok(r.stats.statements <= 3 && r.stats.batches === 0 && r.stats.writes === 0 && r.stats.maxBinds <= 100, slot);
    }
    const r = await call("/api/personal/entry/slotted?slot=sl-g1", "tok-alice");
    assert.equal(r.stats.statements, 3);
  });

  // ---------------- unslotted ----------------
  test("T04 unslotted: form data and event options equal CURRENT for every user x search", async () => {
    const queries = [undefined, "", "Alpha", "alpha", "Unslotted", " Beta ", "e_", "100%", "_x", "%", "zzz-none", "x".repeat(150), "Past"];
    for (const name of NAMES) {
      for (const q of queries) {
        if (name !== "alice" && q !== undefined && q !== "Alpha") continue;
        const path = `/api/personal/entry/unslotted${q === undefined ? "" : `?event_q=${encodeURIComponent(q)}`}`;
        const r = await call(path, `tok-${name}`);
        assert.equal(r.status, 200, `${name} ${q}`);
        assert.deepEqual(r.body, await refUnslotted(name, q), `${name} ${q}`);
        assert.equal(r.headers.get("cache-control"), "private, no-store");
      }
    }
  });

  test("T05 unslotted: eligible events only (public AND allowed-or-ended), newest end first, status label", async () => {
    const { body } = await call("/api/personal/entry/unslotted", "tok-alice");
    const ids = body.eventOptions.map((o) => o.id);
    for (const hidden of ["e_private", "e_past_private", "e_open1", "e_open2"]) assert.ok(!ids.includes(hidden), hidden);
    for (const shown of ["e_unslot_a", "e_unslot_b", "e_past_a", "e_past_b", "e_ended", "e_stage_only"]) assert.ok(ids.includes(shown), shown);
    assert.equal(body.eventOptions.find((o) => o.id === "e_past_a").status_label, "終了済");
    assert.equal(body.eventOptions.find((o) => o.id === "e_unslot_a").status_label, "開催前・開催中の個別許可");
    assert.deepEqual(body.eventOptions.find((o) => o.id === "e_unslot_a").custom_questions.map((q) => q.question_key), ["check_q"], "stage-permission rows are not custom questions");
    assert.equal((await call("/api/personal/entry/unslotted?event_q=" + "z".repeat(300), "tok-alice")).body.eventQuery.length, 100);
    const dave = (await call("/api/personal/entry/unslotted", "tok-dave")).body;
    assert.equal(dave.submitBlock, "no_active_x");
    assert.deepEqual(dave.xIdOptions, []);
    assert.equal((await call("/api/personal/entry/unslotted", "tok-alice")).body.submitBlock, null);
  });

  test("S2 budget: unslotted = session lookup + context + 1 data statement (3, no batch, <= 100 binds)", async () => {
    for (const q of ["", "Alpha"]) {
      const r = await call(`/api/personal/entry/unslotted?event_q=${q}`, "tok-many");
      assert.deepEqual({ statements: r.stats.statements, batches: r.stats.batches, writes: r.stats.writes }, { statements: 3, batches: 0, writes: 0 });
      assert.ok(r.stats.maxBinds <= 100);
    }
  });

  // ---------------- failure parity ----------------
  test("T03 D1 failure -> 503 with a fixed body (CURRENT throws to the error page); nothing leaks", async () => {
    const failing = (match) => {
      const d1 = createD1(sqlite);
      const prepare = d1.prepare;
      d1.prepare = (text) => {
        if (match.test(text)) throw new Error("secret-internal tok-alice");
        return prepare(text);
      };
      return d1;
    };
    for (const [path, match] of [
      ["/api/personal/entry", /required_major/],
      ["/api/personal/entry", /'event' AS k/],
      ["/api/personal/entry/slotted?slot=sl-g1", /required_major/],
      ["/api/personal/entry/slotted?slot=sl-g1", /WITH slot AS/],
      ["/api/personal/entry/unslotted", /required_major/],
      ["/api/personal/entry/unslotted", /WITH ax AS/],
    ]) {
      const r = await call(path, "tok-alice", { d1: failing(match) });
      assert.equal(r.status, 503, `${path} ${match}`);
      assert.equal(r.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(r.body, { error: "unavailable" });
      assert.doesNotMatch(r.text, /secret-internal|tok-alice/);
    }
  });

  test("custom questions over the per-event limit (18) fail like CURRENT (503); reference throws too", async () => {
    for (let i = 0; i < 19; i += 1) {
      sqlite.prepare("INSERT INTO event_custom_questions (id, event_id, question_key, label, sort_order) VALUES (?, 'e_unslot_b', ?, 'l', ?)").run(`over-${i}`, `over_${i}`, i);
    }
    try {
      await assert.rejects(refUnslotted("alice", "Beta"), /video_custom_question_read_limit_exceeded/);
      const r = await call("/api/personal/entry/unslotted?event_q=Beta", "tok-alice");
      assert.equal(r.status, 503);
    } finally {
      sqlite.exec("DELETE FROM event_custom_questions WHERE id LIKE 'over-%'");
    }
  });

  // ---------------- pure functions copied from CURRENT ----------------
  test("event status / ordering helpers equal the real CURRENT modules over a matrix", async () => {
    const times = [null, NOW - 5000, NOW - 10, NOW + 10, NOW + 5000];
    const events = [];
    for (const visibility_status of ["public", "private", "draft", null]) {
      for (const start_time of times) {
        for (const end_time of times) {
          for (const entry_start_time of [null, NOW - 100, NOW + 100]) {
            for (const entry_end_time of [null, NOW - 100, NOW + 100]) {
              events.push({ id: `e${events.length % 7}`, visibility_status, start_time, end_time, entry_start_time, entry_end_time });
            }
          }
        }
      }
    }
    for (const ev of events) {
      assert.equal(apiComputeStatus(ev, NOW), eventStatusLib.computeEventStatus(ev, NOW));
      assert.equal(apiAccepting(ev, NOW), eventStatusLib.isAcceptingEntries(ev, NOW));
    }
    for (let i = 0; i < events.length - 1; i += 37) {
      assert.equal(Math.sign(apiCompare(events[i], events[i + 1], NOW)), Math.sign(compareEventsByUpcomingPriority(events[i], events[i + 1], NOW)));
    }
  });

  // ---------------- MIG-0623 S2 bounds: paging, byte cut, SQL part index ----------------
  const insertEvent = (id, cols) => {
    const row = { id, title: cols.title ?? id, visibility_status: "public", ...cols };
    const keys = Object.keys(row);
    sqlite.prepare(`INSERT INTO events (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => row[k]));
  };
  const dropEvents = (prefix) => {
    sqlite.prepare("DELETE FROM slots WHERE event_id LIKE ?").run(`${prefix}%`);
    sqlite.prepare("DELETE FROM events WHERE id LIKE ?").run(`${prefix}%`);
  };
  async function allPages(path, token, listKey) {
    const ids = [];
    const pages = [];
    let offset = 0;
    for (let guard = 0; guard < 20; guard += 1) {
      const r = await call(`${path}${path.includes("?") ? "&" : "?"}offset=${offset}`, token);
      assert.equal(r.status, 200);
      assert.ok(r.text.length <= 64 * 1024, `response over 64 KiB: ${r.text.length}`);
      pages.push(r.body);
      ids.push(...r.body[listKey].map((o) => o.id));
      if (!r.body.truncated) {
        assert.equal(r.body.nextOffset, null);
        return { ids, pages };
      }
      assert.ok(r.body.nextOffset > offset, "nextOffset must advance");
      offset = r.body.nextOffset;
    }
    throw new Error("paging did not finish");
  }

  test("S2 bounds: unslotted lists > 100 events by ?offset= (100 rows per page), in CURRENT order", async () => {
    try {
      for (let i = 0; i < 130; i += 1) insertEvent(`pg_${String(i).padStart(3, "0")}`, { title: `Zpg ${i}`, allow_unslotted_posts: 1, start_time: NOW + 700_000 + i, end_time: NOW + 800_000 + i });
      const first = (await call("/api/personal/entry/unslotted?event_q=Zpg", "tok-alice")).body;
      assert.equal(first.eventOptions.length, 100);
      assert.equal(first.truncated, true);
      assert.equal(first.nextOffset, 100);
      const { ids } = await allPages("/api/personal/entry/unslotted?event_q=Zpg", "tok-alice", "eventOptions");
      const expected = (await refUnslotted("alice", "Zpg")).eventOptions.map((o) => o.id); // CURRENT reads up to 120 here
      assert.equal(ids.length, 130);
      assert.deepEqual(ids.slice(0, expected.length), expected);
      assert.deepEqual(ids.slice(0, 3), ["pg_129", "pg_128", "pg_127"]);
      // anything but a positive integer is page 0; a huge offset is clamped and simply returns the empty tail
      assert.equal((await call("/api/personal/entry/unslotted?event_q=Zpg&offset=abc", "tok-alice")).body.eventOptions.length, 100);
      const far = await call("/api/personal/entry/unslotted?event_q=Zpg&offset=99999", "tok-alice");
      assert.equal(far.status, 200);
      assert.deepEqual([far.body.eventOptions.length, far.body.truncated, far.body.nextOffset], [0, false, null]);
    } finally {
      dropEvents("pg_");
    }
  });

  test("S2 bounds: at the offset clamp (900) a full page reports truncated with nextOffset null and never repeats a page", async () => {
    try {
      sqlite.exec("BEGIN");
      for (let i = 0; i < 1010; i += 1) insertEvent(`lm_${String(i).padStart(4, "0")}`, { title: `Zlm ${i}`, allow_unslotted_posts: 1, start_time: NOW + 700_000 + i, end_time: NOW + 800_000 + i });
      sqlite.exec("COMMIT");
      const at = async (offset) => (await call(`/api/personal/entry/unslotted?event_q=Zlm&offset=${offset}`, "tok-alice")).body;
      const p800 = await at(800);
      assert.deepEqual([p800.eventOptions.length, p800.truncated, p800.nextOffset], [100, true, 900]);
      const p900 = await at(900);
      assert.deepEqual([p900.eventOptions.length, p900.truncated, p900.nextOffset], [100, true, null]);
      const seen = new Set(p800.eventOptions.map((o) => o.id));
      assert.ok(p900.eventOptions.every((o) => !seen.has(o.id)), "offset 900 must not repeat the 800 page");
      // a request beyond the clamp is the 900 page again, which is why nextOffset is null there instead of 1000
      assert.deepEqual((await at(1000)).eventOptions.map((o) => o.id), p900.eventOptions.map((o) => o.id));
    } finally {
      dropEvents("lm_");
    }
  });

  test("S2 bounds: a page is cut by bytes so the whole response stays <= 64 KiB; the pages concatenate to everything", async () => {
    try {
      for (let i = 0; i < 30; i += 1) {
        insertEvent(`big_${String(i).padStart(2, "0")}`, { title: `Zbig ${i}`, allow_unslotted_posts: 1, start_time: NOW + 700_000 + i, end_time: NOW + 800_000 + i, youtube_description_template: "x".repeat(9000) });
      }
      const { ids, pages } = await allPages("/api/personal/entry/unslotted?event_q=Zbig", "tok-alice", "eventOptions");
      assert.equal(ids.length, 30);
      assert.equal(new Set(ids).size, 30);
      assert.ok(pages.length > 1 && pages[0].truncated && pages[0].eventOptions.length < 30);
      assert.equal(pages[0].nextOffset, pages[0].eventOptions.length);
    } finally {
      dropEvents("big_");
    }
  });

  test("S2 bounds: index events and slotted event options are paged past 100 accepting events", async () => {
    try {
      for (let i = 0; i < 130; i += 1) insertEvent(`ix_${String(i).padStart(3, "0")}`, { title: `Ix ${i}`, entry_start_time: NOW - 1000, entry_end_time: NOW + 6000, allow_user_video_event_links: 1 });
      const index = await allPages("/api/personal/entry", "tok-alice", "events");
      assert.ok(index.pages[0].events.length <= 100 && index.pages[0].truncated);
      assert.equal(index.ids.filter((id) => id.startsWith("ix_")).length, 130);
      assert.equal(new Set(index.ids).size, index.ids.length);
      assert.equal(index.ids.length, (await refIndex("alice")).events.length); // CURRENT lists every accepting event
      const slotted = await allPages("/api/personal/entry/slotted?slot=sl-g1", "tok-alice", "eventOptions");
      assert.ok(slotted.pages[0].eventOptions.length <= 101 && slotted.pages[0].truncated);
      assert.equal(slotted.ids.filter((id) => id.startsWith("ix_")).length, 130);
      assert.equal(new Set(slotted.ids).size, slotted.ids.length);
    } finally {
      dropEvents("ix_");
    }
  });

  test("slot part index computed in SQL equals CURRENT buildSlotParts (gap matrix and an event with > 100 slots)", async () => {
    const PARTS = Array.from({ length: 300 }, (_, i) => `P${i + 1}`);
    const base = 1_700_000_000;
    const small = [
      { id: "a", start_time: base, sort_order: 0 }, { id: "b", start_time: base + 900, sort_order: 1 },
      { id: "c", start_time: base + 3000, sort_order: 2 }, { id: "d", start_time: null, sort_order: 4 },
      { id: "e", start_time: null, sort_order: 5 }, { id: "f", start_time: null, sort_order: 9 },
      { id: "g", start_time: base + 86_400, sort_order: 3 },
    ];
    const big = [];
    let at = base;
    for (let i = 0; i < 250; i += 1) {
      at += i % 7 === 0 ? 3600 : i % 11 === 0 ? 86_400 : 600;
      big.push({ id: `s${String(i).padStart(3, "0")}`, start_time: at, sort_order: i });
    }
    const cases = [
      ...[0, 15, 30, 60, -5, null].map((gap, i) => ({ eventId: `pm_${i}`, gap, slots: small, pick: small.map((x) => x.id) })),
      { eventId: "pm_big", gap: 15, slots: big, pick: big.filter((_, i) => i % 9 === 0).map((x) => x.id) },
    ];
    try {
      for (const { eventId, gap, slots } of cases) {
        insertEvent(eventId, { visibility_status: "private", parts_json: JSON.stringify(PARTS), slot_part_gap_minutes: gap });
        for (const x of slots) {
          sqlite.prepare("INSERT INTO slots (id,event_id,status,reserved_by_user_id,start_time,sort_order) VALUES (?,?,?,?,?,?)").run(`${eventId}-${x.id}`, eventId, "reserved", "u_alice", x.start_time, x.sort_order);
        }
      }
      for (const { eventId, gap, slots, pick } of cases) {
        const parts = buildSlotParts(slots, (gap ?? 15) * 60);
        for (const id of pick) {
          const expected = PARTS[parts.findIndex((part) => part.rows.some((r) => r.id === id))] ?? null;
          const r = await call(`/api/personal/entry/slotted?slot=${eventId}-${id}`, "tok-alice");
          assert.equal(r.body.slotPart, expected, `${eventId} gap ${gap} slot ${id}`);
          assert.equal(r.stats.statements, 3);
        }
      }
    } finally {
      dropEvents("pm_");
    }
  });

  test("read-only: no D1 write and no cookie on any entry endpoint", async () => {
    for (const path of ["/api/personal/entry", "/api/personal/entry/slotted?slot=sl-g1", "/api/personal/entry/unslotted"]) {
      const r = await call(path, "tok-alice");
      assert.equal(r.stats.writes, 0);
      assert.equal(r.headers.get("set-cookie"), null);
    }
  });

  test("response sizes stay well under the 64 KiB JSON bound; statement-count summary (informational)", () => {
    const summary = Object.fromEntries(
      Object.entries(stats).map(([endpoint, list]) => [
        endpoint,
        { max_statements: Math.max(0, ...list.map((s) => s.statements)), max_batches: Math.max(0, ...list.map((s) => s.batches)), max_binds: Math.max(0, ...list.map((s) => s.maxBinds)) },
      ]),
    );
    console.log("[MIG-0623] D1 usage per request", JSON.stringify(summary));
    assert.ok(Object.values(summary).every((s) => s.max_binds <= 100 && s.max_statements <= 3));
  });
}
