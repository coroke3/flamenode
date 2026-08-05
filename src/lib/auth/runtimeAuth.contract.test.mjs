import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [cloudflare, auth, authRoute, authRouteError, origin, currentUser, session, layoutHeaderUser, requestAuthContext, publicLayout, ...authLayouts] = await Promise.all([
  readFile(new URL("../cloudflare.ts", import.meta.url), "utf8"),
  readFile(new URL("./index.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../app/api/auth/[...nextauth]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("./authRouteError.ts", import.meta.url), "utf8"),
  readFile(new URL("./origin.ts", import.meta.url), "utf8"),
  readFile(new URL("./currentUser.ts", import.meta.url), "utf8"),
  readFile(new URL("./session.ts", import.meta.url), "utf8"),
  readFile(new URL("./layoutHeaderUser.ts", import.meta.url), "utf8"),
  readFile(new URL("./requestAuthContext.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../app/(public)/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../../app/(auth)/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../../app/(manage)/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../../app/(admin)/layout.tsx", import.meta.url), "utf8"),
]);

test("Auth routeは既知のlazy config障害だけをGET/POST共通の503へ変換する", () => {
  assert.match(authRoute, /handleAuthRouteRequest\(handlers\.GET, request\)/);
  assert.match(authRoute, /handleAuthRouteRequest\(handlers\.POST, request\)/);
  assert.doesNotMatch(authRoute, /export const \{ GET, POST \} = handlers/);
  assert.match(authRouteError, /AUTH_SECRET_MISSING/);
  assert.match(authRouteError, /NEXT_PUBLIC_SITE_URL_MISSING/);
  assert.match(authRouteError, /CloudflareBindingsUnavailableError/);
  assert.match(authRouteError, /auth_temporarily_unavailable/);
  assert.match(authRouteError, /status: 503/);
  assert.match(authRouteError, /"Cache-Control": "no-store"/);
  assert.match(authRouteError, /if \(!isAuthRouteTemporarilyUnavailable\(error\)\) throw error/);
});

test("runtime bindingはOpenNext contextを使いPages symbolとrequired型castを残さない", () => {
  assert.match(cloudflare, /from "@opennextjs\/cloudflare"/);
  assert.match(cloudflare, /getCloudflareContext\(\)\.env/);
  assert.match(cloudflare, /getCloudflareContext\(\{ async: true \}\)/);
  assert.doesNotMatch(cloudflare, /__cloudflare-request-context__/);
  assert.doesNotMatch(cloudflare, /as D1Database|as R2Bucket|as KVNamespace/);
  assert.match(cloudflare, /CloudflareBindingsUnavailableError/);
  assert.match(cloudflare, /new WeakMap<D1Database, DB>\(\)/);
  assert.match(cloudflare, /memoizedDbs\.delete\(binding\)/);
});

test("Auth origin・Host・Discord scopeは固定設定をfail-closedで使う", () => {
  assert.doesNotMatch(auth, /process\.env\.(AUTH_URL|NEXTAUTH_URL|AUTH_SECRET)\s*=/);
  assert.match(auth, /configuredHttpOrigin\(env\.AUTH_URL, "AUTH_URL", \{/);
  assert.match(auth, /configuredHttpOrigin\([\s\S]*env\.NEXT_PUBLIC_SITE_URL/);
  assert.match(auth, /AUTH_ORIGIN_MISMATCH/);
  assert.match(auth, /env\.FLAMENODE_LOCAL_PREVIEW === "1"/);
  assert.match(origin, /LOCALHOST_FORBIDDEN/);
  assert.match(auth, /trustHost: true/);
  assert.doesNotMatch(auth, /AUTH_TRUST_HOST/);
  assert.match(auth, /params: \{ scope: "identify email" \}/);
  assert.match(auth, /allowDangerousEmailAccountLinking:\s*true/);
  assert.doesNotMatch(auth, /identify email guilds/);
  assert.doesNotMatch(auth, /redirect\(\{ url, baseUrl \}\)/);
});

test("DBから消失したsession userをsession内roleへfallbackしない", () => {
  assert.match(currentUser, /getAuthSession/);
  assert.match(session, /export const getAuthSession = cache\(loadAuthSession\)/);
  assert.match(layoutHeaderUser, /export const getLayoutHeaderUser = cache/);
  assert.match(currentUser, /if \(loaded\.kind === "missing"\) return null/);
  assert.match(
    currentUser,
    /throw new CurrentUserUnavailableError\("database_unavailable", error\)/,
  );
  assert.doesNotMatch(
    currentUser,
    /if \(loaded\.kind === "missing"\) return fallback/,
  );
});

test("公開layoutはserver authを呼ばず静的シェルとして描画する", () => {
  assert.doesNotMatch(publicLayout, /export const dynamic = "force-dynamic"/);
  assert.doesNotMatch(publicLayout, /getCurrentUser/);
  assert.doesNotMatch(publicLayout, /await auth\(/);
  assert.doesNotMatch(publicLayout, /buildHeaderUser/);
  assert.doesNotMatch(publicLayout, /userNeedsXIdOnboarding/);
  assert.match(publicLayout, /CostGuardBanner/);
  assert.doesNotMatch(publicLayout, /source=["']admin["']/);
  assert.match(publicLayout, /<PublicHeader\s*\/>/);
});

test("認証layoutは動的renderを明示しRequestAuthContextへ集約する", () => {
  assert.match(currentUser, /unstable_rethrow\(error\)/);
  const [authLayout, manageLayout, adminLayout] = authLayouts;
  assert.match(authLayout, /getLayoutAuthSurface|getRequestAuthContext/);
  assert.doesNotMatch(authLayout, /await auth\(/);
  assert.doesNotMatch(authLayout, /await buildHeaderUser/);
  assert.doesNotMatch(authLayout, /await getLayoutHeaderUser/);
  assert.doesNotMatch(authLayout, /await getCurrentUser/);
  assert.match(manageLayout, /getLayoutAuthSurface|getRequestAuthContext/);
  assert.doesNotMatch(manageLayout, /await getLayoutHeaderUser/);
  assert.doesNotMatch(manageLayout, /await getCurrentUser/);
  assert.doesNotMatch(manageLayout, /await userNeedsXIdOnboarding/);
  assert.match(manageLayout, /enrichmentFailed/);
  assert.match(manageLayout, /auth_temporarily_unavailable/);
  assert.match(adminLayout, /getLayoutAuthSurface|getRequestAuthContext/);
  assert.doesNotMatch(adminLayout, /await getLayoutHeaderUser/);
  assert.match(adminLayout, /enrichmentFailed/);
  assert.match(adminLayout, /auth_temporarily_unavailable/);
  assert.match(adminLayout, /<CostGuardBanner source="admin" \/>/);
  assert.doesNotMatch(adminLayout, /await auth\(/);
  assert.doesNotMatch(adminLayout, /await getCurrentUser/);
  for (const layout of authLayouts) {
    assert.match(layout, /export const dynamic = "force-dynamic"/);
    assert.doesNotMatch(layout, /catch \(error\)/);
  }
});

test("RequestAuthContextはenrichment失敗を認可ゲートと分離する", () => {
  assert.match(requestAuthContext, /enrichmentFailed:\s*boolean/);
  assert.match(requestAuthContext, /let enrichmentFailed = false/);
  assert.match(requestAuthContext, /enrichmentFailed = true/);
  assert.match(requestAuthContext, /header_enrichment_failed/);
});
