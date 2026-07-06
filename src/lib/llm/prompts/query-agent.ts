// Cascada — Query Agent Prompt Template
// Versioned prompt for the C-suite executive Q&A agent.
// Answers questions about regulatory exposure, compliance timelines, and costs.

export const QUERY_AGENT_PROMPT_VERSION = "1.0.0";

// ============================================================================
// System prompt
// ============================================================================

export const QUERY_AGENT_SYSTEM_PROMPT = `You are an executive regulatory advisor for a food manufacturing company. You answer questions from C-suite executives about regulatory exposure, compliance timelines, and financial impact.

## Your Role
- Translate complex regulatory language into clear business impact
- Provide specific, actionable answers (not generic advice)
- Reference specific regulations, SKUs, and dollar amounts when available
- Acknowledge uncertainty when data is incomplete

## Your Knowledge Base
You have access to the company's:
- Regulatory source database (bills, rules, FDA actions)
- Product portfolio (ingredients → formulations → products → customers)
- Cascade impact analysis (how regulatory changes affect their business)
- Compliance timelines and deadline conflicts
- Reformulation cost estimates

## Response Guidelines
1. **Be specific**: "Your snack division has 23 SKUs containing Red 40" not "Some products may be affected"
2. **Quantify impact**: "Estimated $340K-520K in reformulation costs" not "Could be expensive"
3. **Prioritize by urgency**: Lead with deadlines within 30 days
4. **Provide context**: Explain WHY this matters in business terms
5. **Suggest next steps**: "Recommend scheduling R&D review by [date]" not "You should look into this"
6. **Cite sources**: Reference specific bill numbers, rule IDs, or FDA docket numbers
7. **Be honest about gaps**: "We don't have ERP data for your private label products yet" when data is missing

## Strict Rules
- Never fabricate data. If you don't have information, say so clearly.
- Never provide legal advice. Recommend consulting counsel for legal questions.
- Never override SME-validated data with your own interpretation.
- Always frame responses in terms of business risk and opportunity.
- Use the provided context data — do not rely on training data for company-specific facts.` as const;

// ============================================================================
// User prompt builder
// ============================================================================

export interface QueryAgentPromptInput {
  query: string;
  /** RAG context from the database */
  context: {
    relevantRegulations?: Array<{
      name: string;
      jurisdiction: string;
      status: string;
      effectiveDate: string | null;
      description: string;
    }>;
    affectedProducts?: Array<{
      name: string;
      sku: string;
      category: string;
      annualRevenue: number | null;
    }>;
    cascadeImpacts?: Array<{
      description: string;
      financialImpact: number | null;
      timelineDays: number | null;
      severity: string;
    }>;
    complianceTimelines?: Array<{
      regulationName: string;
      deadline: string;
      daysRemaining: number;
      conflictWith?: string;
    }>;
  };
  /** The user's role for context-appropriate responses */
  userRole?: string;
  /** Conversation history for multi-turn queries */
  conversationHistory?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}

/**
 * Build the user prompt for the query agent.
 * Includes RAG context and conversation history.
 */
export function buildQueryAgentPrompt(input: QueryAgentPromptInput): string {
  const sections: string[] = [];

  // Role context
  if (input.userRole) {
    sections.push(`## User Role: ${input.userRole}`);
  }

  // Relevant regulations
  if (input.context.relevantRegulations && input.context.relevantRegulations.length > 0) {
    sections.push(`
## Relevant Regulations
${input.context.relevantRegulations.map((r) => `- **${r.name}** (${r.jurisdiction}) — Status: ${r.status}${r.effectiveDate ? `, Effective: ${r.effectiveDate}` : ""}
  ${r.description}`).join("\n")}`);
  } else {
    sections.push("\n## Relevant Regulations\nNo matching regulations found in the database.");
  }

  // Affected products
  if (input.context.affectedProducts && input.context.affectedProducts.length > 0) {
    sections.push(`
## Affected Products
${input.context.affectedProducts.map((p) => `- **${p.name}** (SKU: ${p.sku}, Category: ${p.category})${p.annualRevenue ? ` — Annual Revenue: $${p.annualRevenue.toLocaleString()}` : ""}`).join("\n")}`);
  }

  // Cascade impacts
  if (input.context.cascadeImpacts && input.context.cascadeImpacts.length > 0) {
    sections.push(`
## Cascade Impact Analysis
${input.context.cascadeImpacts.map((i) => `- [${i.severity}] ${i.description}${i.financialImpact ? ` — Financial Impact: $${i.financialImpact.toLocaleString()}` : ""}${i.timelineDays ? ` — Timeline: ${i.timelineDays} days` : ""}`).join("\n")}`);
  }

  // Compliance timelines
  if (input.context.complianceTimelines && input.context.complianceTimelines.length > 0) {
    sections.push(`
## Compliance Timelines
${input.context.complianceTimelines.map((t) => `- **${t.regulationName}** — Deadline: ${t.deadline} (${t.daysRemaining} days remaining)${t.conflictWith ? ` ⚠️ CONFLICTS with ${t.conflictWith}` : ""}`).join("\n")}`);
  }

  // Conversation history
  if (input.conversationHistory && input.conversationHistory.length > 0) {
    sections.push(`
## Previous Conversation
${input.conversationHistory.map((m) => `${m.role === "user" ? "Executive" : "Advisor"}: ${m.content}`).join("\n")}`);
  }

  // The actual query
  sections.push(`
## Question
${input.query}

Provide a clear, specific, business-focused answer with actionable next steps.`);

  return sections.join("\n");
}
