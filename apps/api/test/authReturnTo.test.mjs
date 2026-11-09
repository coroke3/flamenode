import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeAuthReturnTo,sanitizePostAuthReturnTo,
  authCompleteHref,entryAuthRedirectHref,
} from "../src/auth/returnTo.ts";

test("MIG-0802 U04: safe relative return-to preserves CURRENT URLs",()=>{
  for(const path of ["/","/manage/events?tab=1","/dashboard#activity","/entry/slotted?slot=abc","/x?next=%2Fdashboard"]){
    assert.equal(sanitizeAuthReturnTo(path),path);
  }
  assert.equal(sanitizeAuthReturnTo(null),"/dashboard");
  assert.equal(sanitizeAuthReturnTo(undefined,"/entry"),"/entry");
  assert.equal(sanitizeAuthReturnTo(" /dashboard?x=1 "),"/dashboard?x=1");
});
test("MIG-0802 U04: unsafe redirect targets fail closed",()=>{
  const hostile=["https://evil.example/x","javascript:alert(1)","//evil.example/x",
    "/\\evil.example","/path\\name","relative","", "/a\nSet-Cookie: evil=1",
    "/"+ "a".repeat(512),"/?x=https://evil.example", "/\u007Fpath"];
  for(const url of hostile){
    if(url==="/?x=https://evil.example"){
      // CURRENT rejects literal :// even inside a query string, preserve the quirk.
      assert.equal(sanitizeAuthReturnTo(url),"/dashboard");
    }else assert.equal(sanitizeAuthReturnTo(url),"/dashboard",JSON.stringify(url));
  }
});
test("MIG-0802 U03/U04: OAuth completion blocks nested callback and onboarding loops only",()=>{
  for(const path of ["/api/auth","/api/auth/callback/discord","/auth/complete",
    "/auth/complete/subroute","/onboarding","/rules?next=%2Fadmin"]){
    assert.equal(sanitizePostAuthReturnTo(path),"/dashboard");
  }
  assert.equal(sanitizePostAuthReturnTo("/ruleset"),"/ruleset");
  assert.equal(sanitizePostAuthReturnTo("/api/authentic"),"/api/authentic");
  assert.equal(sanitizePostAuthReturnTo("/dashboard?tab=1"),"/dashboard?tab=1");
  assert.equal(sanitizePostAuthReturnTo("/onboarding","/entry"),"/entry");
});
test("MIG-0802 U04: OAuth completion normalizes encoded and traversed blocked paths", () => {
  for (const path of [
    "/%61pi/auth/callback/discord",
    "/api%2fauth/callback",
    "/%2561pi/auth",
    "/%25252561pi/auth",
    "/%2525252f%2525252fevil.example/",
    "/auth/%63omplete?next=%2Fadmin",
    "/%6fnboarding",
    "/%72ules",
    "/foo/../api/auth",
    "/foo/%2e%2e/auth/complete",
    "/%252e%252e/onboarding",
    "/%2f%2fevil.example/",
    "/%ZZinvalid-escape",
    "/%00api/auth",
  ]) {
    assert.equal(sanitizePostAuthReturnTo(path), "/dashboard", path);
    assert.equal(authCompleteHref(path), "/auth/complete?next=%2Fdashboard", path);
  }
  for (const path of [
    "/dashboard?next=%2Fapi%2Fauth",
    "/ruleset",
    "/api/authentic",
    "/profile/%E3%81%82?tab=1",
  ]) {
    assert.equal(sanitizePostAuthReturnTo(path), path, path);
  }
  assert.equal(sanitizePostAuthReturnTo("/foo/../api/auth", "/entry"), "/entry");
});

test("MIG-0802 U04: redirect landing uses exactly one encoded query parameter",()=>{
  assert.equal(authCompleteHref("/dashboard?tab=1"),"/auth/complete?next=%2Fdashboard%3Ftab%3D1");
  assert.equal(authCompleteHref("https://evil.example/"),"/auth/complete?next=%2Fdashboard");
  assert.equal(entryAuthRedirectHref(null),"/auth/complete?next=%2Fentry");
  assert.equal(entryAuthRedirectHref("/manage/events"),"/auth/complete?next=%2Fmanage%2Fevents");
  assert.equal(entryAuthRedirectHref("//evil.example"),"/auth/complete?next=%2Fentry");
});
