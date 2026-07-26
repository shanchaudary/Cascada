#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

export const DEFAULT_AUDIT_ENDPOINT =
  "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);
const MAX_ERROR_BODY = 1_500;

export function packageNameFromLockPath(path, entry = {}) {
  if (typeof entry.name === "string" && entry.name.trim()) return entry.name.trim();
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  if (index < 0) return null;
  const remainder = path.slice(index + marker.length);
  const parts = remainder.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  return parts[0].startsWith("@") && parts.length >= 2
    ? `${parts[0]}/${parts[1]}`
    : parts[0];
}

export function buildProductionVersionMap(lockfile) {
  if (!lockfile || typeof lockfile !== "object") {
    throw new Error("package-lock.json must contain a JSON object");
  }
  if (lockfile.lockfileVersion !== 3) {
    throw new Error(`Unsupported package-lock version: ${lockfile.lockfileVersion ?? "missing"}`);
  }
  if (!lockfile.packages || typeof lockfile.packages !== "object" || Array.isArray(lockfile.packages)) {
    throw new Error("package-lock.json is missing the lockfile v3 packages map");
  }

  const versions = new Map();
  for (const [path, entry] of Object.entries(lockfile.packages)) {
    if (!path || !entry || typeof entry !== "object") continue;
    if (entry.dev === true || entry.devOptional === true) continue;
    if (typeof entry.version !== "string" || entry.version.length === 0) continue;
    const name = packageNameFromLockPath(path, entry);
    if (!name) continue;
    if (!versions.has(name)) versions.set(name, new Set());
    versions.get(name).add(entry.version);
  }

  const payload = {};
  for (const name of [...versions.keys()].sort()) {
    payload[name] = [...versions.get(name)].sort();
  }
  if (Object.keys(payload).length === 0) {
    throw new Error("No production package versions were found in package-lock.json");
  }
  return payload;
}

export function decodeAuditBody(bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const decoded = body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b
    ? gunzipSync(body)
    : body;
  return decoded.toString("utf8");
}

export function validateAuditResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("npm Bulk Advisory response must be an object");
  }

  const advisories = [];
  for (const [packageName, packageAdvisories] of Object.entries(value)) {
    if (!Array.isArray(packageAdvisories)) {
      throw new Error(`npm Bulk Advisory response for ${packageName} must be an array`);
    }
    for (const advisory of packageAdvisories) {
      if (!advisory || typeof advisory !== "object" || Array.isArray(advisory)) {
        throw new Error(`npm advisory for ${packageName} must be an object`);
      }
      const severity = String(advisory.severity ?? "").toLowerCase();
      if (!severity) throw new Error(`npm advisory for ${packageName} is missing severity`);
      advisories.push({
        packageName,
        id: advisory.id ?? "unknown",
        title: String(advisory.title ?? "Untitled advisory"),
        severity,
        vulnerableVersions: String(advisory.vulnerable_versions ?? "unknown"),
        url: typeof advisory.url === "string" ? advisory.url : null,
      });
    }
  }
  return advisories;
}

export async function requestBulkAdvisories(
  versionMap,
  { endpoint = DEFAULT_AUDIT_ENDPOINT, fetchImpl = globalThis.fetch } = {},
) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "accept-encoding": "identity",
        "content-type": "application/json",
        "user-agent": "cascada-production-advisory-gate/1",
      },
      body: JSON.stringify(versionMap),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(`npm Bulk Advisory request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const raw = Buffer.from(await response.arrayBuffer());
  let text;
  try {
    text = decodeAuditBody(raw);
  } catch (error) {
    throw new Error(`npm Bulk Advisory response decompression failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    throw new Error(`npm Bulk Advisory returned HTTP ${response.status}: ${text.slice(0, MAX_ERROR_BODY)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`npm Bulk Advisory returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateAuditResponse(parsed);
}

export function blockingAdvisories(advisories) {
  return advisories.filter((advisory) => BLOCKING_SEVERITIES.has(advisory.severity));
}

export async function auditProductionDependencies({
  lockPath = "package-lock.json",
  endpoint = DEFAULT_AUDIT_ENDPOINT,
  fetchImpl = globalThis.fetch,
} = {}) {
  const lockfile = JSON.parse(await readFile(lockPath, "utf8"));
  const versionMap = buildProductionVersionMap(lockfile);
  const advisories = await requestBulkAdvisories(versionMap, { endpoint, fetchImpl });
  return {
    packageCount: Object.keys(versionMap).length,
    advisories,
    blocking: blockingAdvisories(advisories),
  };
}

function printReport(result) {
  process.stdout.write(`Audited ${result.packageCount} production packages through npm Bulk Advisory.\n`);
  process.stdout.write(`Returned advisories: ${result.advisories.length}; HIGH/CRITICAL: ${result.blocking.length}.\n`);
  for (const advisory of result.advisories) {
    const suffix = advisory.url ? ` ${advisory.url}` : "";
    process.stdout.write(
      `[${advisory.severity.toUpperCase()}] ${advisory.packageName}: ${advisory.title} ` +
      `(affected ${advisory.vulnerableVersions})${suffix}\n`,
    );
  }
}

async function main() {
  const result = await auditProductionDependencies();
  printReport(result);
  if (result.blocking.length > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`Production advisory gate failed closed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
