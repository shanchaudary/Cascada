#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const FORBIDDEN_WORKFLOW_PATTERNS = [
  {
    pattern: /openai\/codex-action/i,
    reason: "GitHub-hosted Codex Action uses API-backed authentication",
  },
  {
    pattern: /OPENAI_API_KEY/,
    reason: "software-development workflows must not receive an OpenAI API key",
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

async function workflowFiles(root) {
  const directory = join(root, ".github", "workflows");
  if (!(await exists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => join(directory, entry.name))
    .sort();
}

export async function inspectCodexSubscriptionBoundary(root = process.cwd()) {
  const findings = [];

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
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of FORBIDDEN_WORKFLOW_PATTERNS) {
        if (rule.pattern.test(line)) {
          findings.push({
            file: relative(root, path).replaceAll("\\", "/"),
            line: index + 1,
            reason: rule.reason,
          });
        }
      }
    });
  }

  return findings;
}

async function main() {
  const findings = await inspectCodexSubscriptionBoundary();
  if (findings.length === 0) {
    process.stdout.write("Codex subscription boundary passed: no API-backed development workflow is active.\n");
    return;
  }

  process.stderr.write("Codex subscription boundary failed closed.\n");
  for (const finding of findings) {
    const location = finding.line == null ? finding.file : `${finding.file}:${finding.line}`;
    process.stderr.write(`- ${location}: ${finding.reason}\n`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`Codex subscription boundary failed closed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
