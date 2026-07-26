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

function findingsFor(findings, file) {
  return findings.filter((finding) => finding.file.endsWith(file));
}

test("accepts ordinary secret-free CI workflows", async () => {
  await withRepository(async (root) => {
    await writeWorkflow(
      root,
      "ci.yml",
      "name: CI\non: [pull_request]\npermissions:\n  contents: read\njobs:\n  verify:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm test\n",
    );

    assert.deepEqual(await inspectCodexSubscriptionBoundary(root), []);
  });
});

test("rejects OPENAI_API_KEY in every letter case", async () => {
  await withRepository(async (root) => {
    await writeWorkflow(root, "lower.yml", [
      "name: Lower-case credential",
      "on: workflow_dispatch",
      "jobs:",
      "  evaluate:",
      "    runs-on: ubuntu-24.04",
      "    env:",
      "      provider_key: ${{ secrets.openai_api_key }}",
    ]);
    await writeWorkflow(root, "mixed.yml", [
      "name: Mixed-case credential",
      "on: workflow_dispatch",
      "jobs:",
      "  evaluate:",
      "    runs-on: ubuntu-24.04",
      "    env:",
      "      provider_key: ${{ secrets.OpenAI_Api_Key }}",
    ]);

    const findings = await inspectCodexSubscriptionBoundary(root);
    for (const file of ["lower.yml", "mixed.yml"]) {
      assert.ok(
        findingsFor(findings, file).some((finding) =>
          finding.reason.includes("may not reference OPENAI_API_KEY"),
        ),
      );
    }
  });
});

test("rejects generic repository-secret reads, whole-context serialization, and every secrets declaration form", async () => {
  await withRepository(async (root) => {
    await writeWorkflow(root, "secret-reference.yml", [
      "name: Generic secret read",
      "on: workflow_dispatch",
      "jobs:",
      "  publish:",
      "    runs-on: ubuntu-24.04",
      "    env:",
      "      token: ${{ secrets.MODEL_TOKEN }}",
    ]);
    await writeWorkflow(root, "whole-context.yml", [
      "name: Whole secrets context",
      "on: workflow_dispatch",
      "jobs:",
      "  publish:",
      "    runs-on: ubuntu-24.04",
      "    env:",
      "      all_repository_secrets: ${{ toJSON(secrets) }}",
    ]);
    await writeWorkflow(root, "block-map.yml", [
      "name: Reusable block mapping",
      "on: workflow_dispatch",
      "jobs:",
      "  publish:",
      "    uses: owner/repo/.github/workflows/docs.yml@deadbeef",
      "    secrets:",
      "      docs_token: placeholder",
    ]);
    await writeWorkflow(root, "inline-map.yml", [
      "name: Reusable inline mapping",
      "on: workflow_dispatch",
      "jobs:",
      "  publish: { uses: owner/repo/.github/workflows/docs.yml@deadbeef, secrets: { docs_token: placeholder } }",
    ]);
    await writeWorkflow(root, "quoted-key.yml", [
      "name: Quoted secrets key",
      "on: workflow_dispatch",
      "jobs:",
      "  publish:",
      "    uses: owner/repo/.github/workflows/docs.yml@deadbeef",
      "    \"secrets\": inherit",
    ]);
    await writeWorkflow(root, "explicit-key.yml", [
      "name: Explicit YAML key",
      "on: workflow_dispatch",
      "jobs:",
      "  publish:",
      "    uses: owner/repo/.github/workflows/docs.yml@deadbeef",
      "    ? secrets",
      "    : inherit",
    ]);

    const findings = await inspectCodexSubscriptionBoundary(root);
    for (const file of [
      "secret-reference.yml",
      "whole-context.yml",
      "block-map.yml",
      "inline-map.yml",
      "quoted-key.yml",
      "explicit-key.yml",
    ]) {
      assert.ok(findingsFor(findings, file).length > 0, `${file} must fail closed`);
    }
    assert.ok(
      findingsFor(findings, "whole-context.yml").some((finding) =>
        finding.reason.includes("read or serialize the repository secrets context"),
      ),
    );
  });
});

test("rejects secret expressions and OpenAI endpoints split across block scalars", async () => {
  await withRepository(async (root) => {
    await writeWorkflow(root, "multiline.yml", [
      "name: Multiline authority",
      "on: workflow_dispatch",
      "jobs:",
      "  evaluate:",
      "    runs-on: ubuntu-24.04",
      "    env:",
      "      TOKEN: >-",
      "        ${{",
      "        secrets.MODEL_TOKEN",
      "        }}",
      "      ENDPOINT: >-",
      "        https://api.",
      "        openai.com/v1/responses",
    ]);

    const findings = findingsFor(
      await inspectCodexSubscriptionBoundary(root),
      "multiline.yml",
    );
    assert.ok(
      findings.some((finding) =>
        finding.reason.includes("read or serialize the repository secrets context"),
      ),
    );
    assert.ok(
      findings.some((finding) =>
        finding.reason.includes("may not call the OpenAI API"),
      ),
    );
  });
});

test("rejects encoded YAML characters that can hide forbidden authority", async () => {
  await withRepository(async (root) => {
    await writeWorkflow(root, "encoded.yml", [
      "name: Encoded authority",
      "on: workflow_dispatch",
      "jobs:",
      "  evaluate:",
      "    runs-on: ubuntu-24.04",
      "    env:",
      '      TOKEN: "${{ se\\u0063rets.MODEL_TOKEN }}"',
      '      ENDPOINT: "https://api.open\\u0061i.com/v1/responses"',
    ]);

    const findings = findingsFor(
      await inspectCodexSubscriptionBoundary(root),
      "encoded.yml",
    );
    assert.ok(
      findings.some((finding) =>
        finding.reason.includes("encoded YAML character escapes"),
      ),
    );
  });
});

test("rejects alphabetic and numeric YAML anchors and aliases", async () => {
  await withRepository(async (root) => {
    await writeWorkflow(root, "anchor.yml", [
      "name: Anchored value",
      "on: workflow_dispatch",
      "x-mode: &all inherit",
      "x-numeric: &1 inherit",
      "jobs:",
      "  publish:",
      "    runs-on: ubuntu-24.04",
      "    env:",
      "      MODE: *all",
      "      OTHER_MODE: *1",
    ]);

    const findings = await inspectCodexSubscriptionBoundary(root);
    assert.ok(
      findingsFor(findings, "anchor.yml").some((finding) =>
        finding.reason.includes("YAML anchors or aliases"),
      ),
    );
  });
});

test("rejects direct OpenAI API calls with generically named credentials", async () => {
  await withRepository(async (root) => {
    await writeWorkflow(root, "direct-api.yml", [
      "name: Generic model call",
      "on: workflow_dispatch",
      "jobs:",
      "  evaluate:",
      "    runs-on: ubuntu-24.04",
      "    steps:",
      "      - run: curl https://api.openai.com/v1/responses -H 'Authorization: Bearer token'",
    ]);

    const findings = await inspectCodexSubscriptionBoundary(root);
    assert.ok(
      findingsFor(findings, "direct-api.yml").some((finding) =>
        finding.reason.includes("may not call the OpenAI API"),
      ),
    );
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
    assert.ok(
      findings.some((finding) =>
        finding.reason.includes("API-backed Codex package"),
      ),
    );
    assert.ok(
      findings.some((finding) => finding.reason.includes("Codex CLI execution")),
    );
  });
});

test("rejects retired factory callers and superseded configuration", async () => {
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

test("ignores product runtime configuration outside GitHub workflows", async () => {
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
