import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FederalRegisterClient } from "@/lib/pipelines/federal-register/client";
import type {
  FederalRegisterDocument,
  FederalRegisterSearchResponse,
} from "@/lib/pipelines/federal-register/types";
import { transformFederalRegisterDocument } from "@/lib/pipelines/federal-register/transforms";
import { LegiScanClient } from "@/lib/pipelines/legiscan/client";
import { canWritePipelineRecord } from "@/lib/pipelines/relevance";
import type {
  PipelineRequestOptions,
  PipelineResponse,
  DeduplicationCheck,
  TransformedRegulatorySource,
} from "@/lib/pipelines/types";
import { OPENFDA_ENDPOINTS, OPENFDA_UNSUPPORTED_ENDPOINTS } from "@/lib/pipelines/openfda/types";
import { transformEnforcementRecord } from "@/lib/pipelines/openfda/transforms";
import { UsdaClient } from "@/lib/pipelines/usda/client";
import { transformUsdaFoodItem } from "@/lib/pipelines/usda/transforms";
import type { UsdaFoodItem, UsdaSearchResponse } from "@/lib/pipelines/usda/types";

const root = process.cwd();

const dbMocks = vi.hoisted(() => ({
  pipelineRunCreate: vi.fn(),
  pipelineRunUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    pipelineRun: {
      create: dbMocks.pipelineRunCreate,
      update: dbMocks.pipelineRunUpdate,
    },
  },
}));

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

const federalRegisterTobaccoDocument: FederalRegisterDocument = {
  document_number: "2026-13047",
  title: "Establishment Registration and Product Listing for Tobacco Products",
  type: "Proposed Rule",
  abstract: "FDA proposes requirements for tobacco product registration and nicotine product listing.",
  publication_date: "2026-06-29",
  agencies: federalRegisterDocument.agencies,
  excerpts: "tobacco products nicotine cigarette cigars",
  html_url:
    "https://www.federalregister.gov/documents/2026/06/29/2026-13047/establishment-registration-and-product-listing-for-tobacco-products",
  pdf_url: null,
};

const federalRegisterMedicalDeviceDocument: FederalRegisterDocument = {
  document_number: "2026-14000",
  title: "Medical Device Classification Product Review",
  type: "Notice",
  abstract: "FDA announces medical device clinical trial classification updates.",
  publication_date: "2026-06-30",
  agencies: federalRegisterDocument.agencies,
  excerpts: "medical device clinical trial",
  html_url: "https://www.federalregister.gov/documents/2026/06/30/2026-14000/device-review",
  pdf_url: null,
};

const federalRegisterGenericFdaDocument: FederalRegisterDocument = {
  document_number: "2026-14002",
  title: "Regulatory Review Period Docket Update",
  type: "Notice",
  abstract: "The Food and Drug Administration announces a general docket update.",
  publication_date: "2026-06-30",
  agencies: federalRegisterDocument.agencies,
  excerpts: "general docket update",
  html_url: "https://www.federalregister.gov/documents/2026/06/30/2026-14002/docket-update",
  pdf_url: null,
};

const federalRegisterFoodContactDeviceDocument: FederalRegisterDocument = {
  document_number: "2026-14001",
  title: "Food Contact Substance Notification for Packaging Components",
  type: "Notice",
  abstract: "FDA announces a food contact substance review for packaging materials.",
  publication_date: "2026-06-30",
  agencies: federalRegisterDocument.agencies,
  excerpts: "food contact substance packaging device component",
  html_url: "https://www.federalregister.gov/documents/2026/06/30/2026-14001/food-contact",
  pdf_url: null,
};

const federalRegisterFsisDocument: FederalRegisterDocument = {
  document_number: "2026-15000",
  title: "Food Safety and Inspection Service Labeling Compliance Update",
  type: "Rule",
  abstract: "FSIS finalizes food safety labeling compliance requirements.",
  publication_date: "2026-07-01",
  agencies: [
    {
      raw_name: "Food Safety and Inspection Service",
      name: "Food Safety and Inspection Service",
      slug: "food-safety-and-inspection-service",
      url: "https://www.federalregister.gov/agencies/food-safety-and-inspection-service",
      json_url: "https://www.federalregister.gov/api/v1/agencies/201",
      parent_id: 2,
      id: 201,
    },
  ],
  excerpts: "food safety labeling compliance",
  html_url: "https://www.federalregister.gov/documents/2026/07/01/2026-15000/fsis-labeling",
  pdf_url: null,
};

