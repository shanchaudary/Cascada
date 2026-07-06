// Cascada — NetSuite ERP Types
// Type definitions for the NetSuite SuiteTalk REST API connector.

// ============================================================================
// NetSuite API response types
// ============================================================================

/** NetSuite REST API list response wrapper. */
export interface NetSuiteListResponse<T> {
  items: T[];
  totalResults: number;
  hasMore: boolean;
  offset: number;
  links: NetSuiteLink[];
}

/** NetSuite pagination link. */
export interface NetSuiteLink {
  rel: string;
  href: string;
}

/** NetSuite inventory item (ingredient) record. */
export interface NetSuiteInventoryItem {
  id: string;
  itemId: string;
  displayName: string;
  purchaseDescription?: string;
  salesDescription?: string;
  isInactive: boolean;
  type: string;
  subsidiary?: string[];
  cost?: number;
  basePrice?: number;
  stockUnit?: string;
  purchaseUnit?: string;
  saleUnit?: string;
  matrixType?: string;
  customForm?: string;
  createdDate?: string;
  lastModifiedDate?: string;
  useBins?: boolean;
  autoPreferredStockLevel?: boolean;
  isLotItem?: boolean;
  isSerialItem?: boolean;
  weight?: number;
  weightUnit?: string;
  upcCode?: string;
  manufacturer?: string;
  manufacturerAddr1?: string;
  manufacturerCity?: string;
  manufacturerState?: string;
  manufacturerZip?: string;
  countryOfManufacture?: string;
  scheduleBCode?: string;
  scheduleBQuantity?: number;
  scheduleBUnit?: string;
  customsDescription?: string;
  customsValue?: number;
  harmonizedCode?: string;
  exportControlClassificationNumber?: string;
  shipIndividually?: boolean;
  isHazmatItem?: boolean;
  hazmatId?: string;
  hazmatShippingName?: string;
  hazmatHazardClass?: string;
  hazmatPackingGroup?: string;
  location?: string;
  preferredLocation?: string;
  vendor?: NetSuiteEntityRef;
  vendorCode?: string;
  vendorCost?: number;
  vendorCurrency?: string;
  reorderPoint?: number;
  preferredStockLevel?: number;
  leadTime?: number;
  supplyType?: string;
  supplyLotSizingMethod?: string;
  alternateDemandSource?: string;
  demandTimeFence?: number;
  supplyTimeFence?: number;
  autoReorderPoint?: boolean;
  storeDisplayName?: string;
  itemTaskType?: string;
  costingMethod?: string;
  costingMethodDisplay?: string;
  includeChildren?: boolean;
  overallQuantityPricingStrategy?: string;
  pricingGroup?: string;
  minimumQuantity?: number;
  maximumQuantity?: number;
  softDescriptor?: string;
  pricesIncludeTax?: boolean;
  quantityPricingSchedule?: string;
  useMarginalRates?: boolean;
  taxable?: boolean;
  isTaxable?: boolean;
  taxSchedule?: string;
  deferredRevenueAccount?: string;
  revenueRecognitionRule?: string;
  revRecForecastRule?: string;
  revenueAllocationGroup?: string;
  createRevenuePlansOn?: string;
  directRevenuePosting?: boolean;
  isFulfillable?: boolean;
  trackLandedCost?: boolean;
  landedCostCategory?: string;
  accountingBookDetail?: NetSuiteAccountingBookDetail[];
  department?: string;
  class_?: string;
  customFields?: Record<string, unknown>;
}

/** NetSuite entity reference (used for vendor, customer, etc.). */
export interface NetSuiteEntityRef {
  id: string;
  refName: string;
}

/** NetSuite accounting book detail. */
export interface NetSuiteAccountingBookDetail {
  accountingBook: NetSuiteEntityRef;
  createRevenuePlansOn: string;
  revenueRecognitionRule: string;
  revRecForecastRule: string;
}

/** NetSuite assembly item (formulation/BOM) record. */
export interface NetSuiteAssemblyItem {
  id: string;
  itemId: string;
  displayName: string;
  isInactive: boolean;
  billOfMaterials?: NetSuiteEntityRef;
  billOfMaterialsRevision?: string;
  costingMethod?: string;
  buildEntireAssembly?: boolean;
  bomQuantity?: number;
  memberList?: NetSuiteAssemblyMember[];
  customForm?: string;
  createdDate?: string;
  lastModifiedDate?: string;
  customFields?: Record<string, unknown>;
}

/** NetSuite assembly member (BOM line item). */
export interface NetSuiteAssemblyMember {
  item: NetSuiteEntityRef;
  quantity: number;
  unit?: string;
  bomQuantity?: number;
  description?: string;
  effectiveDate?: string;
  obsoleteDate?: string;
  sequence?: number;
}

/** NetSuite customer record. */
export interface NetSuiteCustomer {
  id: string;
  entityId: string;
  companyName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  isInactive: boolean;
  customerType?: string;
  terms?: NetSuiteEntityRef;
  subsidiary?: NetSuiteEntityRef[];
  currency?: NetSuiteEntityRef;
  creditLimit?: number;
  balance?: number;
  overdueBalance?: number;
  daySalesOutstanding?: number;
  createdDate?: string;
  lastModifiedDate?: string;
  shippingItem?: NetSuiteEntityRef;
  salesRep?: NetSuiteEntityRef;
  customFields?: Record<string, unknown>;
}

/** NetSuite vendor (supplier) record. */
export interface NetSuiteVendor {
  id: string;
  entityId: string;
  companyName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  isInactive: boolean;
  terms?: NetSuiteEntityRef;
  subsidiary?: NetSuiteEntityRef[];
  currency?: NetSuiteEntityRef;
  creditLimit?: number;
  balance?: number;
  createdDate?: string;
  lastModifiedDate?: string;
  customFields?: Record<string, unknown>;
}

/** NetSuite assembly build (production run / product) record. */
export interface NetSuiteAssemblyBuild {
  id: string;
  item: NetSuiteEntityRef;
  quantity: number;
  units?: string;
  lotNumber?: string;
  status: string;
  buildDate: string;
  completionDate?: string;
  billOfMaterials?: NetSuiteEntityRef;
  billOfMaterialsRevision?: string;
  subsidiary?: NetSuiteEntityRef;
  location?: NetSuiteEntityRef;
  createdDate?: string;
  lastModifiedDate?: string;
  customFields?: Record<string, unknown>;
}

// ============================================================================
// NetSuite auth types
// ============================================================================

/** NetSuite OAuth 1.0 token-based authentication configuration. */
export interface NetSuiteTokenAuthConfig {
  accountId: string;
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
  baseUrl: string;
}

/** NetSuite OAuth 1.0 signature parameters. */
export interface NetSuiteOAuthParams {
  oauth_consumer_key: string;
  oauth_token: string;
  oauth_signature_method: string;
  oauth_timestamp: string;
  oauth_nonce: string;
  oauth_version: string;
  oauth_signature: string;
}

/** NetSuite REST API error response. */
export interface NetSuiteErrorResponse {
  type: string;
  title: string;
  status: number;
  oErrorCode: string;
  detail: string;
  oErrorDetails: Array<{
    detail: string;
    oErrorCode: string;
  }>;
}
