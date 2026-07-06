// Cascada — NetSuite Field Mappings
// Maps NetSuite API field names to our internal entity fields.
// These are the default mappings; customers can override via FieldMappingConfig.

import type { FieldMapping } from "../../../types/erp";
import type {
  NetSuiteInventoryItem,
  NetSuiteAssemblyItem,
  NetSuiteAssemblyBuild,
  NetSuiteCustomer,
  NetSuiteVendor,
  NetSuiteAssemblyMember,
} from "./types";
import type {
  ErpIngredient,
  ErpFormulation,
  ErpFormulationItem,
  ErpProduct,
  ErpCustomer,
  ErpSupplier,
  FieldTransformResult,
} from "../types";

// ============================================================================
// Default field mappings: NetSuite → Cascada
// ============================================================================

/** Default ingredient field mappings from NetSuite inventory items. */
export const NETSUITE_INGREDIENT_MAPPINGS: FieldMapping[] = [
  { localField: "erpId", erpField: "itemId", required: true },
  { localField: "name", erpField: "displayName", transform: "trim", required: true },
  { localField: "casNumber", erpField: "customFields.custitem_cas_number", required: false },
  { localField: "eenumber", erpField: "customFields.custitem_e_number", required: false },
  { localField: "category", erpField: "customFields.custitem_ingredient_category", required: false },
  { localField: "isSynthetic", erpField: "customFields.custitem_is_synthetic", transform: "none", required: false },
  { localField: "sourceType", erpField: "customFields.custitem_source_type", required: false },
  { localField: "unitOfMeasure", erpField: "stockUnit", required: false },
  { localField: "costPerUnit", erpField: "cost", transform: "parse_number", required: false },
];

/** Default product field mappings from NetSuite assembly builds. */
export const NETSUITE_PRODUCT_MAPPINGS: FieldMapping[] = [
  { localField: "erpId", erpField: "id", required: true },
  { localField: "name", erpField: "item.refName", transform: "trim", required: true },
  { localField: "sku", erpField: "item.id", required: true },
  { localField: "isActive", erpField: "isInactive", transform: "none", required: false },
  { localField: "annualVolume", erpField: "quantity", transform: "parse_number", required: false },
  { localField: "category", erpField: "customFields.custitem_product_category", required: false },
  { localField: "brand", erpField: "customFields.custitem_brand", required: false },
];

/** Default customer field mappings from NetSuite customers. */
export const NETSUITE_CUSTOMER_MAPPINGS: FieldMapping[] = [
  { localField: "erpId", erpField: "id", required: true },
  { localField: "name", erpField: "companyName", transform: "trim", required: true },
  { localField: "contactEmail", erpField: "email", required: false },
  { localField: "type", erpField: "customerType", required: true },
];

/** Default supplier field mappings from NetSuite vendors. */
export const NETSUITE_SUPPLIER_MAPPINGS: FieldMapping[] = [
  { localField: "erpId", erpField: "id", required: true },
  { localField: "name", erpField: "companyName", transform: "trim", required: true },
  { localField: "contactEmail", erpField: "email", required: false },
];

// ============================================================================
// Mapping functions — transform raw NetSuite records to internal types
// ============================================================================

/**
 * Map a NetSuite inventory item to an ErpIngredient.
 * Handles the deeply nested NetSuite response structure and custom fields.
 */
