// Cascada — SAP Business One Types
// Type definitions for the SAP B1 Service Layer REST API connector.

// ============================================================================
// SAP B1 API response types
// ============================================================================

/** SAP B1 Service Layer list response with pagination. */
export interface SapB1ListResponse<T> {
  value: T[];
  "odata.nextLink"?: string;
  "odata.count"?: number;
}

/** SAP B1 Item record (used for both ingredients and products). */
export interface SapB1Item {
  ItemCode: string;
  ItemName: string;
  ForeignName?: string;
  ItemType: string; // "itItems" | "itServices"
  ItemsGroupCode?: number;
  PurchaseItem?: string; // "tYES" | "tNO"
  SalesItem?: string;
  InventoryItem?: string;
  Active?: string; // "tYES" | "tNO"
  PurchaseUnit?: string;
  SalesUnit?: string;
  PurchaseQtyPerPackUnit?: number;
  SalesQtyPerPackUnit?: number;
  ManageBatchNumbers?: string;
  ManageSerialNumbers?: string;
  Valid?: string;
  ValidFrom?: string;
  ValidTo?: string;
  CostAccountCode?: string;
  InventoryAccount?: string;
  PurchaseAccount?: string;
  SaleAccount?: string;
  DefaultWarehouse?: string;
  PreferredVendor?: string;
  UoMGroupEntry?: number;
  DefaultPurchasingUoMEntry?: number;
  DefaultSalesUoMEntry?: number;
  ItemPrices?: SapB1ItemPrice[];
  PurchasingData?: SapB1PurchasingData;
  WarehouseInfo?: SapB1WarehouseInfo[];
  U_CAS_NUMBER?: string;
  U_E_NUMBER?: string;
  U_INGREDIENT_CATEGORY?: string;
  U_IS_SYNTHETIC?: string;
  U_SOURCE_TYPE?: string;
  U_ALLERGEN_FLAGS?: string;
  U_BRAND?: string;
  U_MARKETS?: string;
  U_RETAILERS?: string;
  UpdateDate?: string;
  UpdateTime?: string;
  CreateDate?: string;
  UDF?: Record<string, unknown>;
}

/** SAP B1 item pricing. */
export interface SapB1ItemPrice {
  PriceList: number;
  Price: number;
  Currency?: string;
}

/** SAP B1 item purchasing data. */
export interface SapB1PurchasingData {
  VendorCatalogNo?: string;
  PurchaseUnit?: string;
  LeadTime?: number;
  MinOrderQuantity?: number;
  OrderMultiple?: number;
  PurchasingUnit?: string;
}

/** SAP B1 warehouse info for an item. */
export interface SapB1WarehouseInfo {
  WarehouseCode: string;
  InStock?: number;
  Committed?: number;
  Ordered?: number;
  Available?: number;
}

/** SAP B1 Product Tree (BOM) record. */
export interface SapB1ProductTree {
  TreeCode: string;
  TreeName?: string;
  TreeType?: string; // "iTemplate" | "iSales" | "iProduction"
  Quantity?: number;
  Project?: string;
  PriceList?: number;
  UoMGroupEntry?: number;
  ProductTreeLines?: SapB1ProductTreeLine[];
  UpdateDate?: string;
  UpdateTime?: string;
}

/** SAP B1 Product Tree line item (BOM component). */
export interface SapB1ProductTreeLine {
  LineNum: number;
  ItemCode: string;
  Quantity: number;
  Warehouse?: string;
  IssueType?: string; // "im_Backflush" | "im_Manual"
  Comment?: string;
  UDF?: Record<string, unknown>;
}

/** SAP B1 Business Partner record (both customers and vendors). */
export interface SapB1BusinessPartner {
  CardCode: string;
  CardName: string;
  CardType: string; // "cCustomer" | "cSupplier" | "cLid"
  GroupCode?: number;
  Phone1?: string;
  Phone2?: string;
  Fax?: string;
  EmailAddress?: string;
  Website?: string;
  Currency?: string;
  Balance?: number;
  CreditLimit?: number;
  DiscountPercent?: number;
  PriceListNum?: number;
  FederalTaxID?: string;
  VATRegNum?: string;
  Active?: string; // "tYES" | "tNO"
  Addresses?: SapB1Address[];
  ContactEmployees?: SapB1ContactEmployee[];
  UDF?: Record<string, unknown>;
  UpdateDate?: string;
  UpdateTime?: string;
}

/** SAP B1 address. */
export interface SapB1Address {
  AddressName: string;
  Street?: string;
  Block?: string;
  City?: string;
  ZipCode?: string;
  State?: string;
  Country?: string;
  AddressType?: string; // "bo_BillTo" | "bo_ShipTo"
}

/** SAP B1 contact employee. */
export interface SapB1ContactEmployee {
  Name?: string;
  FirstName?: string;
  LastName?: string;
  Email?: string;
  Phone?: string;
  Position?: string;
}

// ============================================================================
// SAP B1 Auth types
// ============================================================================

/** SAP B1 authentication configuration. */
export interface SapB1AuthConfig {
  server: string;
  companyDb: string;
  username: string;
  password: string;
  baseUrl: string;
}

/** SAP B1 login response. */
export interface SapB1LoginResponse {
  SessionId: string;
  SessionTimeout: number;
  "odata.metadata"?: string;
}

/** SAP B1 error response. */
export interface SapB1ErrorResponse {
  error: {
    code: number;
    message: {
      lang: string;
      value: string;
    };
  };
}
