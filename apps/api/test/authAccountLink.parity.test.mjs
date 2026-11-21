/**
 * MIG-0803 (U01/U02, T01-T03): Discord/account-linking parity against CURRENT.
 *
 * Tests real SQLite + D1 atomic linking, bidirectional CURRENT <-> Hono
 * re-link/hijack parity, full @auth/core OAuth callback & replay rejection,
 * terms-unaccepted/banned transitions, and zero secret leaks in logs/responses.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { customFetch } from "@auth/core";
import { runTestWithTsx } from "../../../src/lib/testing/runTestWithTsx.mjs";
import { loadAuthBaseline } from "../../../src/lib/auth/authBaselineHarness.mjs";
import {
  AUTH_BASELINE_ENV,
  BASELINE_COOKIES,
  USERS,
} from "../../../src/lib/auth/authBaseline.fixture.mjs";

process.env.TSX_TSCONFIG_PATH ??= fileURLToPath(
  new URL("../../../tsconfig.json", import.meta.url),
);

if (runTestWithTsx(import.meta.url)) {
  const { Auth, buildAuthConfig, createHarness, setCookies } = await loadAuthBaseline();
  const {
    accountRowWithoutTokens: currentWithoutTokens,
    linkDiscordAccountAtomically: currentLinkAtomically,
  } = await import("../../../src/lib/auth/accountLinkAdapter.ts");
  const { resolveAuthCompleteSession, sanitizeAuthCompleteNext } =
    await import("../../../src/lib/auth/authComplete.ts");
  const { getOnboardingState } = await import("../../../src/lib/auth/onboarding.ts");
  const {
    accountRowWithoutTokens: honoWithoutTokens,
    buildUnmountedAuthConfig,
    invokeUnmountedAuth,
    linkDiscordAccountAtomically: honoLinkAtomically,
  } = await import("../src/auth/authjs.ts");
  const { createUnmountedAuthCompleteRoutes } =
    await import("../src/routes/authComplete.ts");
  const { app } = await import("../src/app.ts");

  const ORIGIN = AUTH_BASELINE_ENV.AUTH_URL;
  const PKCE_COOKIE = "__Secure-authjs.pkce.code_verifier";
  const CALLBACK_URL_COOKIE = "__Secure-authjs.callback-url";
  const SESSION_COOKIE = BASELINE_COOKIES.sessionToken.name;
  const CSRF_COOKIE = BASELINE_COOKIES.csrfToken.name;

  function input(d1) {
    return {
      d1,
      authSecret: AUTH_BASELINE_ENV.AUTH_SECRET,
      discordClientId: AUTH_BASELINE_ENV.AUTH_DISCORD_ID,
      discordClientSecret: AUTH_BASELINE_ENV.AUTH_DISCORD_SECRET,
      authOrigin: ORIGIN,
      siteOrigin: AUTH_BASELINE_ENV.NEXT_PUBLIC_SITE_URL,
    };
  }

  function insertUnlinkedUser(sqlite, {
    id,
    name = "New User",
    email = `${id}@example.com`,
    discordId = null,
    isBanned = 0,
    isTosAccepted = 0,
  }) {
    sqlite
      .prepare(
        `INSERT INTO "user" (id, name, email, role, is_banned, is_tos_accepted, discord_id)
         VALUES (?, ?, ?, 'user', ?, ?, ?)`,
      )
      .run(id, name, email, isBanned, isTosAccepted, discordId);
  }

  function createMockDiscordFetch({ discordId, username, email }) {
    const usedCodes = new Set();
    return async (url, init) => {
      const target = String(url);
      if (target === "https://discord.com/api/oauth2/token") {
        const body = new URLSearchParams(String(init?.body ?? ""));
        const code = body.get("code");
        if (!code || usedCodes.has(code)) {
          return new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        usedCodes.add(code);
        return new Response(
          JSON.stringify({
            access_token: "discord-access-secret-token",
            refresh_token: "discord-refresh-secret-token",
            token_type: "Bearer",
            expires_in: 3600,
            scope: "identify email",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (target === "https://discord.com/api/users/@me") {
        return new Response(
          JSON.stringify({
            id: discordId,
            username,
            global_name: username,
            discriminator: "0",
            avatar: "synthetic_avatar",
            email,
            verified: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Unexpected external fetch in test: ${target}`);
    };
  }

  function attachDiscordFetch(config, mockFetch) {
    config.providers[0].options[customFetch] = mockFetch;
    return config;
  }

  async function startDiscordOAuth(invoke, { next = "/dashboard" } = {}) {
    const csrfRes = await invoke(new Request(`${ORIGIN}/api/auth/csrf`));
    assert.equal(csrfRes.status, 200);
    const { csrfToken } = await csrfRes.json();
    const csrfCookie = setCookies(csrfRes)[CSRF_COOKIE]?.value;
    assert.ok(csrfToken && csrfCookie);

    const signinRes = await invoke(
      new Request(`${ORIGIN}/api/auth/signin/discord`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `${CSRF_COOKIE}=${csrfCookie}`,
        },
        body: new URLSearchParams({
          csrfToken,
          callbackUrl: `/auth/complete?next=${encodeURIComponent(next)}`,
        }),
      }),
    );
    assert.equal(signinRes.status, 302);
    const authorizeUrl = new URL(signinRes.headers.get("location"));
    assert.equal(authorizeUrl.origin, "https://discord.com");
    assert.equal(authorizeUrl.searchParams.get("scope"), "identify email");
    const cookies = setCookies(signinRes);
    const pkceCookie = cookies[PKCE_COOKIE]?.value;
    const callbackUrlCookie = cookies[CALLBACK_URL_COOKIE]?.value;
    assert.ok(pkceCookie, "signin must issue PKCE verification cookie");
    assert.ok(callbackUrlCookie, "signin must issue callback-url cookie");
    return {
      pkceCookie,
      callbackUrlCookie,
      cookieHeader: `${PKCE_COOKIE}=${pkceCookie}; ${CALLBACK_URL_COOKIE}=${callbackUrlCookie}`,
    };
  }

  function captureLogs(fn) {
    const captured = [];
    const origInfo = console.info;
    const origWarn = console.warn;
    const origError = console.error;
    console.info = (...args) => captured.push(args.map(String).join(" "));
    console.warn = (...args) => captured.push(args.map(String).join(" "));
    console.error = (...args) => captured.push(args.map(String).join(" "));
    return Promise.resolve()
      .then(fn)
      .then(
        (result) => {
          console.info = origInfo;
          console.warn = origWarn;
          console.error = origError;
          return { result, logs: captured };
        },
        (error) => {
          console.info = origInfo;
          console.warn = origWarn;
          console.error = origError;
          throw error;
        },
      );
  }

  test("U01: accountRowWithoutTokens matches CURRENT across tokens and optional metadata", () => {
    const raw = {
      userId: "user-1",
      type: "oauth",
      provider: "discord",
      providerAccountId: "discord-1",
      access_token: "secret-access",
      refresh_token: "secret-refresh",
      id_token: "secret-id",
      expires_at: 1700000000,
      token_type: "Bearer",
      scope: "identify email",
      session_state: "  ",
    };
    assert.deepEqual(honoWithoutTokens(raw), currentWithoutTokens(raw));
    assert.deepEqual(
      honoWithoutTokens({ ...raw, expires_at: 1.5, token_type: "", scope: undefined }),
      currentWithoutTokens({ ...raw, expires_at: 1.5, token_type: "", scope: undefined }),
    );
  });

  test("U01: first-link D1 batch, audit log, and outbox notifications match CURRENT", async (t) => {
    const hCurrent = createHarness(t);
    const hTarget = createHarness(t);
    insertUnlinkedUser(hCurrent.sqlite, { id: "u-first", name: "FirstUser" });
    insertUnlinkedUser(hTarget.sqlite, { id: "u-first", name: "FirstUser" });

    const account = {
      userId: "u-first",
      type: "oauth",
      provider: "discord",
      providerAccountId: "discord-first-1",
      access_token: "secret-access-1",
      refresh_token: "secret-refresh-1",
      id_token: "secret-id-1",
      expires_at: 1700000000,
      token_type: "Bearer",
      scope: "identify email",
      session_state: null,
    };

    await currentLinkAtomically(
      hCurrent.db,
      account,
      undefined,
      undefined,
      AUTH_BASELINE_ENV.NEXT_PUBLIC_SITE_URL,
    );
    await honoLinkAtomically(hTarget.db, account, {
      siteOrigin: AUTH_BASELINE_ENV.NEXT_PUBLIC_SITE_URL,
    });

    const curAcc = hCurrent.sqlite.prepare('SELECT * FROM "account" WHERE "userId" = ?').get("u-first");
    const honoAcc = hTarget.sqlite.prepare('SELECT * FROM "account" WHERE "userId" = ?').get("u-first");
    assert.deepEqual(honoAcc, curAcc);
    assert.equal(honoAcc.access_token, null);
    assert.equal(honoAcc.refresh_token, null);
    assert.equal(honoAcc.id_token, null);

    assert.equal(
      hTarget.sqlite.prepare('SELECT discord_id FROM "user" WHERE id = ?').get("u-first").discord_id,
      "discord-first-1",
    );

    const curAudit = hCurrent.sqlite.prepare('SELECT * FROM "audit_logs" WHERE target_id = ?').get("u-first");
    const honoAudit = hTarget.sqlite.prepare('SELECT * FROM "audit_logs" WHERE target_id = ?').get("u-first");
    assert.ok(curAudit && honoAudit);
    assert.equal(honoAudit.table_name, curAudit.table_name);
    assert.equal(honoAudit.operation, curAudit.operation);
    assert.equal(honoAudit.before_json, curAudit.before_json);
    assert.equal(honoAudit.after_json, curAudit.after_json);
    assert.equal(honoAudit.changed_keys_json, curAudit.changed_keys_json);
    assert.equal(honoAudit.reason, curAudit.reason);
    assert.equal(honoAudit.context, curAudit.context);
    assert.equal(honoAudit.retention_class, curAudit.retention_class);

    const curOutbox = hCurrent.sqlite
      .prepare('SELECT type, delivery_route, dedupe_key, payload_json FROM "notification_outbox" ORDER BY type')
      .all();
    const honoOutbox = hTarget.sqlite
      .prepare('SELECT type, delivery_route, dedupe_key, payload_json FROM "notification_outbox" ORDER BY type')
      .all();
    assert.equal(honoOutbox.length, 2);
    assert.equal(curOutbox.length, 2);
    for (let i = 0; i < 2; i++) {
      assert.equal(honoOutbox[i].type, curOutbox[i].type);
      assert.equal(honoOutbox[i].delivery_route, curOutbox[i].delivery_route);
      assert.equal(honoOutbox[i].dedupe_key, curOutbox[i].dedupe_key);
      const honoPayload = JSON.parse(honoOutbox[i].payload_json);
      const curPayload = JSON.parse(curOutbox[i].payload_json);
      assert.equal(honoPayload.url, curPayload.url);
      assert.deepEqual(honoPayload.allowed_mentions, curPayload.allowed_mentions);
      assert.equal(honoPayload.webhook_target, curPayload.webhook_target);
      assert.equal(honoPayload.thread_name, curPayload.thread_name);
      if (honoOutbox[i].type === "welcome_account") {
        assert.equal(honoPayload.content, curPayload.content);
      }
    }
  });

  test("U01/U02: bidirectional CURRENT <-> Hono re-link is idempotent and rejects hijack", async (t) => {
    // Direction 1: CURRENT links -> Hono re-links (no-op) & Hono hijack fails closed.
    const h1 = createHarness(t);
    insertUnlinkedUser(h1.sqlite, { id: "u-dir1", name: "Dir1" });
    insertUnlinkedUser(h1.sqlite, { id: "u-attacker1", name: "Attacker1" });
    const acc1 = {
      userId: "u-dir1",
      type: "oauth",
      provider: "discord",
      providerAccountId: "discord-dir-1",
    };
    await currentLinkAtomically(h1.db, acc1, undefined, undefined, AUTH_BASELINE_ENV.NEXT_PUBLIC_SITE_URL);
    const honoCfg1 = buildUnmountedAuthConfig(input(h1.d1));
    await honoCfg1.adapter.linkAccount(acc1);
    assert.equal(
      h1.sqlite.prepare('SELECT COUNT(*) AS n FROM "account" WHERE "providerAccountId" = ?').get("discord-dir-1").n,
      1,
    );
    await assert.rejects(
      honoCfg1.adapter.linkAccount({ ...acc1, userId: "u-attacker1" }),
      /AUTH_DISCORD_ID_CONFLICT/,
    );
    assert.equal(
      h1.sqlite.prepare('SELECT discord_id FROM "user" WHERE id = ?').get("u-attacker1").discord_id,
      null,
    );

    // Direction 2: Hono links -> CURRENT re-links (no-op) & CURRENT hijack fails closed.
    const h2 = createHarness(t);
    insertUnlinkedUser(h2.sqlite, { id: "u-dir2", name: "Dir2" });
    insertUnlinkedUser(h2.sqlite, { id: "u-attacker2", name: "Attacker2" });
    const acc2 = {
      userId: "u-dir2",
      type: "oauth",
      provider: "discord",
      providerAccountId: "discord-dir-2",
    };
    const honoCfg2 = buildUnmountedAuthConfig(input(h2.d1));
    await honoCfg2.adapter.linkAccount(acc2);
    await currentLinkAtomically(h2.db, acc2, undefined, undefined, AUTH_BASELINE_ENV.NEXT_PUBLIC_SITE_URL);
    assert.equal(
      h2.sqlite.prepare('SELECT COUNT(*) AS n FROM "account" WHERE "providerAccountId" = ?').get("discord-dir-2").n,
      1,
    );
    await assert.rejects(
      currentLinkAtomically(h2.db, { ...acc2, userId: "u-attacker2" }),
      /AUTH_DISCORD_ID_CONFLICT/,
    );
    assert.equal(
      h2.sqlite.prepare('SELECT discord_id FROM "user" WHERE id = ?').get("u-attacker2").discord_id,
      null,
    );
  });

  test("T01: simultaneous login/linking prevents duplicate accounts, duplicate audits, and cross-user takeover", async (t) => {
    // Case A: two concurrent link attempts for the same user (simulated CAS race on real SQLite).
    const hSame = createHarness(t);
    insertUnlinkedUser(hSame.sqlite, { id: "u-race-same", name: "RaceSame" });
    const accountSame = {
      userId: "u-race-same",
      type: "oauth",
      provider: "discord",
      providerAccountId: "discord-race-same",
      access_token: "secret-a",
      refresh_token: "secret-r",
    };

    const { mutateWithAudit } = await import("@flamenode/server-core/audit/mutate");
    let racedWinnerCommitted = false;
    await honoLinkAtomically(hSame.db, accountSame, {
      siteOrigin: AUTH_BASELINE_ENV.NEXT_PUBLIC_SITE_URL,
      mutate: async (receivedDb, mutationInput) => {
        if (!racedWinnerCommitted) {
          racedWinnerCommitted = true;
          // Simulate a concurrent winner committing before the loser's batch executes.
          await honoLinkAtomically(hSame.db, accountSame, {
            siteOrigin: AUTH_BASELINE_ENV.NEXT_PUBLIC_SITE_URL,
          });
        }
        return mutateWithAudit(receivedDb, mutationInput);
      },
    });

    assert.equal(
      hSame.sqlite.prepare('SELECT COUNT(*) AS n FROM "account" WHERE "providerAccountId" = ?').get("discord-race-same").n,
      1,
    );
    assert.equal(
      hSame.sqlite.prepare('SELECT COUNT(*) AS n FROM "audit_logs" WHERE target_id = ?').get("u-race-same").n,
      1,
    );
    assert.equal(
      hSame.sqlite.prepare('SELECT COUNT(*) AS n FROM "notification_outbox" WHERE recipient_user_id = ?').get("u-race-same").n,
      2,
      "only winner enqueues welcome DM + ops channel notification once",
    );

    // Case B: two different users racing after pre-checks for the same Discord ID.
    const hDiff = createHarness(t);
    insertUnlinkedUser(hDiff.sqlite, { id: "u-race-1", name: "Race1" });
    insertUnlinkedUser(hDiff.sqlite, { id: "u-race-2", name: "Race2" });
    let crossWinnerCommitted = false;
    await assert.rejects(
      honoLinkAtomically(
        hDiff.db,
        {
          userId: "u-race-2",
          type: "oauth",
          provider: "discord",
          providerAccountId: "discord-race-cross",
        },
        {
          siteOrigin: AUTH_BASELINE_ENV.NEXT_PUBLIC_SITE_URL,
          mutate: async (receivedDb, mutationInput) => {
            if (!crossWinnerCommitted) {
              crossWinnerCommitted = true;
              await honoLinkAtomically(
                hDiff.db,
                {
                  userId: "u-race-1",
                  type: "oauth",
                  provider: "discord",
                  providerAccountId: "discord-race-cross",
                },
                { siteOrigin: AUTH_BASELINE_ENV.NEXT_PUBLIC_SITE_URL },
              );
            }
            return mutateWithAudit(receivedDb, mutationInput);
          },
        },
      ),
    );
    assert.equal(
      hDiff.sqlite.prepare('SELECT "userId" FROM "account" WHERE "providerAccountId" = ?').get("discord-race-cross").userId,
      "u-race-1",
    );
    assert.equal(
      hDiff.sqlite.prepare('SELECT discord_id FROM "user" WHERE id = ?').get("u-race-2").discord_id,
      null,
    );
  });

  test("T02: full OAuth callback rejects replay, invalid PKCE cookie, and other-owner hijack identically to CURRENT", async (t) => {
    for (const runtime of ["current", "hono"]) {
      const h = createHarness(t);
      const mockFetch = createMockDiscordFetch({
        discordId: "discord-oauth-new-1",
        username: "OAuthUser",
        email: "oauth-new@example.com",
      });
      const invoke = async (request) => {
        const config = runtime === "current"
          ? await buildAuthConfig()
          : buildUnmountedAuthConfig(input(h.d1));
        attachDiscordFetch(config, mockFetch);
        return runtime === "current"
          ? Auth(request, { ...config, basePath: "/api/auth" })
          : invokeUnmountedAuth(request, config);
      };

      const { pkceCookie, cookieHeader } = await startDiscordOAuth(invoke, { next: "/dashboard" });
      const callbackUrl = `${ORIGIN}/api/auth/callback/discord?code=single-use-code-1`;

      // First callback succeeds, strips tokens, clears PKCE cookie, and sets session cookie.
      const first = await invoke(
        new Request(callbackUrl, { headers: { cookie: cookieHeader } }),
      );
      assert.equal(first.status, 302, `${runtime} first callback`);
      assert.equal(
        new URL(first.headers.get("location"), ORIGIN).pathname +
          new URL(first.headers.get("location"), ORIGIN).search,
        "/auth/complete?next=%2Fdashboard",
      );
      const cookiesAfter = setCookies(first);
      assert.equal(cookiesAfter[PKCE_COOKIE]?.value, "", `${runtime} must clear PKCE cookie`);
      const sessionToken = cookiesAfter[SESSION_COOKIE]?.value;
      assert.ok(sessionToken, `${runtime} must issue session cookie`);

      const accountRow = h.sqlite
        .prepare('SELECT * FROM "account" WHERE "providerAccountId" = ?')
        .get("discord-oauth-new-1");
      assert.ok(accountRow);
      assert.equal(accountRow.access_token, null);
      assert.equal(accountRow.refresh_token, null);
      assert.equal(accountRow.id_token, null);
      const sessionsBeforeReplay = h.sqlite.prepare('SELECT COUNT(*) AS n FROM "session"').get().n;

      // Replay 1: browser follows cleared cookies (missing PKCE cookie) or tampered PKCE cookie.
      for (const badCookie of ["", `${PKCE_COOKIE}=tampered.invalid.jwt`]) {
        const replay = await invoke(
          new Request(callbackUrl, badCookie ? { headers: { cookie: badCookie } } : undefined),
        );
        assert.equal(replay.status, 302, `${runtime} replay without valid PKCE`);
        const loc = new URL(replay.headers.get("location"), ORIGIN);
        assert.equal(loc.pathname, "/entry");
        assert.equal(loc.searchParams.get("error"), "Configuration");
        assert.equal(setCookies(replay)[SESSION_COOKIE], undefined);
      }

      // Replay 2: raw PKCE cookie + same code replayed -> Discord token endpoint rejects single-use code.
      const codeReplay = await invoke(
        new Request(callbackUrl, { headers: { cookie: cookieHeader } }),
      );
      assert.equal(codeReplay.status, 302, `${runtime} raw code replay`);
      const replayLoc = new URL(codeReplay.headers.get("location"), ORIGIN);
      assert.equal(replayLoc.pathname, "/entry");
      assert.equal(replayLoc.searchParams.get("error"), "Configuration");
      assert.equal(setCookies(codeReplay)[SESSION_COOKIE], undefined);
      assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM "session"').get().n, sessionsBeforeReplay);
    }

    // Other-owner hijack attempt during active session (account owned by USERS.valid, signed in as USERS.noX).
    for (const runtime of ["current", "hono"]) {
      const h = createHarness(t);
      const mockFetch = createMockDiscordFetch({
        discordId: USERS.valid.discord_id,
        username: "Valid",
        email: "attacker-unrelated@example.com",
      });
      const invoke = async (request) => {
        const config = runtime === "current"
          ? await buildAuthConfig()
          : buildUnmountedAuthConfig(input(h.d1));
        attachDiscordFetch(config, mockFetch);
        return runtime === "current"
          ? Auth(request, { ...config, basePath: "/api/auth" })
          : invokeUnmountedAuth(request, config);
      };
      const { cookieHeader } = await startDiscordOAuth(invoke);
      const hijack = await invoke(
        new Request(`${ORIGIN}/api/auth/callback/discord?code=hijack-code-1`, {
          headers: {
            cookie: `${cookieHeader}; ${SESSION_COOKIE}=${h.sqlite.prepare('SELECT "sessionToken" FROM "session" WHERE "userId" = ?').get(USERS.noX.id).sessionToken}`,
          },
        }),
      );
      assert.equal(hijack.status, 302);
      const loc = new URL(hijack.headers.get("location"), ORIGIN);
      assert.equal(loc.pathname, "/entry");
      assert.equal(loc.searchParams.get("error"), "OAuthAccountNotLinked");
      assert.equal(
        h.sqlite.prepare('SELECT "userId" FROM "account" WHERE "providerAccountId" = ?').get(USERS.valid.discord_id).userId,
        USERS.valid.id,
      );
    }

    // user.discord_id conflict without account row -> linkDiscordAccountAtomically rejects fail-closed.
    for (const runtime of ["current", "hono"]) {
      const h = createHarness(t);
      insertUnlinkedUser(h.sqlite, {
        id: "u-prelinked",
        name: "Prelinked",
        email: "prelinked@example.com",
        discordId: "discord-conflict-only-user",
      });
      insertUnlinkedUser(h.sqlite, {
        id: "u-signed-in",
        name: "SignedIn",
        email: "signedin@example.com",
      });
      h.sqlite
        .prepare('INSERT INTO "session" ("sessionToken", "userId", expires) VALUES (?, ?, ?)')
        .run("tok-signed-in", "u-signed-in", Date.now() + 86_400_000);
      const mockFetch = createMockDiscordFetch({
        discordId: "discord-conflict-only-user",
        username: "SignedIn",
        email: "signedin@example.com",
      });
      const invoke = async (request) => {
        const config = runtime === "current"
          ? await buildAuthConfig()
          : buildUnmountedAuthConfig(input(h.d1));
        attachDiscordFetch(config, mockFetch);
        return runtime === "current"
          ? Auth(request, { ...config, basePath: "/api/auth" })
          : invokeUnmountedAuth(request, config);
      };
      const { cookieHeader } = await startDiscordOAuth(invoke);
      const conflictRes = await invoke(
        new Request(`${ORIGIN}/api/auth/callback/discord?code=conflict-code-1`, {
          headers: { cookie: `${cookieHeader}; ${SESSION_COOKIE}=tok-signed-in` },
        }),
      );
      assert.equal(conflictRes.status, 302);
      const loc = new URL(conflictRes.headers.get("location"), ORIGIN);
      assert.equal(loc.pathname, "/entry");
      assert.equal(loc.searchParams.get("error"), "Configuration");
      assert.equal(
        h.sqlite.prepare('SELECT COUNT(*) AS n FROM "account" WHERE "providerAccountId" = ?').get("discord-conflict-only-user").n,
        0,
      );
      assert.equal(
        h.sqlite.prepare('SELECT discord_id FROM "user" WHERE id = ?').get("u-signed-in").discord_id,
        null,
      );
    }
  });

  test("T03: terms-unaccepted and banned users follow exact CURRENT transitions and guards", async (t) => {
    // 1. Terms not accepted: OAuth callback + /auth/complete + /api/personal/onboarding parity.
    const h = createHarness(t);
    const mockFetch = createMockDiscordFetch({
      discordId: "discord-tos-pending-1",
      username: "TosPending",
      email: "tos-pending@example.com",
    });
    const invokeHono = async (request) => {
      const config = attachDiscordFetch(buildUnmountedAuthConfig(input(h.d1)), mockFetch);
      return invokeUnmountedAuth(request, config);
    };
    const { cookieHeader } = await startDiscordOAuth(invokeHono, { next: "/dashboard" });
    const callbackRes = await invokeHono(
      new Request(`${ORIGIN}/api/auth/callback/discord?code=tos-code-1`, {
        headers: { cookie: cookieHeader },
      }),
    );
    assert.equal(callbackRes.status, 302);
    const completeLoc = new URL(callbackRes.headers.get("location"), ORIGIN);
    assert.equal(completeLoc.pathname, "/auth/complete");
    const sessionToken = setCookies(callbackRes)[SESSION_COOKIE]?.value;
    assert.ok(sessionToken);

    const completeApp = createUnmountedAuthCompleteRoutes(input(h.d1), async () => {});
    const completeRes = await completeApp.request(`${ORIGIN}${completeLoc.pathname}${completeLoc.search}`, {
      headers: { cookie: `${SESSION_COOKIE}=${sessionToken}` },
    });
    assert.equal(completeRes.status, 303);

    // CURRENT authComplete resolution + onboarding state on the exact same DB user.
    const currentResolution = await resolveAuthCompleteSession(async () => {
      const cfg = await buildAuthConfig();
      const res = await Auth(
        new Request(`${ORIGIN}/api/auth/session`, {
          headers: { cookie: `${SESSION_COOKIE}=${sessionToken}` },
        }),
        { ...cfg, basePath: "/api/auth" },
      );
      return res.json();
    }, async () => {});
    assert.equal(currentResolution.kind, "authenticated");
    const currentDestination = sanitizeAuthCompleteNext(completeLoc.searchParams.get("next"), "/dashboard");
    assert.equal(
      new URL(completeRes.headers.get("location"), ORIGIN).pathname,
      currentDestination,
    );

    const createdUser = h.sqlite
      .prepare('SELECT * FROM "user" WHERE discord_id = ?')
      .get("discord-tos-pending-1");
    assert.equal(createdUser.is_tos_accepted, 0);

    const currentOnboarding = await getOnboardingState(h.db, {
      ...createdUser,
      role: "user",
      is_tos_accepted: 0,
      terms_reaccept_required: 0,
    });
    const personalOnboardingRes = await app.request(
      `${ORIGIN}/api/personal/onboarding`,
      { headers: { cookie: `${SESSION_COOKIE}=${sessionToken}` } },
      { DB: h.d1, NEXT_PUBLIC_SITE_URL: ORIGIN },
    );
    assert.equal(personalOnboardingRes.status, 200);
    const personalOnboarding = await personalOnboardingRes.json();
    assert.equal(personalOnboarding.state.needsTermsAcceptance, currentOnboarding.needsTermsAcceptance);
    assert.equal(personalOnboarding.state.needsTermsAcceptance, true);
    assert.equal(personalOnboarding.state.canReserveSlot, currentOnboarding.canReserveSlot);
    assert.equal(personalOnboarding.state.canReserveSlot, false);
    assert.equal(personalOnboarding.state.canPost, false);

    // 2. Banned user: /auth/complete redirects to AccessDenied and /api/personal/* rejects with 403.
    h.sqlite.prepare('UPDATE "user" SET is_banned = 1 WHERE id = ?').run(createdUser.id);
    const bannedComplete = await completeApp.request(`${ORIGIN}/auth/complete?next=%2Fdashboard`, {
      headers: { cookie: `${SESSION_COOKIE}=${sessionToken}` },
    });
    assert.equal(bannedComplete.status, 303);
    assert.equal(
      new URL(bannedComplete.headers.get("location"), ORIGIN).pathname +
        new URL(bannedComplete.headers.get("location"), ORIGIN).search,
      "/entry?error=AccessDenied",
    );
    const bannedApi = await app.request(
      `${ORIGIN}/api/personal/session`,
      { headers: { cookie: `${SESSION_COOKIE}=${sessionToken}` } },
      { DB: h.d1, NEXT_PUBLIC_SITE_URL: ORIGIN },
    );
    assert.equal(bannedApi.status, 403);
  });

  test("U02: zero secrets or internal conflict codes leak in logs or responses", async (t) => {
    const h = createHarness(t);
    const secret = AUTH_BASELINE_ENV.AUTH_SECRET;
    const clientSecret = AUTH_BASELINE_ENV.AUTH_DISCORD_SECRET;
    const accessSecret = "discord-access-secret-token";
    const refreshSecret = "discord-refresh-secret-token";
    const idSecret = "discord-id-secret-token";

    const { logs } = await captureLogs(async () => {
      const mockFetch = createMockDiscordFetch({
        discordId: "discord-log-test-1",
        username: "LogUser",
        email: "loguser@example.com",
      });
      const invoke = async (request) => {
        const config = attachDiscordFetch(buildUnmountedAuthConfig(input(h.d1)), mockFetch);
        return invokeUnmountedAuth(request, config);
      };
      const { cookieHeader } = await startDiscordOAuth(invoke);
      const ok = await invoke(
        new Request(`${ORIGIN}/api/auth/callback/discord?code=log-code-1`, {
          headers: { cookie: cookieHeader },
        }),
      );
      assert.equal(ok.status, 302);
      const badReplay = await invoke(
        new Request(`${ORIGIN}/api/auth/callback/discord?code=log-code-1`),
      );
      assert.equal(badReplay.status, 302);
      const replayLocation = badReplay.headers.get("location") ?? "";
      const replayBody = await badReplay.text();
      for (const forbidden of [secret, clientSecret, accessSecret, refreshSecret, idSecret, "AUTH_DISCORD_ID_CONFLICT"]) {
        assert.equal(replayLocation.includes(forbidden), false, `location leaked ${forbidden}`);
        assert.equal(replayBody.includes(forbidden), false, `body leaked ${forbidden}`);
      }

      const config = buildUnmountedAuthConfig(input(h.d1));
      config.logger.error(
        Object.assign(new Error(`SQL params: ${secret} ${accessSecret}`), {
          type: "CallbackRouteError",
          stack: `Error stack ${clientSecret}`,
        }),
      );
      await assert.rejects(
        config.adapter.linkAccount({
          userId: USERS.noX.id,
          type: "oauth",
          provider: "discord",
          providerAccountId: USERS.valid.discord_id,
          access_token: accessSecret,
          refresh_token: refreshSecret,
          id_token: idSecret,
        }),
        /AUTH_DISCORD_ID_CONFLICT/,
      );
    });

    const combinedLogs = logs.join("\n");
    for (const forbidden of [
      secret,
      clientSecret,
      accessSecret,
      refreshSecret,
      idSecret,
      "discord-log-test-1",
      "loguser@example.com",
      USERS.valid.discord_id,
    ]) {
      assert.equal(combinedLogs.includes(forbidden), false, `log leaked sensitive value: ${forbidden}`);
    }
    assert.match(combinedLogs, /\[auth\]\[error\] CallbackRouteError/);
  });
}
