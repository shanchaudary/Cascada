// Cascada — Reformulation Advisor Prompt Template
// Versioned prompt for suggesting reformulation alternatives when
// an ingredient is banned, restricted, or subject to concentration limits.

export const REFORMULATION_ADVISOR_PROMPT_VERSION = "1.0.0";

// ============================================================================
// System prompt
// ============================================================================

export const REFORMULATION_ADVISOR_SYSTEM_PROMPT = `You are a food science and reformulation expert. Your task is to suggest practical reformulation alternatives for food ingredients that are banned, restricted, or under regulatory pressure.

## Your Expertise
- Food ingredient substitution: natural alternatives, synthetic alternatives, functional equivalents
- Sensory impact analysis: taste, texture, color, shelf life implications
- Cost modeling: ingredient cost deltas, production line changes, testing requirements
- Regulatory considerations: GRAS status, labeling changes, jurisdictional differences
- Supply chain: availability, lead times, supplier diversity

## Response Requirements
For each suggested substitute, provide:
1. **Ingredient name and type** — What is the substitute and its functional category?
2. **Feasibility score** (0-1) — How likely is this substitution to work?
3. **Sensory impact** — What changes will consumers notice?
4. **Shelf life impact** — Will product stability be affected?
5. **Regulatory risk** — Is this substitute itself under scrutiny?
6. **Cost delta** — Per-unit cost increase or decrease
7. **Implementation timeline** — How long to validate and deploy?
8. **Source** — Where does this suggestion come from (AI, R&D, supplier)?

## Strict Rules
1. Only suggest substitutes that are currently approved for food use in the relevant jurisdiction.
2. If a substitute is approved in some jurisdictions but not others, clearly note this.
3. Consider the specific product type — a substitute for Red 40 in beverages may differ from one in baked goods.
4. Flag any substitutes that might trigger allergen labeling requirements.
5. Do not suggest substitutes that are themselves under regulatory scrutiny without clearly noting the risk.
6. Provide at least 3 alternatives when possible, ranked by overall feasibility.
7. Be honest about trade-offs — there is no perfect substitute, and each has compromises.
8. Consider clean-label trends — some customers prefer natural alternatives even if they're more expensive.

## Output Format
Produce a structured analysis with clear recommendations and trade-offs.` as const;

// ============================================================================
// User prompt builder
// ============================================================================

export interface ReformulationAdvisorPromptInput {
  /** The ingredient being replaced */
  originalIngredient: {
    name: string;
    casNumber: string | null;
    eenumber: string | null;
    category: string | null;
    functionalRole: string | null;
  };
  /** The regulatory reason for replacement */
  regulatoryContext: {
    regulationName: string;
    jurisdiction: string;
    ruleType: string;
    deadline: string | null;
    threshold: number | null;
    thresholdUnit: string | null;
  };
  /** Products containing this ingredient */
  affectedProducts: Array<{
    name: string;
    sku: string;
    category: string;
    formulation: string;
    concentrationPercentage: number | null;
  }>;
  /** Existing substitution options already in the system */
  existingSubstitutions?: Array<{
    substituteName: string;
    feasibilityScore: number | null;
    source: string | null;
  }>;
  /** Available ingredients in the tenant's catalog that might be substitutes */
  candidateSubstitutes?: Array<{
    name: string;
    casNumber: string | null;
    category: string | null;
  }>;
}

/**
 * Build the user prompt for the reformulation advisor.
 */
export function buildReformulationAdvisorPrompt(input: ReformulationAdvisorPromptInput): string {
  const sections: string[] = [];

  sections.push(`## Reformulation Request

### Ingredient to Replace
- **Name**: ${input.originalIngredient.name}
${input.originalIngredient.casNumber ? `- **CAS Number**: ${input.originalIngredient.casNumber}` : ""}
${input.originalIngredient.eenumber ? `- **E-number**: E${input.originalIngredient.eenumber}` : ""}
${input.originalIngredient.category ? `- **Category**: ${input.originalIngredient.category}` : ""}
${input.originalIngredient.functionalRole ? `- **Functional Role**: ${input.originalIngredient.functionalRole}` : ""}

### Regulatory Context
- **Regulation**: ${input.regulatoryContext.regulationName}
- **Jurisdiction**: ${input.regulatoryContext.jurisdiction}
- **Rule Type**: ${input.regulatoryContext.ruleType}
${input.regulatoryContext.deadline ? `- **Compliance Deadline**: ${input.regulatoryContext.deadline}` : ""}
${input.regulatoryContext.threshold ? `- **Threshold**: ${input.regulatoryContext.threshold} ${input.regulatoryContext.thresholdUnit ?? ""}` : ""}

### Affected Products
${input.affectedProducts.length > 0
    ? input.affectedProducts.map((p) => `- **${p.name}** (SKU: ${p.sku}) — ${p.category}, Formulation: ${p.formulation}${p.concentrationPercentage ? `, Concentration: ${p.concentrationPercentage}%` : ""}`).join("\n")
    : "No affected products specified."
}`);

  if (input.existingSubstitutions && input.existingSubstitutions.length > 0) {
    sections.push(`
### Existing Substitution Options (already evaluated)
${input.existingSubstitutions.map((s) => `- ${s.substituteName} (Feasibility: ${s.feasibilityScore ?? "TBD"}, Source: ${s.source ?? "Unknown"})`).join("\n")}`);
  }

  if (input.candidateSubstitutes && input.candidateSubstitutes.length > 0) {
    sections.push(`
### Candidate Substitutes from Your Ingredient Catalog
${input.candidateSubstitutes.map((c) => `- ${c.name}${c.casNumber ? ` (CAS: ${c.casNumber})` : ""}${c.category ? ` — ${c.category}` : ""}`).join("\n")}`);
  }

  sections.push(`
## Instructions
1. Suggest at least 3 reformulation alternatives for ${input.originalIngredient.name}.
2. For each alternative, provide a complete feasibility analysis including sensory, shelf life, regulatory, and cost impacts.
3. Consider the specific product categories and formulations affected.
4. Rank alternatives by overall recommendation (best first).
5. If no suitable substitute exists, explain why and suggest alternative strategies (reformulation to remove the need for the ingredient, market withdrawal for affected SKUs, etc.).
6. Note any testing or validation steps required before deployment.`);

  return sections.join("\n");
}
