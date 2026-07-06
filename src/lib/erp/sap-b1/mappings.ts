// Cascada — SAP Business One Field Mappings
// Maps SAP B1 Service Layer fields to our internal entity types.

import type { FieldMapping } from "../../../types/erp";
import type {
  SapB1Item,
  SapB1ProductTree,
  SapB1BusinessPartner,
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
// Default field mappings
// ============================================================================

export const SAP_B1_INGREDIENT_MAPPINGS: FieldMapping[] = [
  { localField: "erpId", erpField: "ItemCode", required: true },
  { localField: "name", erpField: "ItemName", transform: "trim", required: true },
  { localField: "casNumber", erpField: "U_CAS_NUMBER", required: false },
  { localField: "eenumber", erpField: "U_E_NUMBER", required: false },
  { localField: "category", erpField: "U_INGREDIENT_CATEGORY", required: false },
  { localField: "isSynthetic", erpField: "U_IS_SYNTHETIC", required: false },
  { localField: "sourceType", erpField: "U_SOURCE_TYPE", required: false },
  { localField: "unitOfMeasure", erpField: "PurchaseUnit", required: false },
  { localField: "costPerUnit", erpField: "PurchasingData.PurchaseUnit", required: false },
];

export const SAP_B1_PRODUCT_MAPPINGS: FieldMapping[] = [
  { localField: "erpId", erpField: "ItemCode", required: true },
  { localField: "name", erpField: "ItemName", transform: "trim", required: true },
  { localField: "sku", erpField: "ItemCode", required: true },
  { localField: "isActive", erpField: "Active", required: false },
  { localField: "category", erpField: "U_INGREDIENT_CATEGORY", required: false },
  { localField: "brand", erpField: "U_BRAND", required: false },
];

export const SAP_B1_CUSTOMER_MAPPINGS: FieldMapping[] = [
  { localField: "erpId", erpField: "CardCode", required: true },
  { localField: "name", erpField: "CardName", transform: "trim", required: true },
  { localField: "contactEmail", erpField: "EmailAddress", required: false },
  { localField: "type", erpField: "CardType", required: true },
];

export const SAP_B1_SUPPLIER_MAPPINGS: FieldMapping[] = [
  { localField: "erpId", erpField: "CardCode", required: true },
  { localField: "name", erpField: "CardName", transform: "trim", required: true },
  { localField: "contactEmail", erpField: "EmailAddress", required: false },
];

// ============================================================================
// Mapping functions
// ============================================================================

export function mapSapB1Ingredient(raw: SapB1Item): FieldTransformResult<ErpIngredient> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpIngredient>["transformErrors"] = [];

  const ingredient: ErpIngredient = {
    erpId: raw.ItemCode,
    name: raw.ItemName,
    alternateNames: raw.ForeignName ? [raw.ForeignName] : [],
    casNumber: raw.U_CAS_NUMBER ?? undefined,
    eenumber: raw.U_E_NUMBER ?? undefined,
    category: raw.U_INGREDIENT_CATEGORY ?? undefined,
    isSynthetic: raw.U_IS_SYNTHETIC === "tYES" || raw.U_IS_SYNTHETIC === "Y",
    sourceType: raw.U_SOURCE_TYPE ?? undefined,
    allergenFlags: raw.U_ALLERGEN_FLAGS ? raw.U_ALLERGEN_FLAGS.split(",").map((s: string) => s.trim()) : [],
    supplierIds: raw.PreferredVendor ? [raw.PreferredVendor] : [],
    unitOfMeasure: raw.PurchaseUnit ?? raw.SalesUnit,
    costPerUnit: raw.ItemPrices?.[0]?.Price,
    metadata: {
      sapItemCode: raw.ItemCode,
      itemType: raw.ItemType,
      itemsGroupCode: raw.ItemsGroupCode,
      purchaseItem: raw.PurchaseItem,
      salesItem: raw.SalesItem,
      inventoryItem: raw.InventoryItem,
      manageBatchNumbers: raw.ManageBatchNumbers,
      defaultWarehouse: raw.DefaultWarehouse,
      updateDate: raw.UpdateDate,
    },
  };

  return { data: ingredient, unmappedFields, transformErrors };
}

export function mapSapB1Formulation(raw: SapB1ProductTree): FieldTransformResult<ErpFormulation> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpFormulation>["transformErrors"] = [];

  const items: ErpFormulationItem[] = (raw.ProductTreeLines ?? []).map(
    (line, index) => ({
      ingredientErpId: line.ItemCode,
      quantity: line.Quantity,
      unit: "kg",
      percentage: undefined,
      isAlternate: false,
      replacesIngredientErpId: undefined,
      sortOrder: line.LineNum ?? index,
    })
  );

  const formulation: ErpFormulation = {
    erpId: raw.TreeCode,
    name: raw.TreeName ?? raw.TreeCode,
    description: `SAP B1 Product Tree: ${raw.TreeCode}`,
    version: 1,
    status: "ACTIVE",
    batchSize: raw.Quantity ?? 1,
    batchSizeUnit: "units",
    items,
    totalCost: undefined,
  };

  return { data: formulation, unmappedFields, transformErrors };
}

export function mapSapB1Product(raw: SapB1Item): FieldTransformResult<ErpProduct> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpProduct>["transformErrors"] = [];

  const product: ErpProduct = {
    erpId: raw.ItemCode,
    name: raw.ItemName,
    sku: raw.ItemCode,
    category: raw.U_INGREDIENT_CATEGORY ?? undefined,
    brand: raw.U_BRAND ?? undefined,
    markets: raw.U_MARKETS ? raw.U_MARKETS.split(",").map((s: string) => s.trim()) : [],
    retailers: raw.U_RETAILERS ? raw.U_RETAILERS.split(",").map((s: string) => s.trim()) : [],
    isActive: raw.Active !== "tNO",
    annualVolume: undefined,
    annualRevenue: undefined,
    formulationErpIds: [],
  };

  return { data: product, unmappedFields, transformErrors };
}

export function mapSapB1Customer(raw: SapB1BusinessPartner): FieldTransformResult<ErpCustomer> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpCustomer>["transformErrors"] = [];

  const customer: ErpCustomer = {
    erpId: raw.CardCode,
    name: raw.CardName,
    type: mapSapB1CustomerType(raw.CardType),
    requirements: raw.UDF ?? {},
    contactEmail: raw.EmailAddress ?? undefined,
    productErpIds: [],
  };

  return { data: customer, unmappedFields, transformErrors };
}

export function mapSapB1Supplier(raw: SapB1BusinessPartner): FieldTransformResult<ErpSupplier> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpSupplier>["transformErrors"] = [];

  const supplier: ErpSupplier = {
    erpId: raw.CardCode,
    name: raw.CardName,
    contactEmail: raw.EmailAddress ?? undefined,
    certifications: [],
    ingredientErpIds: [],
    riskScore: undefined,
  };

  return { data: supplier, unmappedFields, transformErrors };
}

function mapSapB1CustomerType(cardType: string): string {
  switch (cardType) {
    case "cCustomer": return "RETAILER";
    case "cSupplier": return "DISTRIBUTOR";
    case "cLid": return "DISTRIBUTOR";
    default: return "DISTRIBUTOR";
  }
}
