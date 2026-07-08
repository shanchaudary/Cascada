import { afterEach, describe, expect, it } from "vitest";
import {
  buildDataSourceStatus,
  getCredentialStatus,
  getDataSourceDefinition,
  shouldBlockDataSourceTest,
} from "@/lib/settings/data-sources";
import { FederalRegisterClient } from "@/lib/pipelines/federal-register/client";
import { FEDERAL_REGISTER_FOOD_AGENCIES } from "@/lib/pipelines/federal-register/types";
import type {
  FederalRegisterDocument,
  FederalRegisterSearchParams,
  FederalRegisterSearchResponse,
} from "@/lib/pipelines/federal-register/types";
import { transformFederalRegisterDocument } from "@/lib/pipelines/federal-register/transforms";
import type { PipelineRequestOptions, PipelineResponse } from "@/lib/pipelines/types";

class UrlInspectingFederalRegisterClient extends FederalRegisterClient {
  public inspectUrl(options: PipelineRequestOptions): string {
    return this.buildUrl(options);
  }

  public inspectFetchRequest(): PipelineRequestOptions {
    return this.buildFetchRequest(null, 1);
  }
}

class CapturingFederalRegisterClient extends FederalRegisterClient {
  readonly searchCalls: FederalRegisterSearchParams[] = [];

  override async searchDocuments(
    params: FederalRegisterSearchParams,
  ): Promise<FederalRegisterSearchResponse> {
    this.searchCalls.push(params);
    return {
      count: 0,
      description: "test",
      total_pages: 1,
      next_page_url: null,
      previous_page_url: null,
      results: [] as FederalRegisterDocument[],
    };
  }
}

class HealthCapturingFederalRegisterClient extends FederalRegisterClient {
  healthRequest: PipelineRequestOptions | null = null;

  protected override async request<TResponseBody>(
    options: PipelineRequestOptions,
  ): Promise<PipelineResponse<TResponseBody>> {
    this.healthRequest = options;

    return {
      data: {
        count: 1,
        description: "ok",
        total_pages: 1,
        next_page_url: null,
        previous_page_url: null,
        results: [],
      } as TResponseBody,
      statusCode: 200,
      headers: {},
      rateLimit: {
        remaining: null,
        resetAt: null,
        limit: null,
      },
    };
  }
}

