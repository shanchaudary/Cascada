import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inspectCodexSubscriptionBoundary } from "../../scripts/security/verify-codex-subscription-boundary.mjs";

async function writeWorkflow(root, name, lines) {
  await writeFile(
    join(root, ".github", "workflows", name),
    Array.isArray(lines) ? lines.join("\n") : lines,
  );
}

async function withRepository(run) {
  const root = await mkdtemp(join(tmpdir(), "cascada-codex-boundary-"));
  try {
    await mkdir(join(root, ".github", "workflows"), { recursive: true });
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("accepts ordinary CI workflows without OpenAI development credentials", async () => {
  await withRepository(async (root) => {
    await writeWorkflow(
      root,
      "ci.yml",
      "name: CI\non: [pull_request]\njobs:\n  verify:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm test\n",
    );

    assert.deepEqual(await inspectCodexSubscriptionBoundary(root), []);
  });
});

test("rejects OPENAI_API_KEY in every GitHub workflow regardless of name or marker", async () => {
  await withRepository(async (root) => {
    await writeWorkflow(root, "product-openai.yml", [
      "name: Run product AI evaluation",
      "# codex-subscription-boundary: product-runtime-only",
      "on: workflow_dispatch",
      "permissions: read-all",
      "jobs:",
      "  evaluate:",
      "    runs-on: ubuntu-24.04",
      "    env:",
      "      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}",
    ]);

    const findings = await inspectCodexSubscriptionBoundary(root);
    assert.ok(findings.some((finding) => finding.reason.includes("may not receive OPENAI_API_KEY")));
  });
});

test("rejects official Codex action, direct package use, and codex exec", async () => {
  await withRepository(async (root) => {
    await writeWorkflow(root, "agent.yml", [
      "name: Build agent",
      "on: workflow_dispatch",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-24.04",
      "    steps:",
      "      - uses: openai/codex-action@deadbeef",
      "      - run: npm install @openai/codex",
      "      - run: codex exec --model example",
    ]);

    const findings = await inspectCodexSubscriptionBoundary(root);
    assert.ok(findings.some((finding) => finding.reason.includes("Codex Action")));
    assert.ok(findings.some((finding) => finding.reason.includes("API-backed Codex package")));
    assert.ok(findings.some((finding) => finding.reason.includes("Codex CLI execution")));
  });
});

test("rejects retired factory callers and superseded allowlist configuration", async () => {
  await withRepository(async (root) => {
    await writeWorkflow(root, "ai-implement.yml", "name: retired\n");
    await mkdir(join(root, ".ai-factory"), { recursive: true });
    await writeFile(join(root, ".ai-factory", "project.json"), "{}\n");
    await writeFile(
      join(root, ".github", "codex-product-runtime-workflows.json"),
      "{}\n",
    );

    const findings = await inspectCodexSubscriptionBoundary(root);
    assert.ok(
      findings.some(
        (finding) => finding.file === ".github/workflows/ai-implement.yml",
      ),
    );
    assert.ok(
      findings.some((finding) => finding.file === ".ai-factory/project.json"),
    );
    assert.ok(
      findings.some(
        (finding) =>
          finding.file === ".github/codex-product-runtime-workflows.json",
      ),
    );
  });
});

test("rejects secret inheritance in a software-development workflow", async () => {
  await withRepository(async (root) => {
    await writeWorkflow(root, "implement.yml", [
      "name: Implement approved issue",
      "on: workflow_dispatch",
      "jobs:",
      "  build:",
      "    uses: owner/repo/.github/workflows/build.yml@deadbeef",
      "    secrets: inherit",
    ]);

    const findings = await inspectCodexSubscriptionBoundary(root);
    assert.ok(
      findings.some((finding) => finding.reason.includes("may not inherit")),
    );
  });
});

test("does not reject an unrelated reusable workflow with no agent indicator or OpenAI key", async () => {
  await withRepository(async (root) => {
    await writeWorkflow(root, "release.yml", [
      "name: Publish static documentation",
      "on: workflow_dispatch",
      "jobs:",
      "  publish:",
      "    uses: owner/repo/.github/workflows/docs.yml@deadbeef",
      "    secrets: inherit",
    ]);

    assert.deepEqual(await inspectCodexSubscriptionBoundary(root), []);
  });
});

test("does not inspect product runtime configuration outside GitHub workflows", async () => {
  await withRepository(async (root) => {
    await writeFile(
      join(root, ".env.example"),
      "OPENAI_API_KEY=product-runtime-only\n",
    );
    await writeFile(
      join(root, "product-runtime.json"),
      JSON.stringify({ provider: "openai" }),
    );
    await writeWorkflow(
      root,
      "ci.yaml",
      "name: CI\non: [pull_request]\njobs:\n  verify:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm test\n",
    );

    assert.deepEqual(await inspectCodexSubscriptionBoundary(root), []);
  });
});
