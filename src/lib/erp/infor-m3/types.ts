// Cascada — Infor CloudSuite M3 Types
// Type definitions for the Infor M3 MI (M3 Interface) API connector.

// ============================================================================
// Infor M3 API response types
// ============================================================================

/** Infor M3 MI API list response. */
export interface InforM3ListResponse<T> {
  results: T[];
  metadata: InforM3Metadata;
}

/** Infor M3 response metadata. */
export interface InforM3Metadata {
  totalCount?: number;
  hasMore?: boolean;
  nextOffset?: number;
  error?: { code: string; message: string };
}

/** Infor M3 Material Master (MMS002MI/GetMitmas) — ingredient and product item. */
export interface InforM3Item {
  MMITNO: string;     // Item number
  MMITDS: string;     // Item description
  MMFUDS: string;     // User-defined description
  MMITTY: string;     // Item type
  MMITCL: string;     // Item class
  MMBUYE: string;     // Buyer
  MMRESP: string;     // Responsible person
  MMUNMS: string;     // Unit of measure
  MMUNTI: string;     // Alternative UoM
  MMPUPR: number;     // Purchase price
  MMSAPR: number;     // Sales price
  MMSTQT: number;     // Stock quantity
  MMALQT: number;     // Allocated quantity
  MMORQT: number;     // On-order quantity
  MMDISF: string;     // Date format
  MMCFI1: string;     // Category 1
  MMCFI2: string;     // Category 2
  MMCFI3: string;     // Category 3
  MMCFI4: string;     // Category 4
  MMCFI5: string;     // Category 5
  CHDT: string;       // Change date
  CHRG: string;       // Changed by
  LMDT: string;       // Last modified date
  MMGRWE: number;     // Gross weight
  MMNEWE: number;     // Net weight
  MMVOUN: string;     // Volume unit
  MMPUUN: string;     // Purchase unit
  MMSAUN: string;     // Sales unit
  MMUNMU: number;     // UoM multiplier
  MMSTAT: string;     // Status
  MMABAT: string;     // ABC class
  MMSPEC: string;     // Special handling
  MMPRFA: string;     // Primary format
  MMPRGR: string;     // Product group
  MMTXID: string;     // Tax ID
  MMCUNO: string;     // Country of origin
  /** User-defined fields from M3 customizations */
  UDF?: Record<string, unknown>;
}

/** Infor M3 Product Structure (PDS001MI/GetMthdHead) — formulation/BOM. */
export interface InforM3ProductStructure {
  PDMTPN: string;     // Method number
  PDMTD5: string;     // Method description
  PDTYPE: string;     // Type
  PDPLGR: string;     // Planning group
  PDACTY: string;     // Activity
  PDQTYM: number;     // Qty per method
  PDMUCA: string;     // Manufacturing category
  PDRUNT: number;     // Run time
  PDSTRT: string;     // Status
  PDCUNO: string;     // Company
  PDFACI: string;     // Facility
  CHDT: string;
  LMDT: string;
  components?: InforM3BOMComponent[];
}

/** Infor M3 BOM component line. */
export interface InforM3BOMComponent {
  PDMTNO: string;     // Component item number
  PDQTYM: number;     // Component quantity
  PDALQT: number;     // Alternate quantity
  PDUNMS: string;     // Unit of measure
  PDPONO: number;     // Position number
  PDBYQT: number;     // By-product quantity
  PDSCRF: number;     // Scrap factor
  PDWTPC: string;     // Warehouse
  PDTYPE: string;     // Type
}

/** Infor M3 Customer (CRS610MI/GetCustHead). */
export interface InforM3Customer {
  OKCUNO: string;     // Customer number
  OKCUNM: string;     // Customer name
  OKCUA1: string;     // Address line 1
  OKCUA2: string;     // Address line 2
  OKCUA3: string;     // Address line 3
  OKPONO: string;     // Postal code
  OKCSCD: string;     // Country code
  OKCUTX: string;     // Tax ID
  OKYOCD: string;     // Your customer ID
  OKPHNO: string;     // Phone number
  OKTFNO: string;     // Fax number
  OKTEMO: string;     // Email
  OKCUTP: string;     // Customer type
  OKSMCD: string;     // Salesperson
  OKPYTM: string;     // Payment terms
  OKCDTY: string;     // Customer discount type
  OKSTAT: string;     // Status
  CHDT: string;
  LMDT: string;
  UDF?: Record<string, unknown>;
}

/** Infor M3 Supplier (CRS620MI/GetSupHead). */
export interface InforM3Supplier {
  OKSUNO: string;     // Supplier number
  OKSUNM: string;     // Supplier name
  OKSUAD: string;     // Address
  OKPONO: string;     // Postal code
  OKCSCD: string;     // Country code
  OKSUTX: string;     // Tax ID
  OKPHNO: string;     // Phone number
  OKTFNO: string;     // Fax number
  OKTEMO: string;     // Email
  OKSUTP: string;     // Supplier type
  OKSMCD: string;     // Buyer
  OKPYTM: string;     // Payment terms
  OKSTAT: string;     // Status
  CHDT: string;
  LMDT: string;
  UDF?: Record<string, unknown>;
}

// ============================================================================
// Infor M3 Auth types
// ============================================================================

/** Infor M3 OAuth2 authentication configuration. */
export interface InforM3AuthConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  organization: string;
  baseUrl: string;
}

/** Infor M3 OAuth2 token response. */
export interface InforM3TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

/** Infor M3 API error response. */
export interface InforM3ErrorResponse {
  message: string;
  code?: number;
  target?: string;
  details?: Array<{
    code: string;
    message: string;
    target?: string;
  }>;
}
