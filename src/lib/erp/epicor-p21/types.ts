// Cascada — Epicor Prophet 21 Types
// Type definitions for the Epicor P21 REST API connector.

// ============================================================================
// Epicor P21 API response types
// ============================================================================

/** Epicor P21 REST API list response. */
export interface EpicorP21ListResponse<T> {
  Items: T[];
  TotalCount?: number;
  HasMore?: boolean;
  NextPageLink?: string;
}

/** Epicor P21 Inventory Item (ingredient and product). */
export interface EpicorP21Item {
  id: number;
  item_id: string;
  item_desc: string;
  extended_desc?: string;
  product_group?: string;
  commodity_code?: string;
  unit_of_measure?: string;
  list_price?: number;
  average_cost?: number;
  std_cost?: number;
  qty_on_hand?: number;
  qty_allocated?: number;
  qty_available?: number;
  qty_on_order?: number;
  weight?: number;
  weight_unit?: string;
  volume?: number;
  volume_unit?: string;
  upc_code?: string;
  manufacturer?: string;
  manufacturer_part_no?: string;
  country_of_origin?: string;
  hazmat?: boolean;
  inactive?: boolean;
  last_update_date?: string;
  create_date?: string;
  last_cost_date?: string;
  buyer_code?: string;
  primary_vendor_id?: string;
  lead_time_days?: number;
  min_order_qty?: number;
  max_order_qty?: number;
  order_multiple?: number;
  reorder_point?: number;
  safety_stock?: number;
  /** Custom fields via Epicor P21 Extended Properties */
  UDF?: Record<string, unknown>;
}

/** Epicor P21 BOM (Bill of Materials) — formulation. */
export interface EpicorP21BOM {
  id: number;
  bom_id: string;
  bom_desc?: string;
  parent_item_id: string;
  bom_type?: string;
  effective_date?: string;
  obsolete_date?: string;
  status?: string;
  last_update_date?: string;
  components?: EpicorP21BOMComponent[];
}

/** Epicor P21 BOM component. */
export interface EpicorP21BOMComponent {
  id: number;
  component_item_id: string;
  component_desc?: string;
  quantity: number;
  unit_of_measure?: string;
  sequence?: number;
  alternate?: boolean;
  replaces_item_id?: string;
  scrap_factor?: number;
  warehouse?: string;
  effective_date?: string;
  obsolete_date?: string;
}

/** Epicor P21 Customer record. */
export interface EpicorP21Customer {
  id: number;
  customer_id: string;
  customer_name: string;
  customer_type?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  fax?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  credit_limit?: number;
  balance?: number;
  terms_code?: string;
  sales_rep?: string;
  inactive?: boolean;
  last_update_date?: string;
  UDF?: Record<string, unknown>;
}

/** Epicor P21 Vendor (supplier) record. */
export interface EpicorP21Vendor {
  id: number;
  vendor_id: string;
  vendor_name: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  fax?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  terms_code?: string;
  buyer_code?: string;
  inactive?: boolean;
  last_update_date?: string;
  lead_time_days?: number;
  UDF?: Record<string, unknown>;
}

// ============================================================================
// Epicor P21 Auth types
// ============================================================================

/** Epicor P21 API authentication configuration. */
export interface EpicorP21AuthConfig {
  server: string;
  company: string;
  username: string;
  password: string;
  baseUrl: string;
}

/** Epicor P21 session response. */
export interface EpicorP21SessionResponse {
  SessionId: string;
  Company: string;
  UserName: string;
  ExpiresAt?: string;
}

/** Epicor P21 error response. */
export interface EpicorP21ErrorResponse {
  HttpStatus: number;
  Message: string;
  ErrorType: string;
  Details?: string;
}
