// Cascada — Rule Parser Prompt Template
// Versioned prompt for LLM-based parsing of regulatory bills, rules, and mandates.
// This prompt MUST produce structured output matching ParsedRuleSchema.
// Changes to this prompt require a version bump and review.

/**
 * Prompt version tracking.
 * Increment MAJOR when the prompt structure changes significantly.
 * Increment MINOR when wording or instructions are refined.
 */
export const RULE_PARSER_PROMPT_VERSION = "1.0.0";

// ============================================================================
// System prompt
// ============================================================================

export const RULE_PARSER_SYSTEM_PROMPT = `You are a regulatory compliance analyst specializing in food manufacturing law. Your task is to parse regulatory text and extract structured, machine-readable rule data.

## Your Expertise
- United States federal and state food safety regulations (FDA, USDA, state legislatures)
- Food additive regulations (GRAS, color additives, food contact substances)
- Labeling requirements (nutrition facts, allergen declarations, warning labels)
- Retailer mandate programs (Walmart Responsible Sourcing, Target Forward, etc.)
- Chemical nomenclature (CAS numbers, E-numbers, IUPAC names, common trade names)

## Strict Rules
1. Extract ONLY what is explicitly stated in the text. Do not infer, assume, or hallucinate.
2. If a field is not mentioned in the text, set it to null — never make up values.
3. Every substance you identify must be real and mentioned in or clearly derivable from the text.
4. CAS numbers and E-numbers must be exact — do not guess or approximate.
5. Thresholds must include the unit (ppm, %, mg/kg, etc.) — a number without a unit is incomplete.
6. If the text is ambiguous, note the ambiguity in the rule description.
7. Classify each substance as:
   - "specific_chemical": A named chemical compound (e.g., "Red 40", "BHA", "potassium bromate")
   - "chemical_class": A class of chemicals (e.g., "synthetic food dyes", "phthalates", "PFAS")
   - "functional_category": A functional use category (e.g., "artificial colors", "preservatives", "flavor enhancers")
8. For each rule, identify the product scope — what products does it apply to? If not specified, set productScope to null.
9. Penalties: Extract exact amounts if stated. If the text says "up to $X per violation", use that amount.
10. Exemptions: Capture every exemption mentioned — these are critical for cascade analysis.
11. If multiple distinct regulatory requirements exist in the same text, create separate rules for each.

## Output Format
You MUST produce valid JSON matching the schema. Every field must be present. Null is valid for optional fields.
Do not include any text outside the JSON structure.` as const;

// ============================================================================
// User prompt builder
// ============================================================================

export interface RuleParserPromptInput {
  sourceName: string;
  sourceType: string;
  jurisdiction: string;
  fullText: string;
  /** Any previously parsed rules for this source (for amendment/supersede detection) */
  previousRules?: Array<{
    ruleType: string;
    description: string;
    version: number;
  }>;
  /** Additional context to help the parser */
  context?: string;
}

/**
 * Build the user prompt for rule parsing.
 * Includes the regulatory text and all relevant context.
 */
export function buildRuleParserPrompt(input: RuleParserPromptInput): string {
  const sections: string[] = [];

  // Source identification
  sections.push(`## Source Information
- **Name**: ${input.sourceName}
- **Type**: ${input.sourceType}
- **Jurisdiction**: ${input.jurisdiction}`);

  // Previous rules context (for amendments)
  if (input.previousRules && input.previousRules.length > 0) {
    sections.push(`
## Previously Parsed Rules
This source has been parsed before. The following rules already exist:
${input.previousRules.map((r, i) => `${i + 1}. [v${r.version}] ${r.ruleType}: ${r.description}`).join("\n")}

If this text represents an amendment to any of these rules, create a new version with updated details.
If this text supersedes any of these rules, note that in the description.`);
  }

  // Additional context
  if (input.context) {
    sections.push(`
## Additional Context
${input.context}`);
  }

  // The regulatory text itself
  sections.push(`
## Regulatory Text
Parse the following regulatory text and extract all rules, substances, thresholds, exemptions, and compliance requirements:

---
${input.fullText}
---

## Instructions
1. Identify each distinct regulatory requirement in the text above.
2. For each requirement, extract: rule type, description, effective date, compliance date, grace period, penalties, exemptions, and affected substances.
3. For each substance, extract: name, type, CAS number (if mentioned), E-number (if mentioned), concentration threshold, and product scope.
4. Provide an overall summary of what this regulation requires.
5. Rate your confidence in the parsing (0-1). Be honest — if the text is ambiguous or incomplete, reflect that in a lower confidence score.
6. Confirm the jurisdiction and source type from the text.`);

  return sections.join("\n");
}