export function mapNetSuiteIngredient(
  raw: NetSuiteInventoryItem
): FieldTransformResult<ErpIngredient> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpIngredient>["transformErrors"] = [];

  const ingredient: ErpIngredient = {
    erpId: raw.itemId ?? String(raw.id),
    name: raw.displayName ?? raw.purchaseDescription ?? raw.itemId,
    alternateNames: extractAlternateNames(raw),
    casNumber: extractCustomField(raw.customFields, "custitem_cas_number"),
    eenumber: extractCustomField(raw.customFields, "custitem_e_number"),
    category: extractCustomField(raw.customFields, "custitem_ingredient_category"),
    isSynthetic: String(extractCustomField(raw.customFields, "custitem_is_synthetic")) === "true",
    sourceType: extractCustomField(raw.customFields, "custitem_source_type"),
    allergenFlags: extractAllergenFlags(raw.customFields),
    supplierIds: raw.vendor ? [raw.vendor.id] : [],
    unitOfMeasure: raw.stockUnit ?? raw.purchaseUnit,
    costPerUnit: raw.cost ?? undefined,
    metadata: {
      netsuiteId: raw.id,
      isInactive: raw.isInactive,
      isLotItem: raw.isLotItem ?? false,
      isSerialItem: raw.isSerialItem ?? false,
      manufacturer: raw.manufacturer,
      countryOfManufacture: raw.countryOfManufacture,
      upcCode: raw.upcCode,
      weight: raw.weight,
      weightUnit: raw.weightUnit,
      lastModifiedDate: raw.lastModifiedDate,
    },
  };

  return { data: ingredient, unmappedFields, transformErrors };
}

/**
 * Map a NetSuite assembly item to an ErpFormulation with its BOM items.
 */
export function mapNetSuiteFormulation(
  raw: NetSuiteAssemblyItem
): FieldTransformResult<ErpFormulation> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpFormulation>["transformErrors"] = [];

  const items: ErpFormulationItem[] = (raw.memberList ?? []).map(
    (member: NetSuiteAssemblyMember, index: number) => ({
      ingredientErpId: member.item?.id ?? "",
      quantity: member.quantity ?? 0,
      unit: member.unit ?? "kg",
      percentage: undefined,
      isAlternate: false,
      replacesIngredientErpId: undefined,
      sortOrder: member.sequence ?? index,
    })
  );

  const formulation: ErpFormulation = {
    erpId: raw.itemId ?? String(raw.id),
    name: raw.displayName ?? raw.itemId,
    description: `NetSuite Assembly BOM: ${raw.itemId}`,
    version: 1,
    status: raw.isInactive ? "ARCHIVED" : "ACTIVE",
    batchSize: raw.bomQuantity ?? 1,
    batchSizeUnit: "units",
    items,
    totalCost: undefined,
  };

  return { data: formulation, unmappedFields, transformErrors };
}

/**
 * Map a NetSuite assembly build to an ErpProduct.
 */
export function mapNetSuiteProduct(
  raw: NetSuiteAssemblyBuild,
  assemblies: Map<string, string>
): FieldTransformResult<ErpProduct> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpProduct>["transformErrors"] = [];

  const formulationErpIds: string[] = [];
  if (raw.billOfMaterials) {
    formulationErpIds.push(raw.billOfMaterials.id);
  }

  const product: ErpProduct = {
    erpId: String(raw.id),
    name: raw.item?.refName ?? `Product-${raw.id}`,
    sku: raw.item?.id ?? `SKU-${raw.id}`,
    category: extractCustomField(raw.customFields, "custitem_product_category"),
    brand: extractCustomField(raw.customFields, "custitem_brand"),
    markets: extractCustomFieldArray(raw.customFields, "custitem_markets"),
    retailers: extractCustomFieldArray(raw.customFields, "custitem_retailers"),
    isActive: raw.status === "built" || raw.status === "completed",
    annualVolume: raw.quantity ?? undefined,
    annualRevenue: undefined,
    formulationErpIds,
  };

  return { data: product, unmappedFields, transformErrors };
}

/**
 * Map a NetSuite customer to an ErpCustomer.
 */
export function mapNetSuiteCustomer(
  raw: NetSuiteCustomer
): FieldTransformResult<ErpCustomer> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpCustomer>["transformErrors"] = [];

  const customer: ErpCustomer = {
    erpId: raw.entityId ?? String(raw.id),
    name: raw.companyName ?? `${raw.firstName ?? ""} ${raw.lastName ?? ""}`.trim(),
    type: mapNetSuiteCustomerType(raw.customerType),
    requirements: raw.customFields ?? {},
    contactEmail: raw.email ?? undefined,
    productErpIds: extractCustomFieldArray(raw.customFields, "custentity_assigned_products"),
  };

  return { data: customer, unmappedFields, transformErrors };
}

/**
 * Map a NetSuite vendor to an ErpSupplier.
 */
