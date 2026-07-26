import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  inspectCodexSubscriptionBoundary,
  PRODUCT_RUNTIME_ALLOWLIST_PATH,
} from "../../scripts/security/verify-codex-subscription-boundary.mjs";

async function writeAllowlist(root, allowedWorkflows = []) {
  const path = join(root, PRODUCT_RUNTIME_ALLOWLIST_PATH);
  await mkdir(join(root, ".github"), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({ allowed_workflows: allowedWorkflows }, null, 2)}\n`,
  );
}

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
    await writeAllowlist(root);
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

test("rejects the official Codex action and OpenAI API secret in an agent workflow", async () => {
  await withRepository(async (root) => {
    await writeWorkflow(root, "agent.yml", [
      "name: Codex agent",
      "on: workflow_dispatch",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-24.04",
      "    steps:",
      "      - uses: openai/codex-action@deadbeef",
      "        with:",
      "          openai-api-key: ${{ secrets.OPENAI_API_KEY }}",
    ]);

    const findings = await inspectCodexSubscriptionBoundary(root);
    assert.ok(findings.some((finding) => finding.reason.includes("Codex Action")));
    assert.ok(findings.some((finding) => finding.reason.includes("must not receive")));
    assert.ok(findings.some((finding) => finding.reason.includes("must not pass")));
  });
});

test("rejects retired factory callers and configuration", async () => {
  await withRepository(async (root) => {
    await writeWorkflow(root, "ai-implement.yml", "name: retired\n");
    await mkdir(join(root, ".ai-factory"), { recursive: true });
    await writeFile(join(root, ".ai-factory", "project.json"), "{}\n");

    const findings = await inspectCodexSubscriptionBoundary(root);
    assert.ok(
      findings.some(
        (finding) => finding.file === ".github/workflows/ai-implement.yml",
      ),
    );
    assert.ok(
      findings.some((finding) => finding.file === ".ai-factory/project.json"),
    );
  });
});

test("rejects non-allowlisted workflow credentials even when the workflow self-asserts product runtime", async () => {
  await withRepository(async (root) => {
    await writeWorkflow(root, "implement.yml", [
      "name: Implement approved issue",
      "# codex-subscription-boundary: product-runtime-only",
      "on: workflow_dispatch",
      "jobs:",
      "  work:",
      "    runs-on: ubuntu-24.04",
      "    env:",
      "      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}",
    ]);

    const findings = await inspectCodexSubscriptionBoundary(root);
    assert.ok(findings.length > 0);
    assert.ok(
      findings.some((finding) => finding.reason.includes("must not receive")),
    );
  });
});

test("allows OpenAI credentials only in an exact externally allowlisted product-runtime workflow", async () => {
  await withRepository(async (root) => {
    await writeAllowlist(root, [".github/workflows/product-openai.yml"]);
    await writeWorkflow(root, "product-openai.yml", [
      "name: Run product AI evaluation",
      "on: workflow_dispatch",
      "permissions:",
      "  contents: read",
      "jobs:",
      "  evaluate:",
      "    runs-on: ubuntu-24.04",
      "    env:",
      "      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}",
    ]);

    assert.deepEqual(await inspectCodexSubscriptionBoundary(root), []);
  });
});

test("rejects a renamed or moved workflow that is not the exact allowlisted path", async () => {
  await withRepository(async (root) => {
    await writeAllowlist(root, [".github/workflows/product-openai.yml"]);
    await writeWorkflow(root, "product-openai-copy.yml", [
      "name: Run product AI evaluation",
      "on: workflow_dispatch",
      "jobs:",
      "  evaluate:",
      "    runs-on: ubuntu-24.04",
      "    env:",
      "      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}",
    ]);

    const findings = await inspectCodexSubscriptionBoundary(root);
    assert.ok(findings.some((finding) => finding.reason.includes("not externally allowlisted")));
  });
});

test("does not let an allowlisted path excuse Codex development content", async () => {
  await withRepository(async (root) => {
    await writeAllowlist(root, [".github/workflows/product-openai.yml"]);
    await writeWorkflow(root, "product-openai.yml", [
      "name: Codex implementation",
      "on: workflow_dispatch",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-24.04",
      "    env:",
      "      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}",
    ]);

    const findings = await inspectCodexSubscriptionBoundary(root);
    assert.ok(findings.some((finding) => finding.reason.includes("must not receive")));
  });
});

test("does not let an allowlisted product workflow receive GitHub development write authority", async () => {
  await withRepository(async (root) => {
    await writeAllowlist(root, [".github/workflows/product-openai.yml"]);
    await writeWorkflow(root, "product-openai.yml", [
      "name: Run product AI evaluation",
      "on: workflow_dispatch",
      "permissions:",
      "  contents: write",
      "jobs:",
      "  evaluate:",
      "    runs-on: ubuntu-24.04",
      "    env:",
      "      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}",
    ]);

    const findings = await inspectCodexSubscriptionBoundary(root);
    assert.ok(
      findings.some((finding) => finding.reason.includes("development write authority")),
    );
  });
});

test("fails closed when the external allowlist is missing or malformed", async () => {
  await withRepository(async (root) => {
    await unlink(join(root, PRODUCT_RUNTIME_ALLOWLIST_PATH));
    await assert.rejects(
      inspectCodexSubscriptionBoundary(root),
      /Cannot read required/,
    );

    await writeFile(
      join(root, PRODUCT_RUNTIME_ALLOWLIST_PATH),
      JSON.stringify({ allowed_workflows: ["../unsafe.yml"] }),
    );
    await assert.rejects(
      inspectCodexSubscriptionBoundary(root),
      /must be an exact/,
    );
  });
});

test("rejects duplicate, unknown, or retired allowlist entries", async () => {
  await withRepository(async (root) => {
    await writeFile(
      join(root, PRODUCT_RUNTIME_ALLOWLIST_PATH),
      JSON.stringify({
        allowed_workflows: [
          ".github/workflows/product-openai.yml",
          ".github/workflows/product-openai.yml",
        ],
      }),
    );
    await assert.rejects(
      inspectCodexSubscriptionBoundary(root),
      /must not contain duplicates/,
    );

    await writeFile(
      join(root, PRODUCT_RUNTIME_ALLOWLIST_PATH),
      JSON.stringify({ allowed_workflows: [], extra: true }),
    );
    await assert.rejects(
      inspectCodexSubscriptionBoundary(root),
      /must contain only allowed_workflows/,
    );

    await writeFile(
      join(root, PRODUCT_RUNTIME_ALLOWLIST_PATH),
      JSON.stringify({
        allowed_workflows: [".github/workflows/ai-implement.yml"],
      }),
    );
    await assert.rejects(
      inspectCodexSubscriptionBoundary(root),
      /may not allowlist a retired factory file/,
    );
  });
});

test("does not inspect product runtime configuration outside GitHub workflows", async () => {
  await withRepository(async (root) => {
    await writeFile(
      join(root, ".env.example"),
      "OPENAI_API_KEY=product-runtime-only\n",
    );
    await writeWorkflow(
      root,
      "ci.yaml",
      "name: CI\non: [pull_request]\njobs:\n  verify:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm test\n",
    );

    assert.deepEqual(await inspectCodexSubscriptionBoundary(root), []);
  });
});