function usdaFoodFixture(overrides: Partial<UsdaFoodItem> = {}): UsdaFoodItem {
  return {
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
    ...overrides,
  };
}

class DryRunFederalRegisterClient extends FederalRegisterClient {
  persistCalls = 0;
  constructor(
    private readonly fixtureDocuments: FederalRegisterDocument[] = [federalRegisterDocument],
    private readonly dedupResult: DeduplicationCheck = {
      exists: false,
      existingId: null,
      hasChanged: false,
      contentHash: "new",
    },
  ) {
    super();
  }

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
        results: this.fixtureDocuments,
      } as FederalRegisterSearchResponse as TResponseBody,
      statusCode: 200,
      headers: {},
      rateLimit: { remaining: null, resetAt: null, limit: null },
    };
  }

  override async deduplicate(
    _transformed: TransformedRegulatorySource,
  ): Promise<DeduplicationCheck> {
    return this.dedupResult;
  }

  override async persist(
    transformed: TransformedRegulatorySource,
    _dedup: DeduplicationCheck,
  ): Promise<string> {
    this.persistCalls++;
    return transformed.sourceId;
  }
}

class DryRunUsdaClient extends UsdaClient {
  persistCalls = 0;

  constructor(private readonly fixtureItems: UsdaFoodItem[]) {
    super();
  }

  protected override async request<TResponseBody>(
    _options: PipelineRequestOptions,
  ): Promise<PipelineResponse<TResponseBody>> {
    return {
      data: {
        foodSearchCriteria: "fixture",
        totalHits: this.fixtureItems.length,
        currentPage: 1,
        totalPages: 1,
        foods: this.fixtureItems,
      } as UsdaSearchResponse as TResponseBody,
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

  beforeEach(() => {
    dbMocks.pipelineRunCreate.mockResolvedValue({ id: "pipeline-run-1" });
    dbMocks.pipelineRunUpdate.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();

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
    expect(result.previews[0]).toMatchObject({
      sourceId: federalRegisterDocument.document_number,
      wouldWrite: true,
      relevanceDecision: {
        relevant: true,
        sourceCategory: "federal_regulatory_document",
      },
    });
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
      relevanceDecision: {
        relevant: true,
        confidence: "high",
        sourceCategory: "food_enforcement",
      },
    });
    expect(transformed.sourceUrl).toContain("https://api.fda.gov/food/enforcement.json");
    expect(new URL(transformed.sourceUrl!).searchParams.get("search")).toBe(
      'recall_number:"F-0001-2026"',
    );
    expect(transformed.sourceUrl).not.toContain("api_key");
  });

  it("marks Federal Register food labeling documents as writeable regulatory records", () => {
    const transformed = transformFederalRegisterDocument(federalRegisterDocument);

    expect(transformed.relevanceDecision).toMatchObject({
      relevant: true,
      confidence: "high",
      sourceCategory: "federal_regulatory_document",
    });
    expect(transformed.relevanceDecision?.matchedTerms).toEqual(
      expect.arrayContaining(["food additive"]),
    );
    expect(canWritePipelineRecord(transformed)).toBe(true);
  });

  it("excludes Federal Register tobacco documents from write mode", () => {
    const transformed = transformFederalRegisterDocument(federalRegisterTobaccoDocument);

    expect(transformed.relevanceDecision).toMatchObject({
      relevant: false,
      confidence: "low",
      sourceCategory: "federal_regulatory_document",
    });
    expect(transformed.relevanceDecision?.excludedTerms).toEqual(
      expect.arrayContaining(["tobacco", "nicotine"]),
    );
    expect(canWritePipelineRecord(transformed)).toBe(false);
  });

  it("excludes Federal Register medical-device documents unless food-contact evidence exists", () => {
    const device = transformFederalRegisterDocument(federalRegisterMedicalDeviceDocument);
    const foodContact = transformFederalRegisterDocument(federalRegisterFoodContactDeviceDocument);

    expect(device.relevanceDecision).toMatchObject({
      relevant: false,
      confidence: "low",
    });
    expect(device.relevanceDecision?.excludedTerms).toEqual(expect.arrayContaining(["device"]));
    expect(canWritePipelineRecord(device)).toBe(false);

    expect(foodContact.relevanceDecision).toMatchObject({
      relevant: true,
      sourceCategory: "federal_regulatory_document",
    });
    expect(foodContact.relevanceDecision?.matchedTerms).toEqual(
      expect.arrayContaining(["food contact"]),
    );
    expect(canWritePipelineRecord(foodContact)).toBe(true);
  });

