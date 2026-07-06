// Cascada — ERP Connector Barrel Exports
// Central export point for all ERP connector modules.
// Also contains the connector factory for creating instances by ErpType.

import type { ErpType } from "@prisma/client";
import type { ErpConnectorParams } from "./types";
import { BaseErpConnector } from "./base-connector";
import { ErpSyncEngine } from "./sync-engine";
import { ErpConnectionError } from "../errors";
import { NetSuiteConnector } from "./netsuite/connector";
import { SapB1Connector } from "./sap-b1/connector";
import { Dynamics365Connector } from "./dynamics365/connector";
import { InforM3Connector } from "./infor-m3/connector";
import { EpicorP21Connector } from "./epicor-p21/connector";

// Re-export all shared types
export type {
  ErpHttpClientConfig,
  ErpRequestOptions,
  ErpRawResponse,
  ErpPaginatedResponse,
  ErpPaginationParams,
  ErpRateLimitState,
  ErpAuthState,
  ErpConnectorParams,
  ErpDetailedHealthStatus,
  SyncExecutionContext,
  ConflictResolutionStrategy,
  SyncConflict,
  ConflictResolutionResult,
  FieldTransformResult,
  FieldTransformContext,
  ErpRateLimitConfig,
  ErpTypeSyncConfig,
} from "./types";

export { ERP_RATE_LIMITS, ERP_SYNC_DEFAULTS } from "./types";

// Re-export base connector and sync engine
export { BaseErpConnector } from "./base-connector";
export { ErpSyncEngine } from "./sync-engine";

// Re-export all connector classes
export { NetSuiteConnector, SapB1Connector, Dynamics365Connector, InforM3Connector, EpicorP21Connector };

// Re-export auth utilities
export { generateAuthHeader, validateNetSuiteAuthConfig, buildNetSuiteBaseUrl } from "./netsuite/auth";
export { loginToSapB1, logoutFromSapB1, validateSapB1AuthConfig, buildSapB1BaseUrl } from "./sap-b1/auth";
export { acquireD365Token, validateD365AuthConfig, buildD365BaseUrl } from "./dynamics365/auth";
export { acquireInforM3Token, validateInforM3AuthConfig, buildInforM3BaseUrl } from "./infor-m3/auth";
export { createEpicorP21Session, deleteEpicorP21Session, validateEpicorP21AuthConfig, buildEpicorP21BaseUrl } from "./epicor-p21/auth";

// Re-export mapping functions
export { mapNetSuiteIngredient, mapNetSuiteFormulation, mapNetSuiteProduct, mapNetSuiteCustomer, mapNetSuiteVendor } from "./netsuite/mappings";
export { mapSapB1Ingredient, mapSapB1Formulation, mapSapB1Product, mapSapB1Customer, mapSapB1Supplier } from "./sap-b1/mappings";
export { mapD365Ingredient, mapD365Formulation, mapD365Product, mapD365Customer, mapD365Supplier } from "./dynamics365/mappings";
export { mapInforM3Ingredient, mapInforM3Formulation, mapInforM3Product, mapInforM3Customer, mapInforM3Supplier } from "./infor-m3/mappings";
export { mapEpicorP21Ingredient, mapEpicorP21Formulation, mapEpicorP21Product, mapEpicorP21Customer, mapEpicorP21Supplier } from "./epicor-p21/mappings";

// ============================================================================
// Connector Factory
// ============================================================================

/**
 * Create an ERP connector instance based on the ErpType.
 * This is the single entry point for creating connector instances.
 *
 * @param params - Connection parameters including erpType
 * @returns Instantiated connector of the appropriate type
 * @throws ErpConnectionError if the erpType is unknown
 */
export function createConnectorByType(params: ErpConnectorParams): BaseErpConnector {
  switch (params.erpType) {
    case "NETSUITE":
      return new NetSuiteConnector(params);
    case "SAP_B1":
      return new SapB1Connector(params);
    case "DYNAMICS_365_BC":
      return new Dynamics365Connector(params);
    case "INFOR_M3":
      return new InforM3Connector(params);
    case "EPICOR_P21":
      return new EpicorP21Connector(params);
    default:
      throw new ErpConnectionError(
        params.erpType,
        `Unknown ERP type: ${String(params.erpType)}. Supported types: NETSUITE, SAP_B1, DYNAMICS_365_BC, INFOR_M3, EPICOR_P21`,
        { erpType: params.erpType }
      );
  }
}

/**
 * Get the list of supported ERP types.
 */
export function getSupportedErpTypes(): ErpType[] {
  return ["NETSUITE", "SAP_B1", "DYNAMICS_365_BC", "INFOR_M3", "EPICOR_P21"];
}

/**
 * Validate that an ERP type is supported.
 */
export function isSupportedErpType(erpType: string): erpType is ErpType {
  return ["NETSUITE", "SAP_B1", "DYNAMICS_365_BC", "INFOR_M3", "EPICOR_P21"].includes(erpType);
}
