#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ALWAYS_FORBIDDEN_WORKFLOW_PATTERNS = [
  {
    pattern: /OPENAI_API_KEY/i,
    reason:
      "GitHub workflows may not reference OPENAI_API_KEY in any letter case; product-runtime credentials belong in the application hosting boundary",
  },
  {
    pattern: /(?:^|[,{])\s*["']?secrets["']?\s*:/i,
    reason:
      "GitHub workflows may not declare reusable-workflow secrets or secret inheritance",
  },
  {
    pattern: /^\s*\?\s*["']?secrets["']?\s*(?:#.*)?$/i,
    reason:
      "GitHub workflows may not use an explicit YAML key for reusable-workflow secrets",
  },
  {
    pattern:
      /(?:^|[\s:,\[{])(?:&|\*)[A-Za-z_][A-Za-z0-9_-]*(?=$|[\s,}\]])/,
    reason:
      "GitHub workflows may not use YAML anchors or aliases because they can obscure secret inheritance and authority",
  },
  {
    pattern: /openai\/codex-action/i,
    reason: "GitHub-hosted Codex Action uses API-backed authentication",
  },
  {
    pattern: /openai-api-key\s*:/i,
    reason: "software-development workflows must not pass an OpenAI API key input",
  },
  {
    pattern: /@openai\/codex/i,
    reason: "GitHub workflows may not install or execute the API-backed Codex package",
  },
  {
    pattern: /\bcodex\s+exec\b/i,
    reason: "GitHub workflows may not invoke Codex CLI execution",
  },
  {
    pattern:
      /shans-ai-software-factory\/\.github\/workflows\/reusable-(?:implement|supervise)\.yml/i,
    reason: "retired API-backed implementation/supervision factory is referenced",
  },
];

const NORMALIZED_FORBIDDEN_WORKFLOW_PATTERNS = [
  {
    pattern: /\$\{\{secrets(?:\.|\[)/i,
    reason:
      "GitHub workflows may not read repository secrets; software-development and product-runtime credentials belong outside GitHub Actions",
  },
  {
    pattern: /api\.openai\.com/i,
    reason:
      "GitHub workflows may not call the OpenAI API directly for software-development work",
  },
];

const RETIRED_FILES = [
  ".github/workflows/ai-implement.yml",
  ".github/workflows/ai-supervise.yml",
  ".ai-factory/project.json",
  ".github/codex-product-runtime-workflows.json",
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
  const index = lines.findIndex((line) => {
    if (/^\s*#/.test(line)) return false;
    return pattern.test(line);
  });
  return index < 0 ? null : index + 1;
}

function normalizedWorkflowText(content) {
  return content
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join("")
    .replace(/\s+/g, "");
}

function inspectWorkflow(path, content) {
  const findings = [];
  const normalizedPath = path.replaceAll("\\", "/");

  for (const rule of ALWAYS_FORBIDDEN_WORKFLOW_PATTERNS) {
    const line = lineNumberFor(content, rule.pattern);
    if (line != null) {
      findings.push({ file: normalizedPath, line, reason: rule.reason });
    }
  }

  const normalizedContent = normalizedWorkflowText(content);
  for (const rule of NORMALIZED_FORBIDDEN_WORKFLOW_PATTERNS) {
    if (rule.pattern.test(normalizedContent)) {
      findings.push({ file: normalizedPath, line: null, reason: rule.reason });
    }
  }

  return findings;
}

export async function inspectCodexSubscriptionBoundary(root = process.cwd()) {
  const findings = [];

  for (const retired of RETIRED_FILES) {
    const path = join(root, retired);
    if (await exists(path)) {
      findings.push({
        file: retired,
        line: null,
        reason: "retired or superseded API-backed Codex delivery file exists",
      });
    }
  }

  for (const path of await workflowFiles(root)) {
    const content = await readFile(path, "utf8");
    findings.push(...inspectWorkflow(relative(root, path), content));
  }

  return findings;
}

async function main() {
  const findings = await inspectCodexSubscriptionBoundary();
  if (findings.length === 0) {
    process.stdout.write(
      "Codex subscription boundary passed: GitHub workflows contain no development-agent API path or repository-secret access.\n",
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
