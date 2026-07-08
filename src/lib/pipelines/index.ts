// Cascada — Pipeline Module Exports
// Central export point for all pipeline-related modules.

// Base infrastructure
export { BasePipelineClient } from "./base-client";
export { PipelineOrchestrator, pipelineOrchestrator } from "./orchestrator";
export { getPipelineCredentialStatus } from "./credentials";

// Types
export type {
  PipelineType,
  PipelineRunStatus,
  PipelineRunContext,
  PipelineExecutionResult,
  PipelineRecordError,
  PipelineFetchResult,
  DeduplicationCheck,
  PipelineSourceConfig,
  PipelineSchedule,
  IPipelineClient,
  PipelineRequestOptions,
  PipelineResponse,
  RateLimitConfig,
  RateLimitState,
  RetryConfig,
  TransformedRegulatorySource,
} from "./types";
export {
  PIPELINE_TYPES,
  DEFAULT_RETRY_CONFIG,
  FOOD_RELEVANCE_KEYWORDS,
  STATE_CODE_TO_JURISDICTION,
  LEGISCAN_STATUS_MAP,
} from "./types";

// LegiScan pipeline
export { LegiScanClient, legiScanClient } from "./legiscan/client";
export {
  transformBillDetail,
  transformSearchResult,
  transformMasterListBill,
  mapBillStatusToSourceStatus,
  mapStateToJurisdiction,
  determineSourceType as determineLegiScanSourceType,
  parseLegiScanDate,
  generateBillName,
} from "./legiscan/transforms";
export type {
  LegiScanOperation,
  LegiScanApiResponse,
  LegiScanSearchParams,
  LegiScanSearchResultItem,
  LegiScanSearchResults,
  LegiScanMasterListBill,
  LegiScanMasterListResult,
  LegiScanBillDetail,
  LegiScanBillText,
  LegiScanSession,
  LegiScanSessionList,
} from "./legiscan/types";
export { LEGISCAN_FOOD_QUERIES, LEGISCAN_BILL_STATUS } from "./legiscan/types";

// openFDA pipeline
export { OpenFdaClient, openFdaClient } from "./openfda/client";
export {
  transformEnforcementRecord,
  transformGrasNotice,
  transformAdditivePetition,
  transformColorAdditive,
  parseOpenFdaDate,
  determineFdaJurisdiction,
  determineFdaSourceType,
  determineEnforcementStatus,
} from "./openfda/transforms";
export type {
  OpenFdaMeta,
  OpenFdaApiResponse,
  OpenFdaFoodEnforcement,
  OpenFdaGrasNotice,
  OpenFdaFoodFacility,
  OpenFdaFoodAdditivePetition,
  OpenFdaColorAdditive,
  OpenFdaSearchParams,
  OpenFdaEndpoint,
} from "./openfda/types";
export {
  OPENFDA_ENFORCEMENT_QUERIES,
  OPENFDA_ENDPOINTS,
  FDA_CLASSIFICATION,
} from "./openfda/types";

// Federal Register pipeline
export { FederalRegisterClient, federalRegisterClient } from "./federal-register/client";
export {
  transformFederalRegisterDocument,
  parseFederalRegisterDate,
  mapDocumentTypeToSourceType as mapFrDocTypeToSourceType,
  determineFederalRegisterStatus,
} from "./federal-register/transforms";
export type {
  FederalRegisterSearchResponse,
  FederalRegisterDocumentResponse,
  FederalRegisterDocument,
  FederalRegisterDocumentType,
  FederalRegisterAgency,
  FederalRegisterSearchParams,
} from "./federal-register/types";
export {
  FDA_RELATED_AGENCIES,
  FEDERAL_REGISTER_FOOD_CONDITIONS,
  FR_DOC_TYPE_TO_SOURCE_TYPE,
} from "./federal-register/types";

// USDA FoodData Central pipeline
export { UsdaClient, usdaClient } from "./usda/client";
export {
  transformUsdaFoodItem,
  transformUsdaItemForIngredientMatch,
  parseUsdaDate,
} from "./usda/transforms";
export type {
  UsdaSearchResponse,
  UsdaFoodListResponse,
  UsdaFoodItem,
  UsdaNutrient,
  UsdaFoodComponent,
  UsdaFoodAttribute,
  UsdaLangualFactor,
  UsdaNutrientConversionFactor,
  UsdaInputFood,
  UsdaSurveyFndds,
  UsdaWweiaFoodCategory,
  UsdaFoodPortion,
  UsdaDataType,
  UsdaSearchParams,
} from "./usda/types";
export {
  USDA_MANUFACTURING_CATEGORIES,
  USDA_INGREDIENT_QUERIES,
} from "./usda/types";
