// Cascada — Infor CloudSuite M3 Field Mappings
// Maps Infor M3 MI API fields to our internal entity types.

import type { FieldTransformResult, ErpIngredient, ErpFormulation, ErpFormulationItem, ErpProduct, ErpCustomer, ErpSupplier } from "../types";
import type { InforM3Item, InforM3ProductStructure, InforM3Customer, InforM3Supplier } from "./types";

export function mapInforM3Ingredient(raw: InforM3Item): FieldTransformResult<ErpIngredient> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpIngredient>["transformErrors"] = [];

  const ingredient: ErpIngredient = {
    erpId: raw.MMITNO,
    name: raw.MMITDS ?? raw.MMFUDS ?? raw.MMITNO,
    alternateNames: raw.MMFUDS && raw.MMFUDS !== raw.MMITDS ? [raw.MMFUDS] : [],
    casNumber: raw.UDF?.["U_CASNO"] as string | undefined,
    eenumber: raw.UDF?.["U_ENO"] as string | undefined,
    category: raw.MMCFI1 ?? undefined,
    isSynthetic: (raw.UDF?.["U_SYNTHTC"] as string) === "1",
    sourceType: raw.UDF?.["U_SRCTYPE"] as string | undefined,
    allergenFlags: raw.UDF?.["U_ALLERGNS"] ? String(raw.UDF["U_ALLERGNS"]).split(",").map((s) => s.trim()) : [],
    supplierIds: [],
    unitOfMeasure: raw.MMUNMS ?? undefined,
    costPerUnit: raw.MMPUPR ?? undefined,
    metadata: {
      inforItemNumber: raw.MMITNO,
      itemType: raw.MMITTY,
      itemClass: raw.MMITCL,
      grossWeight: raw.MMGRWE,
      netWeight: raw.MMNEWE,
      purchaseUnit: raw.MMPUUN,
      salesUnit: raw.MMSAUN,
      status: raw.MMSTAT,
      abcClass: raw.MMABAT,
      productGroup: raw.MMPRGR,
      changeDate: raw.CHDT,
      lastModified: raw.LMDT,
    },
  };

  return { data: ingredient, unmappedFields, transformErrors };
}

export function mapInforM3Formulation(raw: InforM3ProductStructure): FieldTransformResult<ErpFormulation> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpFormulation>["transformErrors"] = [];

  const items: ErpFormulationItem[] = (raw.components ?? []).map((comp, index) => ({
    ingredientErpId: comp.PDMTNO,
    quantity: comp.PDQTYM,
    unit: comp.PDUNMS ?? "kg",
    percentage: undefined,
    isAlternate: false,
    replacesIngredientErpId: undefined,
    sortOrder: comp.PDPONO ?? index,
  }));

  const formulation: ErpFormulation = {
    erpId: raw.PDMTPN,
    name: raw.PDMTD5 ?? raw.PDMTPN,
    description: `Infor M3 Product Structure: ${raw.PDMTPN}`,
    version: 1,
    status: raw.PDSTRT === "20" ? "ACTIVE" : raw.PDSTRT === "90" ? "ARCHIVED" : "DRAFT",
    batchSize: raw.PDQTYM ?? 1,
    batchSizeUnit: "units",
    items,
    totalCost: undefined,
  };

  return { data: formulation, unmappedFields, transformErrors };
}

export function mapInforM3Product(raw: InforM3Item): FieldTransformResult<ErpProduct> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpProduct>["transformErrors"] = [];

  const product: ErpProduct = {
    erpId: raw.MMITNO,
    name: raw.MMITDS ?? raw.MMITNO,
    sku: raw.MMITNO,
    category: raw.MMCFI1 ?? undefined,
    brand: raw.UDF?.["U_BRAND"] as string | undefined,
    markets: raw.UDF?.["U_MARKETS"] ? String(raw.UDF["U_MARKETS"]).split(",").map((s) => s.trim()) : [],
    retailers: raw.UDF?.["U_RETAILRS"] ? String(raw.UDF["U_RETAILRS"]).split(",").map((s) => s.trim()) : [],
    isActive: raw.MMSTAT === "20",
    annualVolume: raw.MMSTQT ?? undefined,
    annualRevenue: raw.MMSAPR ? raw.MMSAPR * (raw.MMSTQT ?? 0) : undefined,
    formulationErpIds: [],
  };

  return { data: product, unmappedFields, transformErrors };
}

export function mapInforM3Customer(raw: InforM3Customer): FieldTransformResult<ErpCustomer> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpCustomer>["transformErrors"] = [];

  const customer: ErpCustomer = {
    erpId: raw.OKCUNO,
    name: raw.OKCUNM,
    type: mapInforM3CustomerType(raw.OKCUTP),
    requirements: raw.UDF ?? {},
    contactEmail: raw.OKTEMO ?? undefined,
    productErpIds: [],
  };

  return { data: customer, unmappedFields, transformErrors };
}

export function mapInforM3Supplier(raw: InforM3Supplier): FieldTransformResult<ErpSupplier> {
  const unmappedFields: string[] = [];
  const transformErrors: FieldTransformResult<ErpSupplier>["transformErrors"] = [];

  const supplier: ErpSupplier = {
    erpId: raw.OKSUNO,
    name: raw.OKSUNM,
    contactEmail: raw.OKTEMO ?? undefined,
    certifications: [],
    ingredientErpIds: [],
    riskScore: undefined,
  };

  return { data: supplier, unmappedFields, transformErrors };
}

function mapInforM3CustomerType(type: string): string {
  switch (type) {
    case "1": return "RETAILER";
    case "2": return "DISTRIBUTOR";
    case "3": return "FOODSERVICE";
    case "4": return "PRIVATE_LABEL";
    default: return "DISTRIBUTOR";
  }
}
