// Cascada — Substance Extractor Prompt Template
// Versioned prompt for extracting and enriching substance information
// from regulatory text. Goes deeper than rule parsing — identifies aliases,
// functional categories, and health concerns.

export const SUBSTANCE_EXTRACTOR_PROMPT_VERSION = "1.0.0";

// ============================================================================
// System prompt
// ============================================================================

export const SUBSTANCE_EXTRACTOR_SYSTEM_PROMPT = `You are a food chemistry expert specializing in food additives, colorants, preservatives, and processing aids. Your task is to extract detailed substance information from regulatory text.

## Your Expertise
- Food additive chemistry: CAS numbers, E-numbers, IUPAC names, common/trade names
- Functional categories: dyes, preservatives, flavorings, emulsifiers, stabilizers, etc.
- Health concerns: carcinogenicity, neurotoxicity, allergenicity, endocrine disruption
- Regulatory classifications: GRAS, food additive, color additive, food contact substance
- Cross-referencing: linking substance names across different naming systems

## Strict Rules
1. Extract every substance mentioned in the text, even if only referenced in passing.
2. For each substance, provide ALL known names (CAS, E-number, common names, trade names).
3. The "isAdditiveOfConcern" flag should be true only if the substance appears on established watch lists:
   - FDA color additives subject to certification
   - Substances with IARC classifications (Group 1, 2A, 2B)
   - Substances subject to Delaney clause
   - Substances with established ADI (Acceptable Daily Intake) limits
   - Substances banned or restricted in any jurisdiction
4. "knownHealthConcerns" must be based on published scientific evidence, not speculation.
5. If you are not confident about a CAS number or E-number, set it to null rather than guessing.
6. Common aliases are critical for substance matching — include every name you know.
7. Functional categories should use standard food additive classification terms.

## Output Format
You MUST produce valid JSON matching the schema. Every field must be present. Null is valid for optional fields.
Do not include any text outside the JSON structure.` as const;

// ============================================================================
// User prompt builder
// ============================================================================

export interface SubstanceExtractorPromptInput {
  sourceName: string;
  fullText: string;
  /** Substances already identified in a prior rule parsing pass */
  existingSubstances?: Array<{
    substanceName: string;
    substanceType: string;
    casNumber: string | null;
    eenumber: string | null;
  }>;
}

/**
 * Build the user prompt for substance extraction.
 * Used for deeper substance analysis beyond the initial rule parsing.
 */
export function buildSubstanceExtractorPrompt(input: SubstanceExtractorPromptInput): string {
  const sections: string[] = [];

  sections.push(`## Source: ${input.sourceName}`);

  if (input.existingSubstances && input.existingSubstances.length > 0) {
    sections.push(`
## Previously Identified Substances
The following substances were identified in a prior parsing pass. Enrich each with additional names, categories, and health concerns:
${input.existingSubstances.map((s, i) => `${i + 1}. ${s.substanceName} (${s.substanceType})${s.casNumber ? ` CAS: ${s.casNumber}` : ""}${s.eenumber ? ` E${s.eenumber}` : ""}`).join("\n")}`);
  }

  sections.push(`
## Regulatory Text
Extract all substances from the following text, providing comprehensive name aliases, functional categories, and known health concerns:

---
${input.fullText}
---

## Instructions
1. Identify every substance mentioned or referenced in the text.
2. For each substance, provide all known aliases and common names.
3. Assign a functional category (dye, preservative, flavor, emulsifier, etc.).
4. List known health concerns based on published evidence.
5. Flag substances that are on established watch lists (isAdditiveOfConcern).
6. Rate your overall extraction confidence (0-1).`);

  return sections.join("\n");
}

// ============================================================================
// Substance enrichment reference data
// ============================================================================

/**
 * Known food additives of concern with their standard identifiers.
 * Used for post-extraction validation, NOT for the LLM prompt (no hardcoding data).
 * The LLM should identify these from the text; this is for verification only.
 */
export const ADDITIVES_OF_CONCERN_PATTERNS = {
  /** Regex patterns that indicate a substance is likely an additive of concern */
  indicators: [
    /banned/i,
    /prohibited/i,
    /restricted/i,
    /carcinogen/i,
    /iarc\s*(group|class)\s*[12]/i,
    /delaney/i,
    /phase.?out/i,
    /warning\s+label/i,
    /concentration\s+limit/i,
    /acceptable\s+daily\s+intake/i,
    /\badi\b/i,
  ],
} as const;
