import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const loaderSource = await readFile(new URL("./loader.ts", import.meta.url), "utf8");
const probeSource = await readFile(new URL("./publicStaticTargetProbe.ts", import.meta.url), "utf8");

function extractDiagnosticBody(name) {
  const start = loaderSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const bodyStart = loaderSource.indexOf("): void {", start);
  assert.ok(bodyStart > start, `${name} must be a void diagnostic helper`);
  const end = loaderSource.indexOf("\n}\n", bodyStart);
  assert.ok(end > bodyStart, `${name} must have a complete body`);
  return loaderSource.slice(bodyStart + "): void {".length, end);
}

function invokeDiagnostic(name, names, args, warn) {
  // Execute the actual source-defined body without importing Next/server-only.
  // Supply the original Error constructor so instanceof Error would detect
  // a poison Error and incorrectly read its throwing name getter.
  const body = extractDiagnosticBody(name);
  const fn = runInNewContext(`(function(${names.join(",")}) {${body}\n})`, {
    Error,
    JSON,
    console: { warn },
  });
  return fn(...args);
}

function poisonedProviderError() {
  const error = new Error("SEC757_PROVIDER_SECRET");
  Object.defineProperty(error, "name", {
    get() { throw new Error("SEC757_THROWING_NAME_GETTER"); },
  });
  return error;
}

test("SEC-757: visibility enforce diagnostic cannot read provider error or throw with logger", () => {
  const warnings = [];
  const invoke = (warn) => invokeDiagnostic(
    "warnPublicVisibilityManifestFailure",
    ["mode", "_error"],
    ["enforce", poisonedProviderError()],
    warn,
  );
  assert.doesNotThrow(() => invoke((line) => warnings.push(JSON.parse(line))));
  assert.deepEqual(warnings, [{
    service: "public-visibility-guard",
    mode: "enforce",
    result: "manifest_read_failed",
  }]);
  assert.doesNotThrow(() => invoke(() => { throw new Error("SEC757_SINK_SECRET"); }));
});

test("SEC-757: public R2 miss diagnostic is fixed, bounded and logger-fail-soft", () => {
  const warnings = [];
  const invoke = (warn) => invokeDiagnostic(
    "warnPublicStaticJson",
    ["key", "result", "_error"],
    ["events/demo.json", "read_failed", poisonedProviderError()],
    warn,
  );
  assert.doesNotThrow(() => invoke((line) => warnings.push(JSON.parse(line))));
  assert.deepEqual(warnings, [{
    service: "public-static-json",
    object_key: "events/demo.json",
    result: "read_failed",
  }]);
  assert.doesNotThrow(() => invoke(() => { throw new Error("SEC757_SINK_SECRET"); }));
  const longKeys = [];
  invokeDiagnostic(
    "warnPublicStaticJson",
    ["key", "result", "_error"],
    ["x".repeat(600), "invalid_json", poisonedProviderError()],
    (line) => longKeys.push(JSON.parse(line)),
  );
  assert.equal(longKeys[0].object_key.length, 240, "diagnostic key remains bounded");
});

test("SEC-757: loader probe catch retains fixed unknown instead of provider Error.name", () => {
  const start = loaderSource.indexOf("    } catch (error) {\n      warnPublicStaticJson(options.targetType, \"target_probe_failed\", error);");
  const end = loaderSource.indexOf("\n    }\n\n    if (probe.state", start);
  assert.ok(start >= 0 && end > start, "real target probe catch is present");
  const catchBlock = loaderSource.slice(start, end + "\n    }".length);
  const result = runInNewContext(`(function() {
    let probe = null;
    const options = { targetType: "event" };
    try { throw error;
    ${catchBlock}
    return probe;
  })()`, {
    error: poisonedProviderError(),
    Error,
    warnPublicStaticJson: () => {},
  });
  assert.equal(result.state, "unknown");
  assert.equal(result.errorCode, "public_target_probe_failed");
});

test("SEC-757: DB target-probe catch returns fixed unknown for poisoned provider errors", () => {
  // The runtime source imports extensionless TS dependencies and is bundled
  // by Next; node --experimental-strip-types alone cannot resolve those.
  // Execute the real catch body in isolation without changing production imports.
  const start = probeSource.lastIndexOf("  } catch {");
  const end = probeSource.indexOf("\n  }\n}", start);
  assert.ok(start >= 0 && end > start, "real DB error catch is present");
  const catchBlock = probeSource.slice(start, end + "\n  }".length);
  const result = runInNewContext(`(function() {
    try { throw provider;
    ${catchBlock}
  })()`, {
    provider: poisonedProviderError(),
    Error,
  });
  assert.equal(result.state, "unknown");
  assert.equal(result.errorCode, "public_target_probe_failed");
  assert.doesNotMatch(probeSource, /error\s+instanceof\s+Error\s*\?\s*error\.name/);
});