  it("does not treat FDA agency text alone as Federal Register food relevance", () => {
    const transformed = transformFederalRegisterDocument(federalRegisterGenericFdaDocument);

    expect(transformed.relevanceDecision).toMatchObject({
      relevant: false,
      confidence: "low",
    });
    expect(transformed.relevanceDecision?.matchedTerms).toEqual(["food"]);
    expect(transformed.relevanceDecision?.excludedReasons).toEqual(
      expect.arrayContaining([
        "FDA records need specific food/manufacturing evidence beyond the word food",
      ]),
    );
    expect(canWritePipelineRecord(transformed)).toBe(false);
  });

  it("marks FSIS food documents as relevant Federal Register records", () => {
    const transformed = transformFederalRegisterDocument(federalRegisterFsisDocument);

    expect(transformed.relevanceDecision).toMatchObject({
      relevant: true,
      sourceCategory: "federal_regulatory_document",
    });
    expect(transformed.relevanceDecision?.matchedTerms).toEqual(
      expect.arrayContaining(["food safety", "labeling"]),
    );
    expect(canWritePipelineRecord(transformed)).toBe(true);
  });

  it("excludes openFDA records that are clearly non-food", () => {
    const transformed = transformEnforcementRecord({
      country: "United States",
      city: "Austin",
      address_1: "1 Main St",
      address_2: "",
      state: "TX",
      zip: "78701",
      postal_code: "",
      product_quantity: "1 unit",
      code_info: "LOT1",
      product_description: "Infusion pump device",
      reason_for_recall: "Medical device software malfunction",
      recalling_firm: "Demo Medical",
      recall_number: "Z-0001-2026",
      initial_firm_notification: "Letter",
      recall_initiation_date: "20260701",
      report_date: "20260702",
      classification: "Class II",
      status: "Ongoing",
      voluntary_mandated: "Voluntary",
      distribution_pattern: "Nationwide",
      recall_type: "Firm Initiated",
      event_id: 12346,
      product_type: "Device",
      termination_date: "",
      more_code_info: "",
    });

    expect(transformed.relevanceDecision).toMatchObject({
      relevant: false,
      confidence: "low",
      sourceCategory: "food_enforcement",
    });
    expect(transformed.relevanceDecision?.excludedTerms).toEqual(expect.arrayContaining(["device"]));
    expect(canWritePipelineRecord(transformed)).toBe(false);
  });

  it("classifies USDA FoodData records as reference data, not regulations", () => {
    const transformed = transformUsdaFoodItem(usdaFoodFixture());

    expect(transformed.sourceType).toBe("REFERENCE_DATA");
    expect(transformed.documentType).toBe("fooddata_Branded");
    expect(transformed.matchMetadata).toMatchObject({
      role: "ingredient_product_reference",
      relevanceDecision: {
        sourceCategory: "enrichment_reference",
      },
    });
    expect(transformed.relevanceDecision).toMatchObject({
      sourceCategory: "enrichment_reference",
    });
    expect(canWritePipelineRecord(transformed)).toBe(false);
  });

