// Cascada — USDA FoodData Central Transforms
// Transform raw USDA FoodData API responses into Cascada's
// TransformedRegulatorySource format.
// USDA data is used for substance identification and ingredient matching —
// it helps us understand which food products contain specific additives,
// enabling the cascade engine to trace regulatory impact through product portfolios.

import type { TransformedRegulatorySource } from "../types";
import { FOOD_RELEVANCE_KEYWORDS } from "../types";
import type { UsdaFoodItem, UsdaDataType } from "./types";
import { USDA_MANUFACTURING_CATEGORIES } from "./types";
import type { SourceType, SourceStatus } from "@prisma/client";

// ============================================================================
// Date parsing
// ============================================================================
/**
 * Parse a USDA date string.
 * USDA uses YYYY-MM-DD format for publication dates.
 */
export function parseUsdaDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;

  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

// ============================================================================
// Relevance checking
// ============================================================================
interface UsdaRelevanceResult {
  isRelevant: boolean;
  matchedCategories: string[];
  confidence: number;
  reason: string;
}

/**
 * Check a USDA food item for food manufacturing relevance.
 * USDA data is ingredient/nutrient focused, so we look for:
 * 1. Items containing additives of concern
 * 2. Items in manufacturing-relevant categories
 * 3. Items with ingredient lists containing flagged substances
 */
function checkUsdaRelevance(item: UsdaFoodItem): UsdaRelevanceResult {
  const textFields = [
    item.description,
    item.ingredients ?? "",
    item.brandOwner ?? "",
    item.foodCategory ?? "",
    item.additionalDescriptions ?? "",
  ].filter(Boolean);

  const combinedText = textFields.join(" ").toLowerCase();
  const matchedCategories: string[] = [];

  for (const keyword of FOOD_RELEVANCE_KEYWORDS) {
    if (combinedText.includes(keyword.toLowerCase())) {
      matchedCategories.push(keyword);
    }
  }

  // Check if the food category is in our manufacturing categories list
  const isManufacturingCategory = item.foodCategory
    ? USDA_MANUFACTURING_CATEGORIES.some(
        (cat) => cat.toLowerCase() === item.foodCategory!.toLowerCase()
      )
    : false;

  // Items with specific additive ingredients are highly relevant
  const hasFlaggedIngredients = item.ingredients
    ? checkIngredientsForAdditives(item.ingredients)
    : false;

  // Determine relevance and confidence
  if (matchedCategories.length >= 2 && hasFlaggedIngredients) {
    return {
      isRelevant: true,
      matchedCategories,
      confidence: 0.95,
      reason: "Multiple keyword matches with flagged ingredients",
    };
  }

  if (hasFlaggedIngredients) {
    return {
      isRelevant: true,
      matchedCategories,
      confidence: 0.9,
      reason: "Contains flagged additive ingredients",
    };
  }

  if (matchedCategories.length >= 2) {
    return {
      isRelevant: true,
      matchedCategories,
      confidence: 0.8,
      reason: "Multiple keyword matches",
    };
  }

  if (matchedCategories.length >= 1) {
    return {
      isRelevant: true,
      matchedCategories,
      confidence: 0.7,
      reason: "Single keyword match",
    };
  }

  if (isManufacturingCategory) {
    return {
      isRelevant: true,
      matchedCategories: [item.foodCategory!],
      confidence: 0.5,
      reason: "Manufacturing-relevant category",
    };
  }

  return {
    isRelevant: false,
    matchedCategories,
    confidence: 0.2,
    reason: "No relevant matches found",
  };
}

/**
 * Check an ingredient list string for additives of concern.
 * Looks for common food additives that are under regulatory scrutiny.
 */
function checkIngredientsForAdditives(ingredientsStr: string): boolean {
  const lowerIngredients = ingredientsStr.toLowerCase();

  const additivePatterns = [
    "fd&c red",
    "fd&c yellow",
    "fd&c blue",
    "red 3",
    "red 40",
    "yellow 5",
    "yellow 6",
    "titanium dioxide",
    "brominated vegetable oil",
    "potassium bromate",
    "propylparaben",
    "butylparaben",
    "bha",
    "bht",
    "tbhq",
    "sodium benzoate",
    "aspartame",
    "acesulfame",
    "carrageenan",
    "azodicarbonamide",
    "pfos",
    "pfoa",
  ];

  return additivePatterns.some((pattern) => lowerIngredients.includes(pattern));
}

// ============================================================================
// Data type mapping
// ============================================================================
/**
 * Map USDA data type to a description and relevance weight.
 * Foundation data is the most authoritative.
 */
function mapDataTypeInfo(dataType: UsdaDataType): {
  description: string;
  authorityWeight: number;
} {
  switch (dataType) {
    case "Foundation":
      return { description: "USDA Foundation Data", authorityWeight: 1.0 };
    case "SR Legacy":
      return { description: "USDA Standard Reference Legacy", authorityWeight: 0.9 };
    case "Survey (FNDDS)":
      return { description: "USDA Food and Nutrient Database", authorityWeight: 0.8 };
    case "Branded":
      return { description: "USDA Branded Food Products", authorityWeight: 0.7 };
    case "Experimental":
      return { description: "USDA Experimental Data", authorityWeight: 0.5 };
    default:
      return { description: "USDA Food Data", authorityWeight: 0.6 };
  }
}

// ============================================================================
// Main transform
// ============================================================================

