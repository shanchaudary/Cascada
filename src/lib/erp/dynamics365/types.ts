// Cascada — Dynamics 365 Business Central Types
// Type definitions for the D365 BC API connector.

// ============================================================================
// D365 BC API response types
// ============================================================================

/** D365 BC OData v4 list response. */
export interface D365ListResponse<T> {
  value: T[];
  "@odata.nextLink"?: string;
  "@odata.count"?: number;
}

/** D365 BC Item record (ingredients and products). */
export interface D365Item {
  id: string;
  number: string;
  displayName: string;
  type: string; // "Inventory" | "Service" | "Non-Inventory"
  itemCategoryCode?: string;
  baseUnitOfMeasure?: string;
  inventory?: number;
  unitPrice?: number;
  unitCost?: number;
  blocked: boolean;
  lastModifiedDateTime?: string;
  gtin?: string;
  itemTrackingCode?: string;
  manufacturerCode?: string;
  purchasingBlocked?: boolean;
  salesBlocked?: boolean;
  inventoryPostingGroup?: string;
  costingMethod?: string;
  costIncludesSetup?: boolean;
  overheadRate?: number;
  profitPercentage?: number;
  indirectCostPercentage?: number;
  replenishmentSystem?: string;
  leadTimeCalculation?: string;
  reorderPoint?: number;
  maximumInventory?: number;
  reorderQuantity?: number;
  safetyStockQuantity?: number;
  lotSize?: number;
  critical?: boolean;
  assemblyBOM?: boolean;
  picture?: Array<{ id: string; width: number; height: number; contentType: string }>;
  defaultProductionOrderRouting?: string;
  UoMGroup?: string;
  casNumber?: string;
  eNumber?: string;
  ingredientCategory?: string;
  isSynthetic?: boolean;
  sourceType?: string;
  allergenFlags?: string;
  brand?: string;
  markets?: string;
  retailers?: string;
}

/** D365 BC Production BOM (formulation). */
export interface D365ProductionBOM {
  id: string;
  number: string;
  description?: string;
  status: string; // "New" | "Under Development" | "Certified" | "Closed"
  lastModifiedDateTime?: string;
  productionBOMLines?: D365ProductionBOMLine[];
}

/** D365 BC Production BOM line item. */
export interface D365ProductionBOMLine {
  id: string;
  lineNumber: number;
  type: string; // "Item" | "Production BOM"
  no: string;
  description?: string;
  quantityPer: number;
  unitOfMeasureCode?: string;
}

/** D365 BC Customer record. */
export interface D365Customer {
  id: string;
  number: string;
  displayName: string;
  type: string; // "Company" | "Person"
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  balance?: number;
  creditLimit?: number;
  blocked: string; // " " | "Ship" | "Invoice" | "All"
  paymentTermsCode?: string;
  salespersonCode?: string;
  customerPostingGroup?: string;
  customerPriceGroup?: string;
  lastModifiedDateTime?: string;
}

/** D365 BC Vendor record. */
export interface D365Vendor {
  id: string;
  number: string;
  displayName: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  balance?: number;
  blocked: string; // " " | "Payment" | "All"
  paymentTermsCode?: string;
  vendorPostingGroup?: string;
  lastModifiedDateTime?: string;
}

// ============================================================================
// D365 BC Auth types
// ============================================================================

/** D365 BC OAuth2 authentication configuration. */
export interface D365AuthConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  environment: string;
  companyId: string;
  baseUrl: string;
}

/** D365 BC OAuth2 token response. */
export interface D365TokenResponse {
  token_type: string;
  expires_in: number;
  ext_expires_in: number;
  access_token: string;
}

/** D365 BC error response. */
export interface D365ErrorResponse {
  error: {
    code: string;
    message: string;
    target?: string;
    details?: Array<{
      code: string;
      message: string;
      target?: string;
    }>;
  };
}
