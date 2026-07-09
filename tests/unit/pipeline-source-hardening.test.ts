import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FederalRegisterClient } from "@/lib/pipelines/federal-register/client";
import type {
  FederalRegisterDocument,
  FederalRegisterSearchResponse,
} from "@/lib/pipelines/federal-register/types";
import { LegiScanClient } from "@/lib/pipelines/legiscan/client";
import type {
  PipelineRequestOptions,
  PipelineResponse,
  DeduplicationCheck,
  TransformedRegulatorySource,
} from "@/lib/pipelines/types";
import { OPENFDA_ENDPOINTS, OPENFDA_UNSUPPORTED_ENDPOINTS } from "@/lib/pipelines/openfda/types";
import { transformEnforcementRecord } from "@/lib/pipelines/openfda/transforms";
import { transformUsdaFoodItem } from "@/lib/pipelines/usda/transforms";
import type { UsdaFoodItem } from "@/lib/pipelines/usda/types";

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const federalRegisterDocument: FederalRegisterDocument = {
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
};

class DryRunFederalRegisterClient extends FederalRegisterClient {
  persistCalls = 0;

  protected override async request<TResponseBody>(
    _options: PipelineRequestOptions,
  ): Promise<PipelineResponse<TResponseBody>> {
    return {
      data: {
        count: 1,
        description: "fixture",
        total_pages: 1,
        next_page_url: null,
        previous_page_url: null,
        results: [federalRegisterDocument],
      } as FederalRegisterSearchResponse as TResponseBody,
      statusCode: 200,
      headers: {},
      rateLimit: { remaining: null, resetAt: null, limit: null },
    };
  }

  override async deduplicate(
    _transformed: TransformedRegulatorySource,
  ): Promise<DeduplicationCheck> {
    return {
      exists: false,
      existingId: null,
      hasChanged: false,
      contentHash: "new",
    };
  }

  override async persist(
    transformed: TransformedRegulatorySource,
    _dedup: DeduplicationCheck,
  ): Promise<string> {
    this.persistCalls++;
    return transformed.sourceId;
  }
}

class InspectableLegiScanClient extends LegiScanClient {
  requestCalled = false;

  inspectUrl(options: PipelineRequestOptions): string {
    return this.buildUrl(options);
  }

  protected override async request<TResponseBody>(
    _options: PipelineRequestOptions,
  ): Promise<PipelineResponse<TResponseBody>> {
    this.requestCalled = true;
    throw new Error("request should not be called when LegiScan is not configured");
  }
}

