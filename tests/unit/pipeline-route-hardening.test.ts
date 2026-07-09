import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getSummary: vi.fn(),
  runPipelineBounded: vi.fn(),
  getPipelineStatus: vi.fn(),
  healthCheck: vi.fn(),
  enablePipeline: vi.fn(),
  disablePipeline: vi.fn(),
}));

vi.mock("@/lib/auth", () => {
  const levels: Record<string, number> = {
    SUPER_ADMIN: 100,
    TENANT_ADMIN: 80,
    COMPLIANCE: 60,
    EXECUTIVE: 40,
    VIEWER: 20,
  };

  return {
    auth: mocks.auth,
    hasPermission: (role: string, requiredRole: string) =>
      (levels[role] ?? 0) >= (levels[requiredRole] ?? 0),
  };
});

vi.mock("@/lib/pipelines/orchestrator", () => ({
  pipelineOrchestrator: {
    getSummary: mocks.getSummary,
    runPipelineBounded: mocks.runPipelineBounded,
    getPipelineStatus: mocks.getPipelineStatus,
    healthCheck: mocks.healthCheck,
    enablePipeline: mocks.enablePipeline,
    disablePipeline: mocks.disablePipeline,
  },
}));

function sessionWithRole(role: string) {
  return {
    user: {
      id: "user-1",
      role,
      tenantId: "tenant-1",
    },
  };
}

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/pipelines", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("pipeline route hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runPipelineBounded.mockResolvedValue({
      pipelineType: "federal_register",
      sourceName: "Federal Register",
      mode: "dry_run",
      limit: 10,
      startedAt: "2026-07-08T00:00:00.000Z",
      completedAt: "2026-07-08T00:00:01.000Z",
      durationMs: 1000,
      status: "completed",
      recordsFetched: 0,
      recordsTransformed: 0,
      recordsWritten: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      dedupeHits: 0,
      pipelineRunId: null,
      errors: [],
      previews: [],
      requestedSourceIds: [],
      writtenSourceIds: [],
      skippedSourceIds: [],
      rejectedSourceIds: [],
    });
  });

  it("blocks unauthenticated pipeline writes", async () => {
    mocks.auth.mockResolvedValue(null);
    const { POST } = await import("@/app/api/pipelines/route");

    const response = await POST(request({ pipelineType: "federal_register", mode: "write" }));

    expect(response.status).toBe(401);
    expect(mocks.runPipelineBounded).not.toHaveBeenCalled();
  });

  it("blocks non-compliance roles before triggering a pipeline", async () => {
    mocks.auth.mockResolvedValue(sessionWithRole("VIEWER"));
    const { POST } = await import("@/app/api/pipelines/route");

    const response = await POST(request({ pipelineType: "federal_register", mode: "write" }));

    expect(response.status).toBe(403);
    expect(mocks.runPipelineBounded).not.toHaveBeenCalled();
  });

  it("defaults authenticated pipeline requests to dry-run mode", async () => {
    mocks.auth.mockResolvedValue(sessionWithRole("COMPLIANCE"));
    const { POST } = await import("@/app/api/pipelines/route");

    const response = await POST(request({ pipelineType: "federal_register" }));

    expect(response.status).toBe(200);
    expect(mocks.runPipelineBounded).toHaveBeenCalledWith("federal_register", {
      mode: "dry_run",
      limit: 10,
      cursor: null,
      approvedSourceIds: undefined,
    });
  });

  it("rejects smoke limits above the configured maximum", async () => {
    mocks.auth.mockResolvedValue(sessionWithRole("TENANT_ADMIN"));
    const { POST } = await import("@/app/api/pipelines/route");

    const response = await POST(
      request({ pipelineType: "federal_register", mode: "dry_run", limit: 26 }),
    );
    const body = (await response.json()) as { error: { code: string; maxLimit: number } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.maxLimit).toBe(25);
    expect(mocks.runPipelineBounded).not.toHaveBeenCalled();
  });

  it("rejects write mode without approved source IDs", async () => {
    mocks.auth.mockResolvedValue(sessionWithRole("TENANT_ADMIN"));
    const { POST } = await import("@/app/api/pipelines/route");

    const response = await POST(
      request({ pipelineType: "openfda", mode: "write", limit: 5 }),
    );
    const body = (await response.json()) as {
      error: { code: string; issues: Array<{ path: string[]; message: string }> };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["approvedSourceIds"],
          message: "Write mode requires approvedSourceIds",
        }),
      ]),
    );
    expect(mocks.runPipelineBounded).not.toHaveBeenCalled();
  });

  it("allows explicit write only after authenticated compliance access and reviewed IDs", async () => {
    mocks.auth.mockResolvedValue(sessionWithRole("TENANT_ADMIN"));
    const { POST } = await import("@/app/api/pipelines/route");

    const response = await POST(
      request({
        pipelineType: "openfda",
        mode: "write",
        limit: 5,
        approvedSourceIds: ["H-0950-2026"],
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.runPipelineBounded).toHaveBeenCalledWith("openfda", {
      mode: "write",
      limit: 5,
      cursor: null,
      approvedSourceIds: ["H-0950-2026"],
    });
  });
});