// ============================================================================
// Few-shot examples (embedded in prompt for quality)
// ============================================================================

/**
 * Example of a well-parsed California bill for prompt engineering reference.
 * Not included in the runtime prompt to save tokens, but used in testing.
 */
export const RULE_PARSER_EXAMPLE_CA_AB418 = {
  input: {
    sourceName: "California AB 418",
    sourceType: "STATE_BILL",
    jurisdiction: "US-CA",
    fullText: `SECTION 1. Section 112190 is added to the Health and Safety Code, to read:
11290. (a) Commencing January 1, 2027, a person or entity shall not manufacture, sell, deliver, hold, or offer for sale a food product that contains any of the following substances: Red 40 (CAS 25956-17-6), Yellow 5 (CAS 1934-21-0), Yellow 6 (CAS 2783-94-0), Blue 1 (CAS 3844-45-9), Blue 2 (CAS 86022-04-8), Green 3 (CAS 2353-45-9), Orange B (CAS 15139-76-1), or Citrus Red 2 (CAS 6358-53-6).
(b) This section does not apply to food products sold or offered for sale in the state prior to January 1, 2027.
(c) A violation of this section is punishable by a civil penalty of not more than five thousand dollars ($5,000) for each violation.`,
  },
  expectedOutput: {
    rules: [
      {
        ruleType: "BAN",
        description: "Prohibits the manufacture, sale, delivery, holding, or offering for sale of food products containing specified synthetic food dyes, effective January 1, 2027.",
        effectiveDate: "2027-01-01",
        complianceDate: "2027-01-01",
        gracePeriodDays: null,
        penaltyType: "civil",
        penaltyAmount: 5000,
        exemptions: [
          {
            description: "Food products sold or offered for sale prior to January 1, 2027",
            productCategories: ["all"],
            conditions: ["Product was sold/offered before effective date"],
          },
        ],
        substances: [
          { substanceName: "Red 40", substanceType: "specific_chemical", casNumber: "25956-17-6", eenumber: null, threshold: null, thresholdUnit: null, productScope: ["food products"] },
          { substanceName: "Yellow 5", substanceType: "specific_chemical", casNumber: "1934-21-0", eenumber: null, threshold: null, thresholdUnit: null, productScope: ["food products"] },
          { substanceName: "Yellow 6", substanceType: "specific_chemical", casNumber: "2783-94-0", eenumber: null, threshold: null, thresholdUnit: null, productScope: ["food products"] },
          { substanceName: "Blue 1", substanceType: "specific_chemical", casNumber: "3844-45-9", eenumber: null, threshold: null, thresholdUnit: null, productScope: ["food products"] },
          { substanceName: "Blue 2", substanceType: "specific_chemical", casNumber: "86022-04-8", eenumber: null, threshold: null, thresholdUnit: null, productScope: ["food products"] },
          { substanceName: "Green 3", substanceType: "specific_chemical", casNumber: "2353-45-9", eenumber: null, threshold: null, thresholdUnit: null, productScope: ["food products"] },
          { substanceName: "Orange B", substanceType: "specific_chemical", casNumber: "15139-76-1", eenumber: null, threshold: null, thresholdUnit: null, productScope: ["food products"] },
          { substanceName: "Citrus Red 2", substanceType: "specific_chemical", casNumber: "6358-53-6", eenumber: null, threshold: null, thresholdUnit: null, productScope: ["food products"] },
        ],
      },
    ],
    summary: "California AB 418 bans eight synthetic food dyes (Red 40, Yellow 5, Yellow 6, Blue 1, Blue 2, Green 3, Orange B, Citrus Red 2) in food products effective January 1, 2027, with a civil penalty of up to $5,000 per violation. Products sold before the effective date are exempt.",
    confidence: 0.95,
    jurisdictionConfirmed: "US-CA",
    sourceTypeConfirmed: "STATE_BILL",
  },
} as const;