describe("pipeline source hardening", () => {
  const originalLegiscanKey = process.env["LEGISCAN_API_KEY"];
  const originalFederalRegisterKey = process.env["FEDERAL_REGISTER_API_KEY"];

  afterEach(() => {
    if (originalLegiscanKey === undefined) {
      delete process.env["LEGISCAN_API_KEY"];
    } else {
      process.env["LEGISCAN_API_KEY"] = originalLegiscanKey;
    }

    if (originalFederalRegisterKey === undefined) {
      delete process.env["FEDERAL_REGISTER_API_KEY"];
    } else {
      process.env["FEDERAL_REGISTER_API_KEY"] = originalFederalRegisterKey;
    }
  });

  it("dry-run fetches and transforms without writing source records", async () => {
    const client = new DryRunFederalRegisterClient();

    const result = await client.executeBounded({ mode: "dry_run", limit: 1 });

    expect(result).toMatchObject({
      mode: "dry_run",
      status: "completed",
      recordsFetched: 1,
      recordsTransformed: 1,
      recordsWritten: 0,
      pipelineRunId: null,
    });
    expect(client.persistCalls).toBe(0);
  });

  it("keeps Federal Register no-key behavior in bounded runs", async () => {
    process.env["FEDERAL_REGISTER_API_KEY"] = "legacy-value-that-must-not-be-used";
    const client = new DryRunFederalRegisterClient();

    const result = await client.executeBounded({ mode: "dry_run", limit: 1 });

    expect(result.status).toBe("completed");
    expect(result.previews[0]?.sourceUrl).toContain("federalregister.gov/documents");
  });

  it("uses only the official openFDA food enforcement endpoint for ingestion", () => {
    expect(OPENFDA_ENDPOINTS).toEqual({
      FOOD_ENFORCEMENT: "food/enforcement.json",
    });
    expect(OPENFDA_UNSUPPORTED_ENDPOINTS).toMatchObject({
      FOOD_GRAS: "food/gras.json",
      FOOD_ADDITIVE: "food/additive.json",
      FOOD_COLOR_ADDITIVE: "food/coloradditive.json",
    });
  });

  it("transforms real-shaped openFDA food enforcement records with source evidence", () => {
    const transformed = transformEnforcementRecord({
      country: "United States",
      city: "Austin",
      address_1: "1 Main St",
      address_2: "",
      state: "TX",
      zip: "78701",
      postal_code: "",
      product_quantity: "10 cases",
      code_info: "LOT1",
      product_description: "Cookies containing undeclared allergen",
      reason_for_recall: "Undeclared milk allergen on label",
      recalling_firm: "Demo Foods",
      recall_number: "F-0001-2026",
      initial_firm_notification: "Letter",
      recall_initiation_date: "20260701",
      report_date: "20260702",
      classification: "Class I",
      status: "Ongoing",
      voluntary_mandated: "Voluntary",
      distribution_pattern: "Nationwide",
      recall_type: "Firm Initiated",
      event_id: 12345,
      product_type: "Food",
      termination_date: "",
      more_code_info: "",
    });

    expect(transformed).toMatchObject({
      sourceId: "F-0001-2026",
      sourceType: "FDA_RULE",
      jurisdiction: "US-TX",
      citationUrl: "https://open.fda.gov/apis/food/enforcement/",
      sourceAgency: "Food and Drug Administration",
      documentType: "food_enforcement",
    });
    expect(transformed.sourceUrl).toContain("https://api.fda.gov/food/enforcement.json");
    expect(new URL(transformed.sourceUrl!).searchParams.get("search")).toBe(
      'recall_number:"F-0001-2026"',
    );
  });

  it("classifies USDA FoodData records as reference data, not regulations", () => {
    const food = {
      fdcId: 1001,
      description: "Candy with FD&C Red 40",
      dataType: "Branded",
      publicationDate: "2026-01-01",
      foodCategory: "Candy",
      foodCategoryId: 1,
      foodNutrients: [],
      foodComponents: [],
      foodAttributes: [],
      ingredients: "Sugar, FD&C Red 40",
      brandOwner: "Demo Brand",
      gtinUpc: null,
      ndbNumber: null,
      foodCode: null,
      modifiedDate: null,
      availableDate: null,
      marketCountry: "United States",
      scientificName: null,
      subbrandOwner: null,
      servingSize: null,
      servingSizeUnit: null,
      householdServingFullText: null,
      tradeChannel: null,
      allHighlightFields: null,
      score: null,
      additionalDescriptions: null,
      foodClass: null,
      datasource: null,
      langualFactors: null,
      nutrientConversionFactors: null,
      isHistorical: null,
      inputFoods: null,
      finalFoodInputFoods: null,
      surveyFndds: null,
      wweiaFoodCategory: null,
      brandedFoodCategory: "Candy",
      effects: null,
      amount: null,
      foodPortions: null,
      notes: null,
      fdcIdsOfConcatenatedItem: null,
    } as UsdaFoodItem;

    const transformed = transformUsdaFoodItem(food);

    expect(transformed.sourceType).toBe("REFERENCE_DATA");
    expect(transformed.documentType).toBe("fooddata_Branded");
    expect(transformed.matchMetadata).toMatchObject({
      role: "ingredient_product_reference",
    });
  });

  it("blocks LegiScan health checks when the key is requested but unavailable", async () => {
    process.env["LEGISCAN_API_KEY"] = "requested";
    const client = new InspectableLegiScanClient();

    await expect(client.healthCheck()).resolves.toBe(false);
    expect(client.requestCalled).toBe(false);
  });

  it("builds LegiScan URLs with key= and never api_key=", () => {
    process.env["LEGISCAN_API_KEY"] = "legiscan-test-key";
    const client = new InspectableLegiScanClient();
    const url = client.inspectUrl({
      path: "/",
      params: {
        op: "search",
        state: "CA",
        query: "food additive",
      },
    });
    const parsedUrl = new URL(url);

    expect(parsedUrl.searchParams.get("key")).toBe("legiscan-test-key");
    expect(parsedUrl.searchParams.get("api_key")).toBeNull();
  });

  it("enforces schema-level source dedupe and upsert persistence", () => {
    const schema = read("prisma/schema.prisma");
    const baseClient = read("src/lib/pipelines/base-client.ts");

    expect(schema).toContain("@@unique([sourceType, sourceId])");
    expect(baseClient).toContain("regulatorySource.upsert");
    expect(baseClient).toContain("sourceType_sourceId");
  });

  it("keeps dry-runs non-persistent and write-runs observable", () => {
    const baseClient = read("src/lib/pipelines/base-client.ts");

    expect(baseClient).toContain('options.mode === "write"');
    expect(baseClient).toContain("prisma.pipelineRun.create");
    expect(baseClient).toContain("pipelineRunId: null");
  });
});
