import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  blockingAdvisories,
  buildProductionVersionMap,
  decodeAuditBody,
  packageNameFromLockPath,
  requestBulkAdvisories,
  validateAuditResponse,
} from "../../scripts/security/audit-production.mjs";

test("derives scoped and nested package names from lock paths", () => {
  assert.equal(packageNameFromLockPath("node_modules/next"), "next");
  assert.equal(packageNameFromLockPath("node_modules/@scope/pkg"), "@scope/pkg");
  assert.equal(packageNameFromLockPath("node_modules/a/node_modules/b"), "b");
  assert.equal(packageNameFromLockPath("node_modules/a", { name: "canonical-a" }), "canonical-a");
  assert.equal(packageNameFromLockPath(""), null);
});

test("builds a sorted production-only version map from lockfile v3", () => {
  const map = buildProductionVersionMap({
    lockfileVersion: 3,
    packages: {
      "": { name: "root", version: "1.0.0" },
      "node_modules/a": { version: "2.0.0" },
      "node_modules/a/node_modules/b": { version: "3.0.0" },
      "node_modules/another-b": { name: "b", version: "4.0.0" },
      "node_modules/dev-only": { version: "1.0.0", dev: true },
      // npm documents devOptional as also reachable through an optional
      // dependency of a non-development dependency, so it remains production.
      "node_modules/dev-optional": { version: "1.0.0", devOptional: true },
      "node_modules/optional-prod": { version: "5.0.0", optional: true },
      "node_modules/link": { link: true },
    },
  });

  assert.deepEqual(map, {
    a: ["2.0.0"],
    b: ["3.0.0", "4.0.0"],
    "dev-optional": ["1.0.0"],
    "optional-prod": ["5.0.0"],
  });
});

test("rejects unsupported or empty lockfiles", () => {
  assert.throws(() => buildProductionVersionMap({ lockfileVersion: 2, packages: {} }), /Unsupported/);
  assert.throws(() => buildProductionVersionMap({ lockfileVersion: 3, packages: {} }), /No production/);
});

test("decodes plain and gzip audit responses", () => {
  assert.equal(decodeAuditBody(Buffer.from('{"ok":true}')), '{"ok":true}');
  assert.equal(decodeAuditBody(gzipSync(Buffer.from('{"ok":true}'))), '{"ok":true}');
});

test("validates and classifies advisory severities", () => {
  const advisories = validateAuditResponse({
    next: [
      {
        id: 1,
        title: "Example high advisory",
        severity: "high",
        vulnerable_versions: "<15.5.21",
        url: "https://example.invalid/advisory",
      },
    ],
    zod: [
      {
        id: 2,
        title: "Example moderate advisory",
        severity: "moderate",
        vulnerable_versions: "<4",
      },
    ],
  });
  assert.equal(advisories.length, 2);
  assert.deepEqual(blockingAdvisories(advisories).map((item) => item.packageName), ["next"]);
});

test("requests and parses gzip-compressed bulk responses", async () => {
  const responseBody = gzipSync(Buffer.from(JSON.stringify({
    next: [{ id: 3, title: "Patched test", severity: "critical", vulnerable_versions: "<99" }],
  })));
  let capturedRequest;
  const fetchImpl = async (url, init) => {
    capturedRequest = { url, init };
    return new Response(responseBody, { status: 200, headers: { "content-type": "application/json" } });
  };

  const advisories = await requestBulkAdvisories({ next: ["15.5.20"] }, {
    endpoint: "https://registry.example.invalid/bulk",
    fetchImpl,
  });
  assert.equal(capturedRequest.url, "https://registry.example.invalid/bulk");
  assert.equal(capturedRequest.init.method, "POST");
  assert.equal(capturedRequest.init.headers["accept-encoding"], "identity");
  assert.equal(advisories[0].severity, "critical");
});

test("fails closed on HTTP, malformed JSON, and invalid response schemas", async () => {
  await assert.rejects(
    requestBulkAdvisories({ a: ["1.0.0"] }, {
      fetchImpl: async () => new Response("registry unavailable", { status: 503 }),
    }),
    /HTTP 503/,
  );
  await assert.rejects(
    requestBulkAdvisories({ a: ["1.0.0"] }, {
      fetchImpl: async () => new Response("not-json", { status: 200 }),
    }),
    /invalid JSON/,
  );
  await assert.rejects(
    requestBulkAdvisories({ a: ["1.0.0"] }, {
      fetchImpl: async () => new Response(JSON.stringify({ a: {} }), { status: 200 }),
    }),
    /must be an array/,
  );
});