  it("rejects direct write mode without reviewed source IDs", async () => {
    const client = new DryRunFederalRegisterClient([federalRegisterDocument]);

    await expect(client.executeBounded({ mode: "write", limit: 1 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      statusCode: 400,
    });
    expect(client.persistCalls).toBe(0);
    expect(dbMocks.pipelineRunCreate).not.toHaveBeenCalled();
  });

  it("writes only the approved relevant Federal Register source ID", async () => {
    const client = new DryRunFederalRegisterClient([
      federalRegisterTobaccoDocument,
      federalRegisterDocument,
    ]);

    const result = await client.executeBounded({
      mode: "write",
      limit: 2,
      approvedSourceIds: [federalRegisterDocument.document_number],
    });

    expect(result).toMatchObject({
      mode: "write",
      recordsFetched: 2,
      recordsTransformed: 2,
      recordsWritten: 1,
      recordsCreated: 1,
      pipelineRunId: "pipeline-run-1",
      requestedSourceIds: [federalRegisterDocument.document_number],
      writtenSourceIds: [federalRegisterDocument.document_number],
      rejectedSourceIds: [],
    });
    expect(result.skippedSourceIds).toEqual(
      expect.arrayContaining([
        {
          sourceId: federalRegisterTobaccoDocument.document_number,
          reason: "Not listed in approvedSourceIds",
        },
      ]),
    );
    expect(client.persistCalls).toBe(1);
    expect(dbMocks.pipelineRunCreate).toHaveBeenCalledOnce();
    expect(dbMocks.pipelineRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pipeline-run-1" },
        data: expect.objectContaining({
          recordsNew: 1,
          recordsFailed: 0,
        }),
      }),
    );
  });

  it("refuses write mode for approved non-relevant Federal Register records", async () => {
    const client = new DryRunFederalRegisterClient([federalRegisterTobaccoDocument]);

    const result = await client.executeBounded({
      mode: "write",
      limit: 1,
      approvedSourceIds: [federalRegisterTobaccoDocument.document_number],
    });

    expect(result).toMatchObject({
      mode: "write",
      recordsFetched: 1,
      recordsTransformed: 1,
      recordsWritten: 0,
      recordsSkipped: 1,
      writtenSourceIds: [],
    });
    expect(client.persistCalls).toBe(0);
    expect(result.rejectedSourceIds).toEqual([
      {
        sourceId: federalRegisterTobaccoDocument.document_number,
        reason: "Not writeable because the record is not relevant",
      },
    ]);
    expect(result.previews[0]).toMatchObject({
      sourceId: federalRegisterTobaccoDocument.document_number,
      wouldWrite: false,
      why: "Not writeable because the record is not relevant",
      relevanceDecision: {
        relevant: false,
        confidence: "low",
      },
    });
  });

  it("refuses write mode for approved USDA enrichment reference records", async () => {
    process.env["USDA_API_KEY"] = "test-usda-key";
    const food = usdaFoodFixture();
    const client = new DryRunUsdaClient([food]);

    const result = await client.executeBounded({
      mode: "write",
      limit: 1,
      approvedSourceIds: [`USDA-FDC-${food.fdcId}`],
    });

    expect(result).toMatchObject({
      mode: "write",
      recordsFetched: 1,
      recordsTransformed: 1,
      recordsWritten: 0,
      recordsSkipped: 1,
      writtenSourceIds: [],
      rejectedSourceIds: [
        {
          sourceId: `USDA-FDC-${food.fdcId}`,
          reason: "Not writeable because the record is enrichment/reference data",
        },
      ],
    });
    expect(client.persistCalls).toBe(0);
  });

  it("reports duplicate approved writes as dedupe hits without inserting", async () => {
    const client = new DryRunFederalRegisterClient([federalRegisterDocument], {
      exists: true,
      existingId: "existing-source-1",
      hasChanged: false,
      contentHash: "same",
    });

    const result = await client.executeBounded({
      mode: "write",
      limit: 1,
      approvedSourceIds: [federalRegisterDocument.document_number],
    });

    expect(result).toMatchObject({
      mode: "write",
      recordsWritten: 0,
      dedupeHits: 1,
      writtenSourceIds: [],
      skippedSourceIds: [
        {
          sourceId: federalRegisterDocument.document_number,
          reason: "Not writeable because an unchanged duplicate already exists",
        },
      ],
    });
    expect(client.persistCalls).toBe(0);
  });

  it("includes human-review evidence fields in dry-run previews", async () => {
    const client = new DryRunFederalRegisterClient([federalRegisterDocument]);

    const result = await client.executeBounded({ mode: "dry_run", limit: 1 });

    expect(result.previews[0]).toMatchObject({
      source: "federal_register",
      sourceId: federalRegisterDocument.document_number,
      sourceType: "FDA_PROPOSED_RULE",
      title: federalRegisterDocument.title,
      sourceAgency: expect.stringContaining("Food and Drug Administration"),
      documentType: "PROPOSED RULE",
      sourceUrl: expect.stringContaining("federalregister.gov/documents"),
      rawPayloadHash: expect.stringMatching(/^[a-f0-9]{16}$/),
      relevanceDecision: {
        relevant: true,
        confidence: "high",
      },
      wouldWrite: true,
      writeBlockedReason: "Writeable after human review and explicit write-mode approval",
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