export function mapNetSuiteVendor(
  raw: NetSuiteVendor
): FieldTransformResult<ErpSupplier> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpSupplier>["transformErrors"] = [];

  const supplier: ErpSupplier = {
    erpId: raw.entityId ?? String(raw.id),
    name: raw.companyName ?? `${raw.firstName ?? ""} ${raw.lastName ?? ""}`.trim(),
    contactEmail: raw.email ?? undefined,
    certifications: extractCustomFieldArray(raw.customFields, "custentity_certifications"),
    ingredientErpIds: extractCustomFieldArray(raw.customFields, "custentity_supplied_ingredients"),
    riskScore: extractCustomFieldNumber(raw.customFields, "custentity_supplier_risk_score"),
  };

  return { data: supplier, unmappedFields, transformErrors };
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Extract a value from NetSuite custom fields by field ID.
 */
function extractCustomField(
  customFields: Record<string, unknown> | undefined,
  fieldId: string
): string | undefined {
  if (!customFields) return undefined;
  const value = customFields[fieldId];
  if (value === null || value === undefined) return undefined;
  return String(value);
}

/**
 * Extract an array value from NetSuite custom fields.
 */
function extractCustomFieldArray(
  customFields: Record<string, unknown> | undefined,
  fieldId: string
): string[] {
  if (!customFields) return [];
  const value = customFields[fieldId];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.length > 0) {
    return value.split(",").map((s: string) => s.trim());
  }
  return [];
}

/**
 * Extract a number value from NetSuite custom fields.
 */
function extractCustomFieldNumber(
  customFields: Record<string, unknown> | undefined,
  fieldId: string
): number | undefined {
  if (!customFields) return undefined;
  const value = customFields[fieldId];
  if (value === null || value === undefined) return undefined;
  const num = Number(value);
  return Number.isNaN(num) ? undefined : num;
}

/**
 * Extract alternate names from a NetSuite inventory item.
 * Looks at purchase description, sales description, and custom fields.
 */
function extractAlternateNames(raw: NetSuiteInventoryItem): string[] {
  const names: string[] = [];
  if (raw.purchaseDescription && raw.purchaseDescription !== raw.displayName) {
    names.push(raw.purchaseDescription);
  }
  if (raw.salesDescription && raw.salesDescription !== raw.displayName && raw.salesDescription !== raw.purchaseDescription) {
    names.push(raw.salesDescription);
  }
  const altName = extractCustomField(raw.customFields, "custitem_alternate_name");
  if (altName) names.push(altName);
  return names;
}

/**
 * Extract allergen flags from NetSuite custom fields.
 */
function extractAllergenFlags(
  customFields: Record<string, unknown> | undefined
): string[] {
  if (!customFields) return [];
  const flags: string[] = [];

  const allergenFields = [
    "custitem_allergen_dairy",
    "custitem_allergen_soy",
    "custitem_allergen_gluten",
    "custitem_allergen_nuts",
    "custitem_allergen_peanuts",
    "custitem_allergen_eggs",
    "custitem_allergen_fish",
    "custitem_allergen_shellfish",
    "custitem_allergen_sesame",
  ];

  for (const field of allergenFields) {
    if (customFields[field] === true || customFields[field] === "true") {
      // Extract the allergen name from the field ID
      const allergen = field.replace("custitem_allergen_", "");
      flags.push(allergen);
    }
  }

  return flags;
}

/**
 * Map NetSuite customer type to our CustomerType enum.
 */
function mapNetSuiteCustomerType(
  type: string | undefined
): string {
  if (!type) return "DISTRIBUTOR";
  const normalized = type.toLowerCase();
  if (normalized.includes("retail")) return "RETAILER";
  if (normalized.includes("wholesale") || normalized.includes("distribut")) return "DISTRIBUTOR";
  if (normalized.includes("foodservice") || normalized.includes("restaurant")) return "FOODSERVICE";
  if (normalized.includes("private label") || normalized.includes("pl")) return "PRIVATE_LABEL";
  if (normalized.includes("consumer") || normalized.includes("dtc")) return "DIRECT_TO_CONSUMER";
  return "DISTRIBUTOR";
}
