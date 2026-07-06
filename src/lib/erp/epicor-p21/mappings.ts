// Cascada — Epicor Prophet 21 Field Mappings
// Maps Epicor P21 REST API fields to our internal entity types.

import type { FieldTransformResult, ErpIngredient, ErpFormulation, ErpFormulationItem, ErpProduct, ErpCustomer, ErpSupplier } from "../types";
import type { EpicorP21Item, EpicorP21BOM, EpicorP21Customer, EpicorP21Vendor } from "./types";

export function mapEpicorP21Ingredient(raw: EpicorP21Item): FieldTransformResult<ErpIngredient> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpIngredient>["transformErrors"] = [];

  const ingredient: ErpIngredient = {
    erpId: raw.item_id ?? String(raw.id),
    name: raw.item_desc ?? raw.item_id,
    alternateNames: raw.extended_desc ? [raw.extended_desc] : [],
    casNumber: raw.UDF?.["CAS_NUMBER"] as string | undefined,
    eenumber: raw.UDF?.["E_NUMBER"] as string | undefined,
    category: raw.commodity_code ?? raw.product_group ?? undefined,
    isSynthetic: raw.UDF?.["IS_SYNTHETIC"] === true || raw.UDF?.["IS_SYNTHETIC"] === "Y",
    sourceType: raw.UDF?.["SOURCE_TYPE"] as string | undefined,
    allergenFlags: raw.UDF?.["ALLERGEN_FLAGS"] ? String(raw.UDF["ALLERGEN_FLAGS"]).split(",").map((s) => s.trim()) : [],
    supplierIds: raw.primary_vendor_id ? [raw.primary_vendor_id] : [],
    unitOfMeasure: raw.unit_of_measure ?? undefined,
    costPerUnit: raw.average_cost ?? raw.std_cost ?? undefined,
    metadata: {
      epicorId: raw.id,
      productGroup: raw.product_group,
      commodityCode: raw.commodity_code,
      qtyOnHand: raw.qty_on_hand,
      qtyAvailable: raw.qty_available,
      weight: raw.weight,
      weightUnit: raw.weight_unit,
      upcCode: raw.upc_code,
      manufacturer: raw.manufacturer,
      countryOfOrigin: raw.country_of_origin,
      buyerCode: raw.buyer_code,
      leadTimeDays: raw.lead_time_days,
      lastUpdateDate: raw.last_update_date,
    },
  };

  return { data: ingredient, unmappedFields, transformErrors };
}

export function mapEpicorP21Formulation(raw: EpicorP21BOM): FieldTransformResult<ErpFormulation> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpFormulation>["transformErrors"] = [];

  const items: ErpFormulationItem[] = (raw.components ?? []).map((comp, index) => ({
    ingredientErpId: comp.component_item_id,
    quantity: comp.quantity,
    unit: comp.unit_of_measure ?? "kg",
    percentage: undefined,
    isAlternate: comp.alternate ?? false,
    replacesIngredientErpId: comp.replaces_item_id ?? undefined,
    sortOrder: comp.sequence ?? index,
  }));

  const formulation: ErpFormulation = {
    erpId: raw.bom_id ?? String(raw.id),
    name: raw.bom_desc ?? raw.bom_id,
    description: `Epicor P21 BOM: ${raw.bom_id} (parent: ${raw.parent_item_id})`,
    version: 1,
    status: raw.status === "Active" ? "ACTIVE" : raw.status === "Obsolete" ? "ARCHIVED" : "DRAFT",
    batchSize: 1,
    batchSizeUnit: "units",
    items,
    totalCost: undefined,
  };

  return { data: formulation, unmappedFields, transformErrors };
}

export function mapEpicorP21Product(raw: EpicorP21Item): FieldTransformResult<ErpProduct> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpProduct>["transformErrors"] = [];

  const product: ErpProduct = {
    erpId: raw.item_id ?? String(raw.id),
    name: raw.item_desc ?? raw.item_id,
    sku: raw.item_id,
    category: raw.product_group ?? raw.commodity_code ?? undefined,
    brand: raw.UDF?.["BRAND"] as string | undefined,
    markets: raw.UDF?.["MARKETS"] ? String(raw.UDF["MARKETS"]).split(",").map((s) => s.trim()) : [],
    retailers: raw.UDF?.["RETAILERS"] ? String(raw.UDF["RETAILERS"]).split(",").map((s) => s.trim()) : [],
    isActive: !raw.inactive,
    annualVolume: raw.qty_on_hand ?? undefined,
    annualRevenue: raw.list_price ? raw.list_price * (raw.qty_on_hand ?? 0) : undefined,
    formulationErpIds: [],
  };

  return { data: product, unmappedFields, transformErrors };
}

export function mapEpicorP21Customer(raw: EpicorP21Customer): FieldTransformResult<ErpCustomer> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpCustomer>["transformErrors"] = [];

  const customer: ErpCustomer = {
    erpId: raw.customer_id ?? String(raw.id),
    name: raw.customer_name,
    type: mapEpicorP21CustomerType(raw.customer_type),
    requirements: raw.UDF ?? {},
    contactEmail: raw.email ?? undefined,
    productErpIds: [],
  };

  return { data: customer, unmappedFields, transformErrors };
}

export function mapEpicorP21Supplier(raw: EpicorP21Vendor): FieldTransformResult<ErpSupplier> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpSupplier>["transformErrors"] = [];

  const supplier: ErpSupplier = {
    erpId: raw.vendor_id ?? String(raw.id),
    name: raw.vendor_name,
    contactEmail: raw.email ?? undefined,
    certifications: [],
    ingredientErpIds: [],
    riskScore: undefined,
  };

  return { data: supplier, unmappedFields, transformErrors };
}

function mapEpicorP21CustomerType(type: string | undefined): string {
  if (!type) return "DISTRIBUTOR";
  const normalized = type.toLowerCase();
  if (normalized.includes("retail")) return "RETAILER";
  if (normalized.includes("distribut") || normalized.includes("wholesale")) return "DISTRIBUTOR";
  if (normalized.includes("foodservice") || normalized.includes("restaurant")) return "FOODSERVICE";
  if (normalized.includes("private") || normalized.includes("pl")) return "PRIVATE_LABEL";
  return "DISTRIBUTOR";
}
