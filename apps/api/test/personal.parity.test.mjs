import assert from "node:assert/strict";
import { test } from "node:test";
import { cookie, createD1, createSqlite, fakeBucket, runUnderRootTsx } from "./support/personalHarness.mjs";
import { seed, USERS } from "./support/personalSeed.mjs";

// MIG-0611 parity: the same seed is read by CURRENT's loaders (the real src/** functions plus the
// drizzle queries copied from app/(auth)/**/page.tsx) and by the Hono /api/personal/* routes.
if (runUnderRootTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { and, asc, desc, eq, isNull, ne, or, sql } = await import("drizzle-orm");
  const S = await import("../../../src/lib/db/schema.ts");
  const { app } = await import("../src/app.ts");
  const { approvedXIdsNotWhere, approvedXIdsWhere } = await import("../../../src/lib/auth/approvedXPredicate.ts");
  const { getOnboardingState } = await import("../../../src/lib/auth/onboarding.ts");
  const { getHeaderLinkedXUsersForAuthUser } = await import("../../../src/lib/auth/headerLinkedXUsers.ts");
  const { resolveActiveXUserId } = await import("../../../src/lib/auth/resolveActiveXId.ts");
  const { getLinkedXUsersForAuthUser } = await import("../../../src/lib/auth/xIdentity.ts");
  const { getLatestPublishedMajorTerms, termsReacceptRequiredValue } = await import("../../../src/lib/terms/reaccept.ts");
  const { normalizeXId } = await import("../../../src/lib/utils/xid.ts");
  const { excludePvsfSummaryVideos } = await import("../../../src/lib/db/queries.ts");
  const { creatorIconExpr, creatorNameExpr } = await import("../../../src/lib/db/displayExpr.ts");
  const { getXIconCandidates } = await import("../../../src/lib/db/xIconResolution.ts");
  const { getYoutubeChannelCandidates } = await import("../../../src/lib/db/youtubeChannelCandidates.ts");
  const { normalizePortfolioContact } = await import("../../../src/lib/profileContact.ts");
  const { fetchDegradedRulesPayload } = await import("../../../src/lib/publicData/degradedQueries.ts");
  const { normalizeStaticRules } = await import("../../../src/lib/publicData/staticRulesCore.ts");
  const { parseTab, parsePage } = {
    parseTab: (t) => (["bookmark", "mine", "collab", "chapters"].includes(t) ? t : "like"),
    parsePage: (p) => {
      const c = Number(p);
      return !Number.isSafeInteger(c) || c < 1 ? 1 : Math.min(c, 500);
    },
  };

  const sqlite = createSqlite();
  seed(sqlite);
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
  const nullish = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v ?? null]));

  async function call(path, token, options = {}) {
    const d1 = createD1(sqlite);
    const env = { DB: d1, BUCKET: options.bucket };
    const response = await app.request(path, { method: "GET", headers: token ? cookie(token) : {} }, env);
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null, stats: d1.stats };
  }

  // ---------- CURRENT reference loaders ----------
  async function refUser(name) {
    const id = `u_${name}`;
    const requiredMajor = await getLatestPublishedMajorTerms(refDb);
    const row = (
      await refDb
        .select({
          id: S.users.id,
          name: S.users.name,
          image: S.users.image,
          role: S.users.role,
          is_banned: S.users.is_banned,
          active_x_user_id: S.users.active_x_user_id,
          is_tos_accepted: S.users.is_tos_accepted,
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
      id: row.id,
      name: row.name ?? "ゲスト",
      image: row.image ?? null,
      role: row.role === "admin" || row.role === "moderator" ? row.role : "user",
      is_banned: row.is_banned ?? 0,
      active_x_user_id: active,
      is_tos_accepted: row.is_tos_accepted ?? 0,
      accepted_terms_version_id: row.accepted_terms_version_id ?? null,
      terms_reaccept_required: row.terms_reaccept_required === 1 ? 1 : 0,
    };
  }

  const stripState = (s) => ({
    needsTermsAcceptance: s.needsTermsAcceptance,
    xIdentityStatus: s.xIdentityStatus,
    requestedXId: s.requestedXId,
    activeApprovedXId: s.activeApprovedXId,
    canReserveSlot: s.canReserveSlot,
    canPost: s.canPost,
  });

  const card = (row) => nullish({
    id: row.id,
    title: row.title,
    youtube_video_id: row.youtube_video_id,
    display_name: row.display_name,
    icon_url: row.icon_url,
    creator_x_user_id: row.creator_x_user_id,
    primary_event_id: row.primary_event_id,
    scheduled_time: row.scheduled_time,
    status: row.status,
  });
  const chapter = (row) => nullish({
    id: row.id,
    video_id: row.video_id,
    youtube_video_id: row.youtube_video_id,
    video_title: row.video_title,
    chapter_time: Number(row.chapter_time),
    chapter_label: row.chapter_label,
    visibility: row.visibility,
    created_at: Number(row.created_at),
  });

  // app/(auth)/dashboard/page.tsx (D1 part)
  async function refDashboard(name) {
    const user = await refUser(name);
    const db = refDb;
    const onboarding = await getOnboardingState(db, user);
    const activeX = user.active_x_user_id ?? null;
    const LIMIT = 8;
    const xIds = await db
      .select({ id: S.xUsers.id, x_name: S.xUsers.x_name, icon_url: S.xUsers.icon_url, approval_status: S.xUsers.approval_status })
      .from(S.xUserAccountLinks)
      .innerJoin(S.xUsers, eq(S.xUsers.id, S.xUserAccountLinks.x_user_id))
      .where(eq(S.xUserAccountLinks.auth_user_id, user.id));
    const approvedXIds = Array.from(new Set(xIds.filter((x) => x.approval_status === "approved").map((x) => x.id)));
    let myVideos = [];
    let collabVideos = [];
    let myChapters = [];
    let stats = { likes: 0, views: 0, video_count: 0, event_count: 0 };
    if (approvedXIds.length > 0) {
      if (onboarding.activeApprovedXId) {
        myVideos = await db
          .select({ id: S.videos.id, title: S.videos.title, youtube_video_id: S.videos.youtube_video_id, display_name: S.videos.creator_display_name, icon_url: S.videos.creator_icon_url, creator_x_user_id: S.videos.creator_x_user_id, primary_event_id: S.videos.primary_event_id, scheduled_time: S.videos.scheduled_time, status: S.videos.visibility_status })
          .from(S.videos)
          .where(and(eq(S.videos.creator_x_user_id, onboarding.activeApprovedXId), ne(S.videos.visibility_status, "voided")))
          .orderBy(desc(S.videos.created_at), desc(S.videos.id))
          .limit(LIMIT + 1);
      }
      collabVideos = await db
        .selectDistinct({ id: S.videos.id, title: S.videos.title, youtube_video_id: S.videos.youtube_video_id, display_name: sql`COALESCE(${S.videos.creator_display_name}, ${S.xUsers.x_name}, '@' || ${S.videos.creator_x_user_id})`, icon_url: sql`COALESCE(${S.videos.creator_icon_url}, ${S.xUsers.icon_url})`, creator_x_user_id: S.videos.creator_x_user_id, primary_event_id: S.videos.primary_event_id, scheduled_time: S.videos.scheduled_time, status: S.videos.visibility_status })
        .from(S.videoMembers)
        .innerJoin(S.videos, eq(S.videos.id, S.videoMembers.video_id))
        .leftJoin(S.xUsers, eq(S.xUsers.id, S.videos.creator_x_user_id))
        .where(and(approvedXIdsWhere(S.videoMembers.x_user_id, approvedXIds), eq(S.videoMembers.can_edit, 1), ne(S.videos.visibility_status, "voided"), or(isNull(S.videos.creator_x_user_id), approvedXIdsNotWhere(S.videos.creator_x_user_id, approvedXIds))))
        .orderBy(desc(S.videos.created_at), desc(S.videos.id))
        .limit(LIMIT + 1);
      myChapters = await db
        .select({ id: S.videoChapters.id, video_id: S.videoChapters.video_id, youtube_video_id: S.videos.youtube_video_id, video_title: S.videos.title, chapter_time: S.videoChapters.chapter_time, chapter_label: S.videoChapters.chapter_label, visibility: S.videoChapters.visibility, created_at: S.videoChapters.created_at })
        .from(S.videoChapters)
        .leftJoin(S.videos, eq(S.videos.id, S.videoChapters.video_id))
        .where(approvedXIdsWhere(S.videoChapters.x_user_id, approvedXIds))
        .orderBy(desc(S.videoChapters.created_at), desc(S.videoChapters.id))
        .limit(LIMIT + 1);
    }
    const slotOwnerWhere = activeX
      ? and(eq(S.slots.reserved_by_user_id, user.id), or(eq(S.slots.x_user_id, activeX), isNull(S.slots.x_user_id)))
      : and(isNull(S.slots.x_user_id), eq(S.slots.reserved_by_user_id, user.id));
    const slotRows = await db
      .select()
      .from(S.slots)
      .where(and(slotOwnerWhere, or(eq(S.slots.status, "reserved"), eq(S.slots.status, "submitted"))))
      .orderBy(sql`CASE WHEN ${S.slots.start_time} IS NULL THEN 1 ELSE 0 END`, asc(S.slots.start_time), asc(S.slots.sort_order), asc(S.slots.id))
      .limit(1);
    const mySlot = slotRows[0] ?? null;
    const mySlotEvent = mySlot ? (await db.select().from(S.events).where(eq(S.events.id, mySlot.event_id)).limit(1))[0] ?? null : null;
    if (approvedXIds.length > 0) {
      const statsVideoWhere = and(approvedXIdsWhere(S.videos.creator_x_user_id, approvedXIds), ne(S.videos.visibility_status, "voided"), excludePvsfSummaryVideos());
      const aggRows = await db
        .select({ likes: sql`COALESCE(SUM(${S.videos.app_like_count}),0)`, views: sql`COALESCE(SUM(${S.videoYoutubeMetadata.view_count}),0)`, c: sql`COUNT(*)` })
        .from(S.videos)
        .leftJoin(S.videoYoutubeMetadata, eq(S.videoYoutubeMetadata.video_id, S.videos.id))
        .where(statsVideoWhere);
      const eventCountRows = await db.all(sql`
        SELECT COUNT(*) AS event_count
        FROM (
          SELECT ${S.videos.primary_event_id} AS event_id
          FROM ${S.videos}
          WHERE ${statsVideoWhere}
            AND ${S.videos.primary_event_id} IS NOT NULL
            AND ${S.videos.primary_event_id} <> ''
          UNION
          SELECT ${S.videoEvents.event_id} AS event_id
          FROM ${S.videoEvents}
          INNER JOIN ${S.videos}
            ON ${S.videos.id} = ${S.videoEvents.video_id}
          WHERE ${statsVideoWhere}
            AND ${S.videoEvents.event_id} IS NOT NULL
            AND ${S.videoEvents.event_id} <> ''
        ) AS dashboard_event_ids
      `);
      const eventCountRow = eventCountRows[0];
      stats = {
        likes: Number(aggRows[0]?.likes ?? 0),
        views: Number(aggRows[0]?.views ?? 0),
        video_count: Number(aggRows[0]?.c ?? 0),
        event_count: Number((Array.isArray(eventCountRow) ? eventCountRow[0] : eventCountRow?.event_count) ?? 0),
      };
    }
    return canon({
      user,
      onboarding: stripState(onboarding),
      linkedXUsers: xIds.map((x) => ({ id: x.id, x_name: x.x_name, icon_url: x.icon_url ?? null, approval_status: x.approval_status ?? null })),
      myVideos: { items: myVideos.slice(0, LIMIT).map(card), hasMore: myVideos.length > LIMIT },
      collabVideos: { items: collabVideos.slice(0, LIMIT).map(card), hasMore: collabVideos.length > LIMIT },
      myChapters: { items: myChapters.slice(0, LIMIT).map(chapter), hasMore: myChapters.length > LIMIT },
      activeSlot:
        mySlot && mySlotEvent
          ? {
              slot: { id: mySlot.id, status: mySlot.status, start_time: mySlot.start_time ?? null, slot_label: mySlot.slot_label ?? null, video_id: mySlot.video_id ?? null },
              event: { id: mySlotEvent.id, title: mySlotEvent.title, accent_color: mySlotEvent.accent_color ?? null },
            }
          : null,
      stats,
    });
  }

  // app/(auth)/dashboard/library/page.tsx (D1 part)
  async function refLibrary(name, rawTab, rawPage) {
    const user = await refUser(name);
    const db = refDb;
    const tab = parseTab(rawTab);
    const page = parsePage(rawPage);
    const SIZE = 24;
    const offset = (page - 1) * SIZE;
    let videos = [];
    let chapters = [];
    let hasNextPage = false;
    let hasOtherTabHits = false;
    let activeApprovedXId = null;
    let approvedXIds = [];
    if (tab === "like" || tab === "bookmark") {
      const otherTab = tab === "like" ? "bookmark" : "like";
      const otherTabHit = await db
        .select({ video_id: S.videoInteractionsAuth.video_id })
        .from(S.videoInteractionsAuth)
        .where(and(eq(S.videoInteractionsAuth.auth_user_id, user.id), eq(S.videoInteractionsAuth.interaction_type, otherTab)))
        .limit(1);
      hasOtherTabHits = otherTabHit.length > 0;
      const rows = await db
        .select({ id: S.videos.id, title: S.videos.title, youtube_video_id: S.videos.youtube_video_id, display_name: creatorNameExpr, icon_url: creatorIconExpr, creator_x_user_id: S.videos.creator_x_user_id, primary_event_id: S.videos.primary_event_id, scheduled_time: S.videos.scheduled_time, status: S.videos.visibility_status })
        .from(S.videoInteractionsAuth)
        .innerJoin(S.videos, eq(S.videos.id, S.videoInteractionsAuth.video_id))
        .leftJoin(S.xUsers, eq(S.xUsers.id, S.videos.creator_x_user_id))
        .where(and(eq(S.videoInteractionsAuth.auth_user_id, user.id), eq(S.videoInteractionsAuth.interaction_type, tab), eq(S.videos.visibility_status, "public")))
        .orderBy(desc(S.videos.scheduled_time), desc(S.videos.id))
        .limit(SIZE + 1)
        .offset(offset);
      hasNextPage = page < 500 && rows.length > SIZE;
      videos = rows.slice(0, SIZE);
    } else if (tab === "mine") {
      activeApprovedXId = (await getOnboardingState(db, user)).activeApprovedXId;
      if (activeApprovedXId) {
        const rows = await db
          .select({ id: S.videos.id, title: S.videos.title, youtube_video_id: S.videos.youtube_video_id, display_name: S.videos.creator_display_name, icon_url: S.videos.creator_icon_url, creator_x_user_id: S.videos.creator_x_user_id, primary_event_id: S.videos.primary_event_id, scheduled_time: S.videos.scheduled_time, status: S.videos.visibility_status })
          .from(S.videos)
          .where(and(eq(S.videos.creator_x_user_id, activeApprovedXId), ne(S.videos.visibility_status, "voided")))
          .orderBy(desc(S.videos.created_at), desc(S.videos.id))
          .limit(SIZE + 1)
          .offset(offset);
        hasNextPage = page < 500 && rows.length > SIZE;
        videos = rows.slice(0, SIZE);
      }
    } else {
      const linkedRows = await db
        .select({ id: S.xUsers.id, approval_status: S.xUsers.approval_status })
        .from(S.xUserAccountLinks)
        .innerJoin(S.xUsers, eq(S.xUsers.id, S.xUserAccountLinks.x_user_id))
        .where(eq(S.xUserAccountLinks.auth_user_id, user.id));
      approvedXIds = Array.from(new Set(linkedRows.filter((row) => row.approval_status === "approved").map((row) => row.id)));
      if (approvedXIds.length > 0 && tab === "collab") {
        const rows = await db
          .selectDistinct({ id: S.videos.id, title: S.videos.title, youtube_video_id: S.videos.youtube_video_id, display_name: creatorNameExpr, icon_url: creatorIconExpr, creator_x_user_id: S.videos.creator_x_user_id, primary_event_id: S.videos.primary_event_id, scheduled_time: S.videos.scheduled_time, status: S.videos.visibility_status })
          .from(S.videoMembers)
          .innerJoin(S.videos, eq(S.videos.id, S.videoMembers.video_id))
          .leftJoin(S.xUsers, eq(S.xUsers.id, S.videos.creator_x_user_id))
          .where(and(approvedXIdsWhere(S.videoMembers.x_user_id, approvedXIds), eq(S.videoMembers.can_edit, 1), ne(S.videos.visibility_status, "voided"), or(isNull(S.videos.creator_x_user_id), approvedXIdsNotWhere(S.videos.creator_x_user_id, approvedXIds))))
          .orderBy(desc(S.videos.created_at), desc(S.videos.id))
          .limit(SIZE + 1)
          .offset(offset);
        hasNextPage = page < 500 && rows.length > SIZE;
        videos = rows.slice(0, SIZE);
      } else if (approvedXIds.length > 0 && tab === "chapters") {
        const rows = await db
          .select({ id: S.videoChapters.id, video_id: S.videoChapters.video_id, youtube_video_id: S.videos.youtube_video_id, video_title: S.videos.title, chapter_time: S.videoChapters.chapter_time, chapter_label: S.videoChapters.chapter_label, visibility: S.videoChapters.visibility, created_at: S.videoChapters.created_at })
          .from(S.videoChapters)
          .leftJoin(S.videos, eq(S.videos.id, S.videoChapters.video_id))
          .where(approvedXIdsWhere(S.videoChapters.x_user_id, approvedXIds))
          .orderBy(desc(S.videoChapters.created_at), desc(S.videoChapters.id))
          .limit(SIZE + 1)
          .offset(offset);
        hasNextPage = page < 500 && rows.length > SIZE;
        chapters = rows.slice(0, SIZE);
      }
    }
    return canon({
      tab,
      page,
      pageSize: SIZE,
      hasNextPage,
      hasOtherTabHits,
      activeApprovedXId,
      approvedXIdCount: approvedXIds.length,
      videos: videos.map(card),
      chapters: chapters.map(chapter),
    });
  }

  // app/(auth)/dashboard/settings/page.tsx (D1 part)
  async function refSettings(name, query) {
    const user = await refUser(name);
    const db = refDb;
    const isOnboarding = query.onboarding === "1";
    const legacyTab = query.tab === "account" || query.tab === "xids" ? query.tab : null;
    const parseUtilityTab = (v) => (v === "pending" ? "history" : v === "discord" || v === "link" || v === "history" ? v : null);
    const utilityTab = legacyTab ? null : parseUtilityTab(query.tab);
    const xIdsRaw = await getLinkedXUsersForAuthUser(db, user.id);
    const requestHistory = await db
      .select({ id: S.xIdentityRequests.id, request_type: S.xIdentityRequests.request_type, requested_x_id: S.xIdentityRequests.requested_x_id, source_x_user_id: S.xIdentityRequests.source_x_user_id, target_x_user_id: S.xIdentityRequests.target_x_user_id, parent_request_id: S.xIdentityRequests.parent_request_id, revert_deadline_at: S.xIdentityRequests.revert_deadline_at, status: S.xIdentityRequests.status, requested_at: S.xIdentityRequests.requested_at, updated_at: S.xIdentityRequests.updated_at })
      .from(S.xIdentityRequests)
      .where(eq(S.xIdentityRequests.requested_by_auth_user_id, user.id))
      .orderBy(desc(S.xIdentityRequests.requested_at), desc(S.xIdentityRequests.id))
      .limit(50);
    const xIds = xIdsRaw.map((x) => ({
      id: x.x_user_id,
      x_name: x.x_name,
      icon_url: x.icon_url,
      approval_status: ["approved", "pending", "rejected", "imported"].includes(x.approval_status) ? x.approval_status : "pending",
      requested_at: x.request_requested_at ?? x.created_at,
      profile_text: x.profile_text,
      portfolio_contact: normalizePortfolioContact(x.portfolio_contact),
      youtube_channel_url: x.youtube_channel_url,
      other_social_links: x.other_social_links,
    }));
    const order = (status) => (status === "approved" ? 0 : status === "pending" ? 1 : 2);
    const sortedXIds = [...xIds].sort((a, b) => {
      if (a.id === user.active_x_user_id) return -1;
      if (b.id === user.active_x_user_id) return 1;
      return order(a.approval_status) - order(b.approval_status);
    });
    const requestedX = query.x?.trim() ?? null;
    const selectedX = utilityTab == null && requestedX ? xIds.find((x) => x.id.toLowerCase() === requestedX.toLowerCase()) ?? null : null;
    const defaultX = (user.active_x_user_id ? xIds.find((x) => x.id === user.active_x_user_id) : null) ?? sortedXIds[0] ?? null;
    const activeXPanel = selectedX ?? defaultX;
    const showUtilityTab = isOnboarding ? "link" : utilityTab ?? (xIds.length === 0 && requestHistory.length === 0 ? "link" : xIds.length === 0 && requestHistory.length > 0 ? "history" : null);
    const xTabSelected = showUtilityTab == null && activeXPanel != null;
    let iconCandidates = [];
    let channelCandidates = [];
    if (xTabSelected && activeXPanel) {
      iconCandidates = await getXIconCandidates(db, activeXPanel.id, 12);
      channelCandidates = await getYoutubeChannelCandidates(db, activeXPanel.id, 24);
    }
    return canon({
      user,
      xIds,
      requestHistory: requestHistory.map(nullish),
      panel: { xId: xTabSelected && activeXPanel ? activeXPanel.id : null, iconCandidates, channelCandidates },
    });
  }

  // app/(auth)/onboarding/page.tsx (D1 part; the maybeMarkOnboardingComplete write is intentionally not reproduced)
  async function refOnboarding(name, bucketPayload) {
    const user = await refUser(name);
    const state = await getOnboardingState(refDb, user);
    let rules = null;
    if (state.needsTermsAcceptance) {
      const payload = bucketPayload !== undefined ? bucketPayload : await fetchDegradedRulesPayload(refDb);
      const data = payload ? normalizeStaticRules(payload) : null;
      rules = data ? { versionLabel: data.versionLabel, bodyMarkdown: data.bodyMarkdown } : null;
    }
    return canon({ user, state: stripState(state), rules });
  }

  const ENDPOINTS = ["session", "dashboard", "library", "settings", "onboarding"];
  const stats = { session: [], dashboard: [], library: [], settings: [], onboarding: [] };
  const record = (endpoint, result) => {
    stats[endpoint].push(result.stats);
    assert.equal(result.stats.writes, 0, `${endpoint}: GET must not write`);
    assert.ok(result.stats.maxBinds <= 100, `${endpoint}: ${result.stats.maxBinds} binds`);
    assert.ok(result.stats.statements <= 3, `${endpoint}: ${result.stats.statements} D1 statements (ZERO_1102 S2 allows 3 incl. the session lookup)`);
  };

  // ---------------- T01 / T02 / T03 ----------------
  test("T01 unauthenticated (no cookie, expired, unknown token) -> 401 with no-store on every endpoint", async () => {
    for (const endpoint of ENDPOINTS) {
      for (const token of [null, "tok-expired", "tok-nope"]) {
        const r = await call(`/api/personal/${endpoint}`, token);
        assert.equal(r.status, 401, `${endpoint} ${token}`);
        assert.equal(r.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(r.body, { error: "Unauthorized" });
      }
    }
  });

  test("T02 banned user -> 403 with no-store on every endpoint", async () => {
    for (const endpoint of ENDPOINTS) {
      const r = await call(`/api/personal/${endpoint}`, "tok-banned");
      assert.equal(r.status, 403, endpoint);
      assert.equal(r.headers.get("cache-control"), "private, no-store");
      assert.equal(r.stats.statements, 1, "banned users stop after the session lookup");
    }
  });

  test("T03 success responses are private, no-store JSON", async () => {
    for (const endpoint of ENDPOINTS) {
      const r = await call(`/api/personal/${endpoint}`, "tok-alice", { bucket: fakeBucket({}) });
      assert.equal(r.status, 200, endpoint);
      assert.equal(r.headers.get("cache-control"), "private, no-store");
      assert.match(r.headers.get("content-type") ?? "", /application\/json/);
      record(endpoint, r);
    }
  });

  test("T03 D1 failure -> 503 {error:unavailable}, no-store, no internals", async () => {
    // CURRENT: a failing user/linked-X read throws to the error page -> 503 (settings, library lists, onboarding, session).
    const failing = (match) => {
      const d1 = createD1(sqlite);
      const prepare = d1.prepare;
      d1.prepare = (sql) => {
        if (match.test(sql)) throw new Error("secret-internal tok-alice");
        return prepare(sql);
      };
      return d1;
    };
    for (const [path, match] of [
      ["/api/personal/session", /required_major/],
      ["/api/personal/settings", /required_major/],
      ["/api/personal/onboarding", /required_major/],
      ["/api/personal/dashboard", /required_major/],
      ["/api/personal/library?tab=like", /video_interactions_auth/],
    ]) {
      const response = await app.request(path, { headers: cookie("tok-alice") }, { DB: failing(match) });
      const text = await response.text();
      assert.equal(response.status, 503, path);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(JSON.parse(text), { error: "unavailable" });
      assert.doesNotMatch(text, /secret-internal|tok-alice/);
    }
  });

  test("T03 dashboard sections failing -> same empty sections as CURRENT's swallowed try/catch (200)", async () => {
    const d1 = createD1(sqlite);
    const prepare = d1.prepare;
    d1.prepare = (sql) => {
      if (/AS mine/.test(sql) || /AS slot/.test(sql)) throw new Error("boom");
      return prepare(sql);
    };
    const response = await app.request("/api/personal/dashboard", { headers: cookie("tok-alice") }, { DB: d1 });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(
      { v: body.myVideos, c: body.collabVideos, h: body.myChapters, s: body.activeSlot, st: body.stats },
      {
        v: { items: [], hasMore: false },
        c: { items: [], hasMore: false },
        h: { items: [], hasMore: false },
        s: null,
        st: { likes: 0, views: 0, video_count: 0, event_count: 0 },
      },
    );
    assert.equal(body.linkedXUsers.length, 5, "account/linked X still come from the context read");
    assert.equal(body.onboarding.canPost, true);
  });

  test("other methods are not routed", async () => {
    const response = await app.request("/api/personal/session", { method: "POST", headers: cookie("tok-alice") }, { DB: createD1(sqlite) });
    assert.equal(response.status, 404);
  });

  // ---------------- T04 session / user ----------------
  test("T04 session: user DTO equals CURRENT getCurrentUserContext for every user (terms, active X, name fallback)", async () => {
    for (const name of USERS.filter((u) => u !== "banned")) {
      const r = await call("/api/personal/session", `tok-${name}`);
      assert.equal(r.status, 200, name);
      assert.deepEqual(r.body, { user: await refUser(name) }, name);
      record("session", r);
    }
    const flags = Object.fromEntries(
      await Promise.all(USERS.filter((u) => u !== "banned").map(async (u) => [u, (await call("/api/personal/session", `tok-${u}`)).body.user])),
    );
    assert.equal(flags.alice.terms_reaccept_required, 0);
    assert.equal(flags.bob.terms_reaccept_required, 1, "accepted an older major only");
    assert.equal(flags.carol.is_tos_accepted, 0);
    assert.equal(flags.gina.terms_reaccept_required, 0, "later published version counts as accepted");
    assert.equal(flags.hank.terms_reaccept_required, 0, "consent on the latest major counts");
    assert.equal(flags.dave.name, "ゲスト");
    assert.equal(flags.alice.active_x_user_id, "alice_x");
    assert.equal(flags.ivy.active_x_user_id, "ivy_x");
    assert.equal(flags.frank.active_x_user_id, null);
    assert.equal(flags.dave.active_x_user_id, null, "rejected X is never active");
    assert.ok(!("email" in flags.alice) && !("discord_id" in flags.alice));
  });

  test("S2 budget: session = session lookup + 1 context statement", async () => {
    const r = await call("/api/personal/session", "tok-alice");
    assert.deepEqual({ statements: r.stats.statements, batches: r.stats.batches }, { statements: 2, batches: 0 });
  });

  // ---------------- T04/T05 dashboard ----------------
  test("T04 dashboard: every section equals CURRENT for every user", async () => {
    for (const name of USERS.filter((u) => u !== "banned")) {
      const r = await call("/api/personal/dashboard", `tok-${name}`);
      assert.equal(r.status, 200, name);
      assert.deepEqual(r.body, await refDashboard(name), name);
      record("dashboard", r);
    }
  });

  test("T05 dashboard: voided/private/PVSF/not-approved rules (alice)", async () => {
    const { body } = await call("/api/personal/dashboard", "tok-alice");
    assert.equal(body.myVideos.items.length, 8);
    assert.equal(body.myVideos.hasMore, true);
    assert.ok(body.myVideos.items.every((v) => v.creator_x_user_id === "alice_x" && v.status !== "voided"));
    assert.ok(body.collabVideos.items.every((v) => v.id.startsWith("vc")));
    assert.ok(!body.collabVideos.items.some((v) => ["va1", "vc-voided"].includes(v.id)));
    assert.equal(body.activeSlot.slot.id, "s-early");
    assert.equal(body.activeSlot.event.id, "ev2");
    const erin = (await call("/api/personal/dashboard", "tok-erin")).body;
    assert.equal(erin.activeSlot, null, "slot with a missing event renders as no slot");
    assert.equal(erin.onboarding.xIdentityStatus, "pending");
    assert.equal(erin.onboarding.requestedXId, "erin_new", "newest pending reservation request wins");
    assert.equal((await call("/api/personal/dashboard", "tok-dave")).body.onboarding.xIdentityStatus, "rejected");
    assert.equal((await call("/api/personal/dashboard", "tok-carol")).body.onboarding.needsTermsAcceptance, true);
    assert.equal((await call("/api/personal/dashboard", "tok-frank")).body.onboarding.activeApprovedXId, null);
  });

  test("T07 dashboard: 81 approved X IDs (json_each) match CURRENT and stay <= 100 binds", async () => {
    const r = await call("/api/personal/dashboard", "tok-many");
    assert.deepEqual(r.body, await refDashboard("many"));
    assert.equal(r.body.stats.video_count, 2);
    assert.equal(r.body.stats.event_count, 1);
    assert.equal(r.body.linkedXUsers.length, 81);
    assert.ok(r.stats.maxBinds <= 100);
  });

  test("S2 budget: dashboard = session lookup + context + 1 JSON-sections statement (3, no batch)", async () => {
    const r = await call("/api/personal/dashboard", "tok-alice");
    assert.deepEqual({ statements: r.stats.statements, batches: r.stats.batches }, { statements: 3, batches: 0 });
  });

  // ---------------- T04/T06 library ----------------
  test("T04/T06 library: all tabs and pages equal CURRENT", async () => {
    const users = ["alice", "bob", "carol", "dave", "erin", "frank", "ivy", "many"];
    const pages = [undefined, "1", "2", "3", "0", "-4", "abc", "1.5", "", "500", "99999"];
    for (const name of users) {
      for (const tab of [undefined, "like", "bookmark", "mine", "collab", "chapters", "bogus"]) {
        for (const page of pages) {
          if (name !== "alice" && page !== undefined && page !== "2") continue;
          const query = new URLSearchParams();
          if (tab !== undefined) query.set("tab", tab);
          if (page !== undefined) query.set("page", page);
          const r = await call(`/api/personal/library?${query}`, `tok-${name}`);
          assert.equal(r.status, 200, `${name} ${query}`);
          assert.deepEqual(r.body, await refLibrary(name, tab, page), `${name} ${query}`);
          record("library", r);
        }
      }
    }
  });

  test("T06 library: 24 per page with next-page flag, tie-break by id, page clamp to 1..500", async () => {
    const first = (await call("/api/personal/library?tab=like", "tok-alice")).body;
    assert.equal(first.videos.length, 24);
    assert.equal(first.hasNextPage, true);
    assert.equal(first.hasOtherTabHits, true);
    const second = (await call("/api/personal/library?tab=like&page=2", "tok-alice")).body;
    assert.equal(second.videos.length, 6);
    assert.equal(second.hasNextPage, false);
    assert.equal(new Set([...first.videos, ...second.videos].map((v) => v.id)).size, 30);
    assert.ok(![...first.videos, ...second.videos].some((v) => ["va-private", "vc-voided"].includes(v.id)), "only public rows");
    const clamped = (await call("/api/personal/library?tab=like&page=99999", "tok-alice")).body;
    assert.equal(clamped.page, 500);
    assert.equal((await call("/api/personal/library?tab=nope&page=x", "tok-alice")).body.tab, "like");
    const mine = (await call("/api/personal/library?tab=mine", "tok-alice")).body;
    assert.equal(mine.activeApprovedXId, "alice_x");
    assert.ok(mine.videos.every((v) => v.status !== "voided"));
  });

  test("S2 budget: library statements are bounded (like: 1+2 / mine,collab,chapters: 1+2)", async () => {
    for (const tab of ["like", "bookmark", "mine", "collab", "chapters"]) {
      const r = await call(`/api/personal/library?tab=${tab}`, "tok-alice");
      assert.equal(r.stats.statements, 3, tab);
    }
  });

  // ---------------- settings ----------------
  test("T04 settings: linked X rows, history (50), candidates equal CURRENT for every panel selection", async () => {
    const queries = ["", "tab=link", "tab=history", "tab=pending", "tab=discord", "tab=account", "tab=xids&x=alice_y", "x=ALICE_Y", "x=nobody", "x=alice_p&tab=link", "onboarding=1", "onboarding=1&x=alice_y", "x=%20alice_i%20"];
    for (const name of ["alice", "bob", "carol", "dave", "erin", "frank", "ivy", "many", "gina"]) {
      for (const q of queries) {
        const r = await call(`/api/personal/settings${q ? `?${q}` : ""}`, `tok-${name}`);
        assert.equal(r.status, 200, `${name} ${q}`);
        assert.deepEqual(r.body, await refSettings(name, Object.fromEntries(new URLSearchParams(q))), `${name} ${q}`);
        record("settings", r);
      }
    }
  });

  test("T05 settings: normalisation and candidate rules", async () => {
    const { body } = await call("/api/personal/settings", "tok-alice");
    assert.equal(body.xIds.find((x) => x.id === "alice_x").portfolio_contact, null, "placeholder contact is dropped");
    assert.equal(body.xIds.find((x) => x.id === "alice_y").portfolio_contact, "contact@example.test");
    assert.equal(body.requestHistory.length, 3);
    assert.equal(body.panel.xId, "alice_x");
    assert.ok(!body.panel.iconCandidates.includes("https://ic.test/private.png"), "private video icons are not candidates");
    assert.equal(new Set(body.panel.iconCandidates).size, body.panel.iconCandidates.length);
    assert.ok(body.panel.channelCandidates.every((u) => u.startsWith("http")));
    assert.equal((await call("/api/personal/settings", "tok-carol")).body.requestHistory.length, 50, "history is capped at 50");
    assert.equal((await call("/api/personal/settings?tab=link", "tok-alice")).body.panel.xId, null, "no candidates when a utility tab is shown");
    assert.ok(!JSON.stringify(body).includes("restore_snapshot_json"));
  });

  test("S2 budget: settings = session + context (+ 1 candidates statement for the shown X panel)", async () => {
    const withPanel = await call("/api/personal/settings", "tok-alice");
    assert.deepEqual({ statements: withPanel.stats.statements, batches: withPanel.stats.batches }, { statements: 3, batches: 0 });
    const noPanel = await call("/api/personal/settings?tab=link", "tok-alice");
    assert.deepEqual({ statements: noPanel.stats.statements, batches: noPanel.stats.batches }, { statements: 2, batches: 0 });
  });

  // ---------------- onboarding ----------------
  test("T08 onboarding: state and rules equal CURRENT (D1 fallback when R2 has nothing)", async () => {
    for (const name of USERS.filter((u) => u !== "banned")) {
      const r = await call("/api/personal/onboarding", `tok-${name}`, { bucket: fakeBucket({}) });
      assert.deepEqual(r.body, await refOnboarding(name), name);
      record("onboarding", r);
    }
    const bob = (await call("/api/personal/onboarding", "tok-bob", { bucket: fakeBucket({}) })).body;
    assert.equal(bob.state.needsTermsAcceptance, true);
    assert.deepEqual(bob.rules, { versionLabel: "v2", bodyMarkdown: "# Terms v2\n\n* a" });
    assert.equal((await call("/api/personal/onboarding", "tok-alice", { bucket: fakeBucket({}) })).body.rules, null, "rules only while terms are pending");
  });

  test("T08 onboarding: R2 rules/current.json wins, invalid R2 payload does not fall back (CURRENT), oversize falls back", async () => {
    const good = { version_label: "r2-label", body_markdown: "# from r2", published_at: 5, updated_at: 6, generated_at: 7 };
    const viaR2 = await call("/api/personal/onboarding", "tok-carol", { bucket: fakeBucket({ "rules/current.json": good }) });
    assert.deepEqual(viaR2.body, await refOnboarding("carol", good));
    assert.deepEqual(viaR2.body.rules, { versionLabel: "r2-label", bodyMarkdown: "# from r2" });
    assert.equal(viaR2.stats.statements, 2, "no D1 rules read when R2 has the object");

    const invalid = { version_label: "  ", body_markdown: "x" };
    const viaInvalid = await call("/api/personal/onboarding", "tok-carol", { bucket: fakeBucket({ "rules/current.json": invalid }) });
    assert.deepEqual(viaInvalid.body, await refOnboarding("carol", invalid));
    assert.equal(viaInvalid.body.rules, null);

    const huge = { version_label: "big", body_markdown: "x".repeat(70 * 1024) };
    const viaHuge = await call("/api/personal/onboarding", "tok-carol", { bucket: fakeBucket({ "rules/current.json": huge }) });
    assert.equal(viaHuge.body.rules.versionLabel, "v2", "oversize object -> D1 published terms");

    const noBucket = await call("/api/personal/onboarding", "tok-carol");
    assert.equal(noBucket.body.rules.versionLabel, "v2");
  });

  test("T08 onboarding: visibility guard mirrors CURRENT (enforce needs a committed manifest; unpublished terms never served)", async () => {
    const run = (mode, objects) => {
      const d1 = createD1(sqlite);
      return app
        .request("/api/personal/onboarding", { headers: cookie("tok-carol") }, { DB: d1, BUCKET: fakeBucket(objects), PUBLIC_VISIBILITY_GUARD_MODE: mode })
        .then((r) => r.json());
    };
    const rules = { version_label: "r2-label", body_markdown: "# from r2" };
    assert.equal((await run("enforce", { "rules/current.json": rules })).rules, null, "no manifest -> fail closed");
    assert.equal((await run("enforce", { "rules/current.json": rules, "visibility/blocked-entities.v1.json": {} })).rules.versionLabel, "r2-label");
    assert.equal((await run("observe", { "rules/current.json": rules })).rules.versionLabel, "r2-label");
    assert.equal((await run("off", {})).rules.versionLabel, "v2", "D1 fallback only returns published terms");
    sqlite.exec("UPDATE terms_versions SET status = 'draft' WHERE id = 'T2'");
    try {
      assert.equal((await run("off", {})).rules, null, "unpublished terms are never served");
    } finally {
      sqlite.exec("UPDATE terms_versions SET status = 'published' WHERE id = 'T2'");
    }
  });

  test("read-only: nothing wrote to D1 and no endpoint set a cookie", async () => {
    for (const endpoint of ENDPOINTS) {
      const r = await call(`/api/personal/${endpoint}`, "tok-alice", { bucket: fakeBucket({}) });
      assert.equal(r.stats.writes, 0);
      assert.equal(r.headers.get("set-cookie"), null);
    }
    const onboardingMarker = sqlite.prepare('SELECT onboarding_completed_at FROM "user" WHERE id = ?').get("u_alice");
    assert.equal(onboardingMarker.onboarding_completed_at, null, "maybeMarkOnboardingComplete is not reproduced");
  });

  test("statement-count summary (informational)", () => {
    const summary = Object.fromEntries(
      Object.entries(stats).map(([endpoint, list]) => [
        endpoint,
        { max_statements: Math.max(0, ...list.map((s) => s.statements)), max_batches: Math.max(0, ...list.map((s) => s.batches)), max_binds: Math.max(0, ...list.map((s) => s.maxBinds)) },
      ]),
    );
    console.log("[MIG-0611] D1 usage per request", JSON.stringify(summary));
    assert.ok(Object.values(summary).every((s) => s.max_binds <= 100));
  });
}
