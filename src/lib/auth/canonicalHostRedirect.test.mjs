import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCanonicalHostRedirect } from "./canonicalHostRedirect.ts";

const configuredOrigin = "https://flamenode.net";

test("www hostを正規originへ308対象として解決する", () => {
  assert.equal(
    resolveCanonicalHostRedirect({
      configuredOrigin,
      forwardedHost: "www.flamenode.net",
      host: "ignored.example.com",
      pathname: "/entry",
      search: "?from=www",
    }),
    "https://flamenode.net/entry?from=www",
  );
});

test("workers.dev hostを正規originへ解決する", () => {
  assert.equal(
    resolveCanonicalHostRedirect({
      configuredOrigin,
      forwardedHost: null,
      host: "flamenode-web.workers.dev",
      pathname: "/api/auth/signin/discord",
      search: "",
    }),
    "https://flamenode.net/api/auth/signin/discord",
  );
});

test("x-forwarded-hostの先頭値だけを使う", () => {
  assert.equal(
    resolveCanonicalHostRedirect({
      configuredOrigin,
      forwardedHost: "www.flamenode.net, flamenode.net",
      host: "flamenode.net",
      pathname: "/entry",
      search: "",
    }),
    "https://flamenode.net/entry",
  );
});

test("正規host・loopback・不正なoriginではリダイレクトしない", () => {
  for (const input of [
    {
      configuredOrigin,
      forwardedHost: null,
      host: "flamenode.net",
      pathname: "/entry",
      search: "",
    },
    {
      configuredOrigin,
      forwardedHost: "localhost:3000",
      host: "localhost:3000",
      pathname: "/entry",
      search: "",
    },
    {
      configuredOrigin: "https://flamenode.net/path",
      forwardedHost: "www.flamenode.net",
      host: "www.flamenode.net",
      pathname: "/entry",
      search: "",
    },
  ]) {
    assert.equal(resolveCanonicalHostRedirect(input), null);
  }
});
