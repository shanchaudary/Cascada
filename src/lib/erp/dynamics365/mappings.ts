// Cascada — Dynamics 365 Business Central Field Mappings
// Maps D365 BC API fields to our internal entity types.

import type { FieldTransformResult, ErpIngredient, ErpFormulation, ErpFormulationItem, ErpProduct, ErpCustomer, ErpSupplier } from "../types";
import type { D365Item, D365ProductionBOM, D365Customer, D365Vendor } from "./types";

export function mapD365Ingredient(raw: D365Item): FieldTransformResult<ErpIngredient> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpIngredient>["transformErrors"] = [];

  const ingredient: ErpIngredient = {
    erpId: raw.number ?? raw.id,
    name: raw.displayName,
    alternateNames: [],
    casNumber: raw.casNumber ?? undefined,
    eenumber: raw.eNumber ?? undefined,
    category: raw.ingredientCategory ?? undefined,
    isSynthetic: raw.isSynthetic ?? false,
    sourceType: raw.sourceType ?? undefined,
    allergenFlags: raw.allergenFlags ? raw.allergenFlags.split(",").map((s: string) => s.trim()) : [],
    supplierIds: [],
    unitOfMeasure: raw.baseUnitOfMeasure ?? undefined,
    costPerUnit: raw.unitCost ?? undefined,
    metadata: {
      d365Id: raw.id,
      itemCategoryCode: raw.itemCategoryCode,
      blocked: raw.blocked,
      purchasingBlocked: raw.purchasingBlocked,
      gtin: raw.gtin,
      lastModifiedDateTime: raw.lastModifiedDateTime,
    },
  };

  return { data: ingredient, unmappedFields, transformErrors };
}

export function mapD365Formulation(raw: D365ProductionBOM): FieldTransformResult<ErpFormulation> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpFormulation>["transformErrors"] = [];

  const items: ErpFormulationItem[] = (raw.productionBOMLines ?? []).map((line, index) => ({
    ingredientErpId: line.no,
    quantity: line.quantityPer,
    unit: line.unitOfMeasureCode ?? "kg",
    percentage: undefined,
    isAlternate: false,
    replacesIngredientErpId: undefined,
    sortOrder: line.lineNumber ?? index,
  }));

  const formulation: ErpFormulation = {
    erpId: raw.number ?? raw.id,
    name: raw.description ?? raw.number,
    description: `D365 BC Production BOM: ${raw.number}`,
    version: 1,
    status: mapD365BOMStatus(raw.status),
    batchSize: 1,
    batchSizeUnit: "units",
    items,
    totalCost: undefined,
  };

  return { data: formulation, unmappedFields, transformErrors };
}

export function mapD365Product(raw: D365Item): FieldTransformResult<ErpProduct> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpProduct>["transformErrors"] = [];

  const product: ErpProduct = {
    erpId: raw.number ?? raw.id,
    name: raw.displayName,
    sku: raw.number,
    category: raw.ingredientCategory ?? raw.itemCategoryCode ?? undefined,
    brand: raw.brand ?? undefined,
    markets: raw.markets ? raw.markets.split(",").map((s: string) => s.trim()) : [],
    retailers: raw.retailers ? raw.retailers.split(",").map((s: string) => s.trim()) : [],
    isActive: !raw.blocked && !raw.salesBlocked,
    annualVolume: undefined,
    annualRevenue: undefined,
    formulationErpIds: [],
  };

  return { data: product, unmappedFields, transformErrors };
}

export function mapD365Customer(raw: D365Customer): FieldTransformResult<ErpCustomer> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpCustomer>["transformErrors"] = [];

  const customer: ErpCustomer = {
    erpId: raw.number ?? raw.id,
    name: raw.displayName,
    type: "RETAILER",
    requirements: {},
    contactEmail: raw.email ?? undefined,
    productErpIds: [],
  };

  return { data: customer, unmappedFields, transformErrors };
}

export function mapD365Supplier(raw: D365Vendor): FieldTransformResult<ErpSupplier> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpSupplier>["transformErrors"] = [];

  const supplier: ErpSupplier = {
    erpId: raw.number ?? raw.id,
    name: raw.displayName,
    contactEmail: raw.email ?? undefined,
    certifications: [],
    ingredientErpIds: [],
    riskScore: undefined,
  };

  return { data: supplier, unmappedFields, transformErrors };
}

function mapD365BOMStatus(status: string): "DRAFT" | "ACTIVE" | "ARCHIVED" | "UNDER_REVIEW" {
  switch (status) {
    case "Certified": return "ACTIVE";
    case "Under Development": return "UNDER_REVIEW";
    case "New": return "DRAFT";
    case "Closed": return "ARCHIVED";
    default: return "DRAFT";
  }
}
