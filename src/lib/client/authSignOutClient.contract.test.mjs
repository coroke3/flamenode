import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const authSignOutClient = await readFile(
  new URL("./authSignOutClient.ts", import.meta.url),
  "utf8",
);

test("signOutViaAuthRouteはcsrf取得後にAuth.js signoutへPOSTする", () => {
  assert.match(authSignOutClient, /\/api\/auth\/csrf/);
  assert.match(authSignOutClient, /credentials: "same-origin"/);
  assert.match(authSignOutClient, /cache: "no-store"/);
  assert.match(authSignOutClient, /csrfToken/);
  assert.match(authSignOutClient, /typeof csrfToken !== "string"/);
  assert.match(authSignOutClient, /\/api\/auth\/signout/);
  assert.match(authSignOutClient, /method: "POST"/);
  assert.match(
    authSignOutClient,
    /"Content-Type": "application\/x-www-form-urlencoded"/,
  );
  assert.match(authSignOutClient, /"X-Auth-Return-Redirect": "1"/);
  assert.match(authSignOutClient, /callbackUrl: "\/"/);
  assert.match(authSignOutClient, /\/api\/auth\/session/);
  assert.match(authSignOutClient, /AUTH_SIGNOUT_COOKIE_REMAINED/);
  assert.match(authSignOutClient, /return \{ ok: true \}/);
  assert.match(authSignOutClient, /ok: false/);
  assert.doesNotMatch(authSignOutClient, /method: "GET"/);
});

test("signOutViaAuthRouteは失敗時に内部情報を返さない", () => {
  assert.match(authSignOutClient, /SIGN_OUT_ERROR_MESSAGE/);
  assert.match(
    authSignOutClient,
    /ログアウトに失敗しました。再読み込みしてもう一度お試しください。/,
  );
  assert.match(authSignOutClient, /message: SIGN_OUT_ERROR_MESSAGE/);
  assert.doesNotMatch(authSignOutClient, /error\.message/);
  assert.doesNotMatch(authSignOutClient, /console\.error/);
});

test("signOutViaAuthRouteはclient flowTraceを記録する", () => {
  assert.match(authSignOutClient, /kind:\s*"flow_trace"/);
  assert.match(authSignOutClient, /phase:\s*"signout_started"/);
  assert.match(authSignOutClient, /phase:\s*"signout_completed"/);
  assert.match(authSignOutClient, /flow:\s*"discord_auth"/);
  assert.match(authSignOutClient, /AUTH_SIGNOUT_FAILED/);
  assert.match(authSignOutClient, /AUTH_SIGNOUT_COOKIE_REMAINED/);
  assert.doesNotMatch(authSignOutClient, /@\/lib\/observability\/flowTrace/);
});
