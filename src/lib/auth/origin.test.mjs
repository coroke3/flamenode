import assert from "node:assert/strict";
import { test } from "node:test";
import {
  configuredHttpOrigin,
  isLoopbackHostname,
  requestHasSameOrigin,
} from "./origin.ts";

test("configured origin is canonical and rejects ambiguous URL forms", () => {
  assert.equal(
    configuredHttpOrigin("https://Example.com:443/", "SITE"),
    "https://example.com",
  );
  for (const value of [
    "",
    "ftp://example.com",
    "https://user@example.com",
    "https://example.com/path",
    "https://example.com/?query=1",
    "https://example.com/#hash",
  ]) {
    assert.throws(() => configuredHttpOrigin(value, "SITE"));
  }
});

test("loopback requires an explicit local-preview allowance", () => {
  for (const hostname of ["localhost", "localhost.", "127.0.0.1", "127.0.0.2", "127.255.255.254", "[::1]"]) {
    assert.equal(isLoopbackHostname(hostname), true);
  }
  assert.equal(isLoopbackHostname("127.evil.example"), false);
  for (const host of ["127.0.0.2", "127.255.255.254", "localhost."]) {
    assert.throws(() => configuredHttpOrigin(`http://${host}:3000`, "SITE"), /SITE_LOCALHOST_FORBIDDEN/, host);
  }
  assert.throws(
    () => configuredHttpOrigin("http://localhost:3000", "SITE"),
    /SITE_LOCALHOST_FORBIDDEN/,
  );
  assert.equal(
    configuredHttpOrigin("http://localhost:3000", "SITE", {
      allowLoopback: true,
    }),
    "http://localhost:3000",
  );
});

test("write request origin must match scheme, host, and port", () => {
  const configured = "https://flamenode.example.com";
  assert.equal(requestHasSameOrigin(configured, configured), true);
  assert.equal(requestHasSameOrigin(`${configured}/`, configured), true);
  assert.equal(requestHasSameOrigin(null, configured), false);
  assert.equal(requestHasSameOrigin("null", configured), false);
  assert.equal(requestHasSameOrigin("http://flamenode.example.com", configured), false);
  assert.equal(requestHasSameOrigin("https://flamenode.example.com:444", configured), false);
  assert.equal(requestHasSameOrigin("https://evil.example.com", configured), false);
  assert.equal(requestHasSameOrigin("https://flamenode.example.com/path", configured), false);
});
