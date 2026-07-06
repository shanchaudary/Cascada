// Cascada — USDA FoodData Central Pipeline Types
// Type definitions for the USDA FoodData Central API.
// FoodData Central provides nutrient data and ingredient information
// for food products. This data helps with substance identification
// and ingredient matching in the cascade engine.
// API docs: https://fdc.nal.usda.gov/api-guide.html

// ============================================================================
// USDA API response
// ============================================================================
export interface UsdaSearchResponse {
  foodSearchCriteria: string;
  totalHits: number;
  currentPage: number;
  totalPages: number;
  foods: UsdaFoodItem[];
}

export interface UsdaFoodListResponse {
  foods: UsdaFoodItem[];
}

// ============================================================================
// Food item
// ============================================================================
export interface UsdaFoodItem {
  fdcId: number;
  description: string;
  dataType: UsdaDataType;
  publicationDate: string | null;
  foodCategory: string | null;
  foodCategoryId: number | null;
  foodNutrients: UsdaNutrient[];
  foodComponents: UsdaFoodComponent[];
  foodAttributes: UsdaFoodAttribute[];
  ingredients: string | null;
  brandOwner: string | null;
  gtinUpc: string | null;
  ndbNumber: string | null;
  foodCode: string | null;
  modifiedDate: string | null;
  availableDate: string | null;
  marketCountry: string | null;
  scientificName: string | null;
  subbrandOwner: string | null;
  servingSize: number | null;
  servingSizeUnit: string | null;
  householdServingFullText: string | null;
  tradeChannel: string[] | null;
  allHighlightFields: string | null;
  score: number | null;
  additionalDescriptions: string | null;
  foodClass: string | null;
  datasource: string | null;
  langualFactors: UsdaLangualFactor[] | null;
  nutrientConversionFactors: UsdaNutrientConversionFactor[] | null;
  isHistorical: boolean | null;
  inputFoods: UsdaInputFood[] | null;
  finalFoodInputFoods: UsdaInputFood[] | null;
  surveyFndds: UsdaSurveyFndds | null;
  wweiaFoodCategory: UsdaWweiaFoodCategory | null;
  brandedFoodCategory: string | null;
  effects: string[] | null;
  amount: number | null;
  foodPortions: UsdaFoodPortion[] | null;
  notes: string | null;
  fdcIdsOfConcatenatedItem: number[] | null;
}

// ============================================================================
// Nutrient data
// ============================================================================
export interface UsdaNutrient {
  nutrientId: number;
  nutrientName: string;
  nutrientNumber: string;
  nutrientCode: string | null;
  rank: number | null;
  unitName: string;
  derivationId: number | null;
  derivationCode: string | null;
  derivationDescription: string | null;
  foodNutrientSourceId: number | null;
  foodNutrientSourceCode: string | null;
  foodNutrientSourceDescription: string | null;
  amount: number | null;
  dataPoints: number | null;
  min: number | null;
  max: number | null;
  median: number | null;
  footnote: string | null;
  minYearAcquired: number | null;
  nutrientAnalysisHeaderId: number | null;
}

// ============================================================================
// Supporting types
// ============================================================================
export interface UsdaFoodComponent {
  id: number;
  name: string;
  percentWeight: number | null;
  isRefuse: boolean | null;
  gramWeight: number | null;
  dataPoints: number | null;
  minYearAcquired: number | null;
  number: number | null;
}

export interface UsdaFoodAttribute {
  id: number;
  name: string;
  value: string;
}

export interface UsdaLangualFactor {
  code: string;
  name: string;
}

export interface UsdaNutrientConversionFactor {
  type: string;
  proteinValue: number | null;
  fatValue: number | null;
  carbohydrateValue: number | null;
  value: number | null;
}

export interface UsdaInputFood {
  foodDescription: string;
  fdcId: number;
  amount: number | null;
  id: number;
}

export interface UsdaSurveyFndds {
  foodCode: string;
  wweiaFoodCategory: UsdaWweiaFoodCategory | null;
}

export interface UsdaWweiaFoodCategory {
  wweiaFoodCategoryCode: number;
  wweiaFoodCategoryDescription: string;
}

export interface UsdaFoodPortion {
  id: number;
  amount: number;
  gramWeight: number;
  sequenceNumber: number | null;
  measureUnit: string | null;
  portionDescription: string | null;
  modifier: string | null;
}

// ============================================================================
// Data types
// ============================================================================
export type UsdaDataType =
  | "Foundation"
  | "SR Legacy"
  | "Survey (FNDDS)"
  | "Branded"
  | "Experimental";

// ============================================================================
// Search parameters
// ============================================================================
export interface UsdaSearchParams {
  /** Search query */
  query: string;
  /** Data types to include */
  dataType?: UsdaDataType[];
  /** Page number (0-indexed? API uses offset-based) */
  pageNumber?: number;
  /** Results per page (max 200) */
  pageSize?: number;
  /** Sort field */
  sortBy?: "dataType.keyword" | "description" | "fdcId" | "publishedDate";
  /** Sort order */
  sortOrder?: "asc" | "desc";
  /** Brand owner filter */
  brandOwner?: string;
  /** Require all words in query */
  requireAllWords?: boolean;
}

// ============================================================================
// USDA food categories relevant to food manufacturing
// These categories help us identify products affected by regulation changes.
// ============================================================================
export const USDA_MANUFACTURING_CATEGORIES: readonly string[] = [
  "Baked Products",
  "Beverages",
  "Breakfast Cereals",
  "Candy & Sweets",
  "Canned Fruits & Vegetables",
  "Cheese",
  "Chips & Snack Foods",
  "Dairy & Egg Products",
  "Desserts",
  "Dried Fruits",
  "Fast Foods",
  "Fats & Oils",
  "Fish & Seafood",
  "Flavorings & Seasonings",
  "Frozen Foods",
  "Fruits & Fruit Juices",
  "Grains & Pasta",
  "Ice Cream & Frozen Yogurt",
  "Infant Formula & Baby Food",
  "Legumes & Legume Products",
  "Meat & Poultry",
  "Milk & Milk Products",
  "Nuts & Seeds",
  "Prepared Meals",
  "Sauces & Condiments",
  "Snack Foods",
  "Soups & Stews",
  "Spices & Herbs",
  "Sugars & Sweeteners",
  "Vegetables & Vegetable Products",
  "Yogurt",
] as const;

// ============================================================================
// Food additive / ingredient search queries
// These help identify foods containing specific substances of concern.
// ============================================================================
export const USDA_INGREDIENT_QUERIES: readonly string[] = [
  // Color additives
  "FD&C Red",
  "FD&C Yellow",
  "FD&C Blue",
  "Red 3",
  "Red 40",
  "Yellow 5",
  "Yellow 6",
  "Blue 1",
  "Blue 2",
  "titanium dioxide",

  // Preservatives
  "sodium benzoate",
  "potassium sorbate",
  "BHA",
  "BHT",
  "TBHQ",
  "propylparaben",
  "butylparaben",
  "sodium nitrite",
  "potassium bromate",

  // Sweeteners
  "aspartame",
  "sucralose",
  "acesulfame potassium",
  "saccharin",
  "high fructose corn syrup",

  // Emulsifiers & stabilizers
  "carrageenan",
  "mono and diglycerides",
  "polysorbate",
  "cellulose gum",
  "xanthan gum",

  // Other additives of concern
  "brominated vegetable oil",
  "potassium bromate",
  "azodicarbonamide",
  "sodium erythorbate",
] as const;