describe("Federal Register data-source credentials", () => {
  const originalFederalRegisterKey = process.env["FEDERAL_REGISTER_API_KEY"];

  afterEach(() => {
    if (originalFederalRegisterKey === undefined) {
      delete process.env["FEDERAL_REGISTER_API_KEY"];
    } else {
      process.env["FEDERAL_REGISTER_API_KEY"] = originalFederalRegisterKey;
    }
  });

  it("reports Federal Register as a configured public API with no credential env var", () => {
    const source = getDataSourceDefinition("federal_register");

    expect(source).toBeDefined();
    expect(source?.envVar).toBeNull();

    const status = buildDataSourceStatus(source!, null, null, {
      FEDERAL_REGISTER_API_KEY: "legacy-value-that-must-be-ignored",
    });

    expect(status).toMatchObject({
      type: "federal_register",
      label: "Federal Register",
      envVar: "",
      required: false,
      configured: true,
      credentialStatus: "Public API / No key required",
      maskedValue: "No key required",
    });
    expect(shouldBlockDataSourceTest(source!, status)).toBe(false);
  });

  it("keeps requested LegiScan credentials not configured while entered openFDA and USDA values are configured", () => {
    const legiscan = getDataSourceDefinition("legiscan")!;
    const openfda = getDataSourceDefinition("openfda")!;
    const usda = getDataSourceDefinition("usda")!;
    const env = {
      LEGISCAN_API_KEY: "requested",
      OPENFDA_API_KEY: "entered",
      USDA_API_KEY: "entered",
    };

    const legiscanStatus = getCredentialStatus(legiscan, env);
    const openFdaStatus = getCredentialStatus(openfda, env);
    const usdaStatus = getCredentialStatus(usda, env);

    expect(legiscanStatus).toMatchObject({
      configured: false,
      credentialStatus: "Requested",
      maskedValue: "Requested",
    });
    expect(shouldBlockDataSourceTest(legiscan, legiscanStatus)).toBe(true);
    expect(getCredentialStatus(legiscan, { LEGISCAN_API_KEY: "" })).toMatchObject({
      configured: false,
      credentialStatus: "Requested",
      maskedValue: "Requested",
    });
    expect(openFdaStatus).toMatchObject({ configured: true, maskedValue: "Configured" });
    expect(usdaStatus).toMatchObject({ configured: true, maskedValue: "Configured" });
  });

  it("never appends api_key to Federal Register URLs, even when a legacy env var exists", () => {
    process.env["FEDERAL_REGISTER_API_KEY"] = "legacy-value-that-must-not-be-sent";

    const url = new UrlInspectingFederalRegisterClient().inspectUrl({
      path: "documents.json",
      params: {
        per_page: 1,
        "conditions[term]": "food safety",
        "conditions[agencies][]": ["food-and-drug-administration"],
      },
    });
    const parsedUrl = new URL(url);

    expect(url).toContain("/documents.json");
    expect(parsedUrl.searchParams.get("per_page")).toBe("1");
    expect(parsedUrl.searchParams.get("conditions[term]")).toBe("food safety");
    expect(parsedUrl.searchParams.getAll("conditions[agencies][]")).toEqual([
      "food-and-drug-administration",
    ]);
    expect(url).not.toContain("api_key");
    expect(url).not.toContain("legacy-value-that-must-not-be-sent");
  });

  it("builds Federal Register health-check requests with valid document-search filters", () => {
    const request = new UrlInspectingFederalRegisterClient().inspectFetchRequest();

    expect(request.path).toBe("documents.json");
    expect(request.params).toMatchObject({
      per_page: 1,
      page: 1,
      "conditions[agencies][]": ["food-and-drug-administration"],
      "conditions[term]": "food additive",
    });
    expect(request.params?.["fields[]"]).toEqual(
      expect.arrayContaining(["document_number", "title", "type"]),
    );
    expect(request.params?.["fields[]"]).not.toEqual(
      expect.arrayContaining(["effective_date", "body_html", "body_text", "subjects", "topics"]),
    );
    expect(request.params).not.toHaveProperty("agencies[]");
    expect(request.params).not.toHaveProperty("conditions[keyword]");
  });

  it("health-checks Federal Register through a public no-key document search", async () => {
    process.env["FEDERAL_REGISTER_API_KEY"] = "legacy-value-that-must-not-be-sent";
    const client = new HealthCapturingFederalRegisterClient();

    await expect(client.healthCheck()).resolves.toBe(true);

    expect(client.healthRequest).toMatchObject({
      path: "documents.json",
      params: {
        per_page: 1,
        "conditions[term]": "food",
        "conditions[agencies][]": ["food-and-drug-administration"],
        "fields[]": ["document_number", "title", "type"],
      },
      timeoutMs: 15000,
    });
  });

  it("uses Federal Register document search for food-relevant agencies", async () => {
    const client = new CapturingFederalRegisterClient();

    await client.fetchRecentFoodDocuments("2026-01-01");

    expect(client.searchCalls).toHaveLength(1);
    expect(client.searchCalls[0]).toMatchObject({
      agencies: [...FEDERAL_REGISTER_FOOD_AGENCIES],
      type: ["RULE", "PROPOSED RULE", "NOTICE"],
      order: "newest",
      per_page: 100,
      page: 1,
    });
  });

  it("transforms document-list records that omit detail-only fields", () => {
    const transformed = transformFederalRegisterDocument({
      document_number: "2026-12855",
      title: "Sterigenics U.S., LLC; Filing of Food Additive Petition",
      type: "Proposed Rule",
      abstract: "FDA filed a food additive petition.",
      publication_date: "2026-06-25",
      agencies: [
        {
          raw_name: "Food and Drug Administration",
          name: "Food and Drug Administration",
          slug: "food-and-drug-administration",
          url: "https://www.federalregister.gov/agencies/food-and-drug-administration",
          json_url: "https://www.federalregister.gov/api/v1/agencies/199",
          parent_id: 221,
          id: 199,
        },
      ],
      excerpts: "food additive",
      html_url:
        "https://www.federalregister.gov/documents/2026/06/25/2026-12855/sterigenics-us-llc-filing-of-food-additive-petition",
      pdf_url: "https://www.govinfo.gov/content/pkg/FR-2026-06-25/pdf/2026-12855.pdf",
    });

    expect(transformed).toMatchObject({
      sourceId: "2026-12855",
      sourceType: "FDA_PROPOSED_RULE",
      jurisdiction: "US",
      sourceUrl:
        "https://www.federalregister.gov/documents/2026/06/25/2026-12855/sterigenics-us-llc-filing-of-food-additive-petition",
    });
    expect(transformed.fullText).toContain("Proposed Rule");
    expect(transformed.fullText).toContain("Food and Drug Administration");
  });
});
