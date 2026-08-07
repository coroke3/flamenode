import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [authIndex, authRouteError, accountLinkAdapter, authCompletePage, authSignOutClient] =
  await Promise.all([
    readFile(new URL("./index.ts", import.meta.url), "utf8"),
    readFile(new URL("./authRouteError.ts", import.meta.url), "utf8"),
    readFile(new URL("./accountLinkAdapter.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../../app/(auth-complete)/auth/complete/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../client/authSignOutClient.ts", import.meta.url), "utf8"),
  ]);

test("discord_auth flowTrace phases are wired across auth entry points", () => {
  assert.match(authRouteError, /oauth_callback_started/);
  assert.match(authRouteError, /signout_started/);
  assert.match(authRouteError, /flow:\s*"discord_auth"/);

  assert.match(authIndex, /phase:\s*"user_created"/);
  assert.match(authIndex, /phase:\s*"session_created"/);
  assert.match(authIndex, /phase:\s*"signout_completed"/);
  assert.match(authIndex, /logFlowTrace/);

  assert.match(accountLinkAdapter, /phase:\s*"account_link_started"/);
  assert.match(accountLinkAdapter, /phase:\s*"account_link_committed"/);
  assert.match(accountLinkAdapter, /notification_post_commit_failed/);

  assert.match(authCompletePage, /phase:\s*"auth_complete_rendered"/);

  assert.match(authSignOutClient, /phase:\s*"signout_started"/);
  assert.match(authSignOutClient, /kind:\s*"flow_trace"/);
});

test("auth route entry logging does not reference query secrets", () => {
  assert.doesNotMatch(authRouteError, /access_token|searchParams\.get/);
  assert.match(authRouteError, /searchParams\.has\("code"\)/);
});

test("oauth_callback_startedはGETかつcode付きcallbackのみ記録する", () => {
  assert.match(authRouteError, /oauth_callback_started/);
  assert.match(authRouteError, /oauth_callback_denied/);
  assert.match(authRouteError, /request\.method === "GET"/);
  assert.match(authRouteError, /pathname\.includes\("\/api\/auth\/callback"\)/);
  assert.doesNotMatch(authRouteError, /endsWith\("callback\/discord"\)/);
});

test("adapter wrappers guard optional drizzle methods", () => {
  assert.match(authIndex, /drizzleAdapter\.createUser/);
  assert.match(authIndex, /drizzleAdapter\.createSession/);
  assert.match(authIndex, /drizzleAdapter\.deleteSession/);
});
