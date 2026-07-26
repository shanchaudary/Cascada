#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const PRODUCT_RUNTIME_ALLOWLIST_PATH =
  ".github/codex-product-runtime-workflows.json";

const ALWAYS_FORBIDDEN_WORKFLOW_PATTERNS = [
  {
    pattern: /openai\/codex-action/i,
    reason: "GitHub-hosted Codex Action uses API-backed authentication",
  },
  {
    pattern: /openai-api-key\s*:/i,
    reason: "software-development workflows must not pass an OpenAI API key input",
  },
  {
    pattern: /shans-ai-software-factory\/\.github\/workflows\/reusable-(?:implement|supervise)\.yml/i,
    reason: "retired API-backed implementation/supervision factory is referenced",
  },
];

const DEVELOPMENT_AGENT_INDICATORS = [
  /\bcodex\b/i,
  /\bai[- ]factory\b/i,
  /\bsoftware[- ]development[- ]agent\b/i,
  /reusable-(?:implement|supervise)\.yml/i,
];

const DEVELOPMENT_WRITE_PERMISSIONS = [
  /^\s*actions:\s*write\s*$/im,
  /^\s*contents:\s*write\s*$/im,
  /^\s*issues:\s*write\s*$/im,
  /^\s*pull-requests:\s*write\s*$/im,
  /^\s*statuses:\s*write\s*$/im,
];

const RETIRED_FILES = [
  ".github/workflows/ai-implement.yml",
  ".github/workflows/ai-supervise.yml",
  ".ai-factory/project.json",
];

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function normalizeRepositoryPath(path) {
  return path.replaceAll("\\", "/");
}

function validateAllowlistedWorkflowPath(path, index) {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(`allowed_workflows[${index}] must be a non-empty string`);
  }
  const normalized = normalizeRepositoryPath(path);
  if (
    normalized !== path ||
    !/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/.test(normalized) ||
    normalized.includes("..")
  ) {
    throw new Error(
      `allowed_workflows[${index}] must be an exact .github/workflows/*.yml or *.yaml path`,
    );
  }
  if (RETIRED_FILES.includes(normalized)) {
    throw new Error(`allowed_workflows[${index}] may not allowlist a retired factory file`);
  }
  return normalized;
}

export async function loadProductRuntimeWorkflowAllowlist(root = process.cwd()) {
  const path = join(root, PRODUCT_RUNTIME_ALLOWLIST_PATH);
  let raw;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read required ${PRODUCT_RUNTIME_ALLOWLIST_PATH}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${PRODUCT_RUNTIME_ALLOWLIST_PATH} must contain a JSON object`);
  }
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== "allowed_workflows") {
    throw new Error(
      `${PRODUCT_RUNTIME_ALLOWLIST_PATH} must contain only allowed_workflows`,
    );
  }
  if (!Array.isArray(raw.allowed_workflows)) {
    throw new Error("allowed_workflows must be an array");
  }

  const paths = raw.allowed_workflows.map(validateAllowlistedWorkflowPath);
  if (new Set(paths).size !== paths.length) {
    throw new Error("allowed_workflows must not contain duplicates");
  }
  return new Set(paths);
}

async function workflowFiles(root) {
  const directory = join(root, ".github", "workflows");
  if (!(await exists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => join(directory, entry.name))
    .sort();
}

function lineNumberFor(content, pattern) {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => pattern.test(line));
  return index < 0 ? null : index + 1;
}

function isDevelopmentAgentWorkflow(path, content) {
  return DEVELOPMENT_AGENT_INDICATORS.some(
    (pattern) => pattern.test(path) || pattern.test(content),
  );
}

function inspectWorkflow(path, content, allowedProductRuntimeWorkflows) {
  const findings = [];
  const normalized = normalizeRepositoryPath(path);

  for (const rule of ALWAYS_FORBIDDEN_WORKFLOW_PATTERNS) {
    const line = lineNumberFor(content, rule.pattern);
    if (line != null) findings.push({ file: normalized, line, reason: rule.reason });
  }

  if (!/OPENAI_API_KEY/.test(content)) return findings;

  const keyLine = lineNumberFor(content, /OPENAI_API_KEY/);
  const isAgentWorkflow = isDevelopmentAgentWorkflow(normalized, content);
  const isAllowlisted = allowedProductRuntimeWorkflows.has(normalized);

  if (isAgentWorkflow) {
    findings.push({
      file: normalized,
      line: keyLine,
      reason: "software-development workflows must not receive an OpenAI API key",
    });
  } else if (!isAllowlisted) {
    findings.push({
      file: normalized,
      line: keyLine,
      reason:
        `workflow OPENAI_API_KEY usage is not externally allowlisted in ${PRODUCT_RUNTIME_ALLOWLIST_PATH}`,
    });
  }

  if (isAllowlisted) {
    for (const pattern of DEVELOPMENT_WRITE_PERMISSIONS) {
      const line = lineNumberFor(content, pattern);
      if (line != null) {
        findings.push({
          file: normalized,
          line,
          reason:
            "allowlisted product-runtime workflow may not receive GitHub development write authority",
        });
      }
    }
  }

  return findings;
}

export async function inspectCodexSubscriptionBoundary(root = process.cwd()) {
  const findings = [];
  const allowedProductRuntimeWorkflows =
    await loadProductRuntimeWorkflowAllowlist(root);

  for (const retired of RETIRED_FILES) {
    const path = join(root, retired);
    if (await exists(path)) {
      findings.push({
        file: retired,
        line: null,
        reason: "retired API-backed Codex delivery file exists",
      });
    }
  }

  for (const path of await workflowFiles(root)) {
    const content = await readFile(path, "utf8");
    findings.push(
      ...inspectWorkflow(
        relative(root, path),
        content,
        allowedProductRuntimeWorkflows,
      ),
    );
  }

  return findings;
}

async function main() {
  const findings = await inspectCodexSubscriptionBoundary();
  if (findings.length === 0) {
    process.stdout.write(
      "Codex subscription boundary passed: no API-backed development workflow is active.\n",
    );
    return;
  }

  process.stderr.write("Codex subscription boundary failed closed.\n");
  for (const finding of findings) {
    const location =
      finding.line == null ? finding.file : `${finding.file}:${finding.line}`;
    process.stderr.write(`- ${location}: ${finding.reason}\n`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(
      `Codex subscription boundary failed closed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  });
}