/**
 * Transform a USDA food item into a TransformedRegulatorySource.
 * USDA data doesn't represent regulations directly — it represents
 * food product composition. We store it as a reference source that
 * the substance matcher and cascade engine use to connect regulations
 * to actual products and ingredients.
 *
 * This is different from other pipelines: USDA data enriches our
 * ingredient database rather than creating new regulatory sources.
 * We store it as REFERENCE_DATA so it is not treated as regulatory law.
 */
export function transformUsdaFoodItem(item: UsdaFoodItem): TransformedRegulatorySource {
  const relevance = checkUsdaRelevance(item);

  const name = buildUsdaItemName(item);
  const fullText = buildUsdaFullText(item);
  const publicationDate = parseUsdaDate(item.publicationDate);

  return {
    sourceId: `USDA-FDC-${item.fdcId}`,
    sourceType: "REFERENCE_DATA" as SourceType,
    jurisdiction: "US",
    name,
    title: name,
    summary: item.ingredients ?? item.description,
    sourceUrl: `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${item.fdcId}`,
    citationUrl: `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${item.fdcId}`,
    status: "ACTIVE" as SourceStatus,
    publishedAt: publicationDate,
    observedAt: new Date(),
    sourceAgency: "USDA FoodData Central",
    documentType: `fooddata_${item.dataType}`,
    introducedDate: publicationDate,
    enactedDate: null,
    effectiveDate: null,
    fullText,
    rawApiResponse: item as unknown as Record<string, unknown>,
    relevantCategories: relevance.matchedCategories,
    matchMetadata: {
      source: "usda_fooddata_central",
      role: "ingredient_product_reference",
      confidence: relevance.confidence,
      dataType: item.dataType,
      foodCategory: item.foodCategory ?? null,
      brandOwner: item.brandOwner ?? null,
    },
    isRelevant: relevance.isRelevant,
  };
}

/**
 * Transform a USDA food item specifically for ingredient database enrichment.
 * Returns a lighter-weight version focused on ingredient data.
 */
export function transformUsdaItemForIngredientMatch(item: UsdaFoodItem): {
  fdcId: number;
  description: string;
  ingredients: string | null;
  foodCategory: string | null;
  brandOwner: string | null;
  dataType: UsdaDataType;
  nutrients: Array<{ name: string; amount: number; unit: string }>;
  isRelevant: boolean;
  relevanceConfidence: number;
  matchedCategories: string[];
} {
  const relevance = checkUsdaRelevance(item);

  return {
    fdcId: item.fdcId,
    description: item.description,
    ingredients: item.ingredients,
    foodCategory: item.foodCategory,
    brandOwner: item.brandOwner,
    dataType: item.dataType,
    nutrients: (item.foodNutrients ?? [])
      .filter((n) => n.amount !== null)
      .map((n) => ({
        name: n.nutrientName,
        amount: n.amount ?? 0,
        unit: n.unitName,
      })),
    isRelevant: relevance.isRelevant,
    relevanceConfidence: relevance.confidence,
    matchedCategories: relevance.matchedCategories,
  };
}

// ============================================================================
// Name builder
// ============================================================================
function buildUsdaItemName(item: UsdaFoodItem): string {
  const parts: string[] = [];

  parts.push(item.description);

  if (item.brandOwner) {
    parts.push(`(${item.brandOwner})`);
  }

  if (item.foodCategory) {
    parts.push(`[${item.foodCategory}]`);
  }

  return parts.join(" ");
}

// ============================================================================
// Full text builder
// ============================================================================
function buildUsdaFullText(item: UsdaFoodItem): string {
  const sections: string[] = [];
  const dataTypeInfo = mapDataTypeInfo(item.dataType);

  sections.push(`FDC ID: ${item.fdcId}`);
  sections.push(`DESCRIPTION: ${item.description}`);
  sections.push(`DATA TYPE: ${dataTypeInfo.description}`);
  sections.push(`PUBLICATION DATE: ${item.publicationDate ?? "N/A"}`);
  sections.push(`FOOD CATEGORY: ${item.foodCategory ?? "N/A"}`);
  sections.push("");

  if (item.brandOwner) {
    sections.push(`BRAND OWNER: ${item.brandOwner}`);
  }
  if (item.gtinUpc) {
    sections.push(`GTIN/UPC: ${item.gtinUpc}`);
  }
  if (item.scientificName) {
    sections.push(`SCIENTIFIC NAME: ${item.scientificName}`);
  }

  sections.push("");

  if (item.ingredients) {
    sections.push("INGREDIENTS:");
    sections.push(item.ingredients);
    sections.push("");
  }

  // Nutrient highlights (top 10 by amount)
  if (item.foodNutrients && item.foodNutrients.length > 0) {
    sections.push("KEY NUTRIENTS:");
    const topNutrients = [...item.foodNutrients]
      .filter((n) => n.amount !== null)
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
      .slice(0, 10);

    for (const nutrient of topNutrients) {
      sections.push(`  - ${nutrient.nutrientName}: ${nutrient.amount} ${nutrient.unitName}`);
    }
    sections.push("");
  }

  // Food components
  if (item.foodComponents && item.foodComponents.length > 0) {
    sections.push("COMPONENTS:");
    for (const component of item.foodComponents) {
      sections.push(
        `  - ${component.name}: ${component.gramWeight ?? "N/A"}g ` +
        `(${component.percentWeight ?? "N/A"}% weight)`
      );
    }
  }

  // Serving size
  if (item.servingSize && item.servingSizeUnit) {
    sections.push("");
    sections.push(`SERVING SIZE: ${item.servingSize} ${item.servingSizeUnit}`);
  }
  if (item.householdServingFullText) {
    sections.push(`HOUSEHOLD SERVING: ${item.householdServingFullText}`);
  }

  return sections.join("\n");
}
