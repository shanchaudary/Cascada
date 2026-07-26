import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inspectCodexSubscriptionBoundary } from "../../scripts/security/verify-codex-subscription-boundary.mjs";

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
    await writeFile(
      join(root, ".github", "workflows", "ci.yml"),
      "name: CI\non: [pull_request]\njobs:\n  verify:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm test\n",
    );

    assert.deepEqual(await inspectCodexSubscriptionBoundary(root), []);
  });
});

test("rejects the official Codex action and OpenAI API secret in an agent workflow", async () => {
  await withRepository(async (root) => {
    await writeFile(
      join(root, ".github", "workflows", "agent.yml"),
      [
        "name: Codex agent",
        "on: workflow_dispatch",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-24.04",
        "    steps:",
        "      - uses: openai/codex-action@deadbeef",
        "        with:",
        "          openai-api-key: ${{ secrets.OPENAI_API_KEY }}",
      ].join("\n"),
    );

    const findings = await inspectCodexSubscriptionBoundary(root);
    assert.ok(findings.some((finding) => finding.reason.includes("Codex Action")));
    assert.ok(findings.some((finding) => finding.reason.includes("must not receive")));
    assert.ok(findings.some((finding) => finding.reason.includes("must not pass")));
  });
});

test("rejects retired factory callers and configuration", async () => {
  await withRepository(async (root) => {
    await writeFile(join(root, ".github", "workflows", "ai-implement.yml"), "name: retired\n");
    await mkdir(join(root, ".ai-factory"), { recursive: true });
    await writeFile(join(root, ".ai-factory", "project.json"), "{}\n");

    const findings = await inspectCodexSubscriptionBoundary(root);
    assert.ok(findings.some((finding) => finding.file === ".github/workflows/ai-implement.yml"));
    assert.ok(findings.some((finding) => finding.file === ".ai-factory/project.json"));
  });
});

test("requires an explicit marker for product-runtime OpenAI workflow credentials", async () => {
  await withRepository(async (root) => {
    await writeFile(
      join(root, ".github", "workflows", "deploy.yml"),
      [
        "name: Deploy application",
        "on: workflow_dispatch",
        "jobs:",
        "  deploy:",
        "    runs-on: ubuntu-24.04",
        "    env:",
        "      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}",
      ].join("\n"),
    );

    const findings = await inspectCodexSubscriptionBoundary(root);
    assert.ok(findings.some((finding) => finding.reason.includes("product-runtime-only")));
  });
});

test("allows explicitly marked product-runtime use without an agent indicator", async () => {
  await withRepository(async (root) => {
    await writeFile(
      join(root, ".github", "workflows", "deploy.yml"),
      [
        "name: Deploy application",
        "# codex-subscription-boundary: product-runtime-only",
        "on: workflow_dispatch",
        "jobs:",
        "  deploy:",
        "    runs-on: ubuntu-24.04",
        "    env:",
        "      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}",
      ].join("\n"),
    );

    assert.deepEqual(await inspectCodexSubscriptionBoundary(root), []);
  });
});

test("does not let the product-runtime marker excuse Codex development use", async () => {
  await withRepository(async (root) => {
    await writeFile(
      join(root, ".github", "workflows", "codex-build.yml"),
      [
        "name: Codex build",
        "# codex-subscription-boundary: product-runtime-only",
        "on: workflow_dispatch",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-24.04",
        "    env:",
        "      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}",
      ].join("\n"),
    );

    const findings = await inspectCodexSubscriptionBoundary(root);
    assert.ok(findings.some((finding) => finding.reason.includes("must not receive")));
  });
});

test("does not inspect product runtime configuration outside GitHub workflows", async () => {
  await withRepository(async (root) => {
    await writeFile(join(root, ".env.example"), "OPENAI_API_KEY=product-runtime-only\n");
    await writeFile(
      join(root, ".github", "workflows", "ci.yaml"),
      "name: CI\non: [pull_request]\njobs:\n  verify:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm test\n",
    );

    assert.deepEqual(await inspectCodexSubscriptionBoundary(root), []);
  });
});
