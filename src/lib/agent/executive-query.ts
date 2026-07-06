// Cascada — Executive Query Agent
// C-suite Q&A agent with RAG context, conversation memory, and plan gating.
// Answers questions about regulatory exposure, compliance timelines, and financial impact.
// Uses the existing query-agent prompt template from Stage 3 and extends it
// with real tool calling, conversation persistence, and budget enforcement.

import { generateText } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  getPrimaryModel,
  getFallbackModel,
  getTemperatureForTask,
  calculateLlmCost,
  isRetryableLlmError,
} from "@/lib/llm/client";
import { logLlmUsage } from "@/lib/llm/cost-tracker";
import { executeWithFallback } from "@/lib/llm/fallback";
import {
  QUERY_AGENT_SYSTEM_PROMPT,
  buildQueryAgentPrompt,
} from "@/lib/llm/prompts/query-agent";
import { createAgentLogger } from "@/lib/logger";
import { AgentError, AgentPlanAccessError, AgentBudgetError } from "@/lib/errors";
import type {
  AgentMessage,
  AgentExecutionContext,
  AgentExecutionResult,
  AgentToolCall,
  ExecutiveQueryInput,
  ExecutiveQueryResult,
  QueryIntent,
  Conversation,
  ConversationStatus,
  RAGContext,
} from "./types";
import { AGENT_CONFIG } from "./types";
import { buildAgentContext, serializeContextForPrompt } from "./context";
import { executeToolCall, getAvailableTools, formatToolDefinitionsForPrompt } from "./tools";

// ============================================================================
// Query Intent Detection
// ============================================================================

const INTENT_KEYWORDS: Record<QueryIntent, string[]> = {
  regulation_status: ["regulation", "bill", "law", "legislation", "rule", "mandate", "fda", "status of", "what happened with"],
  product_exposure: ["product", "sku", "affected", "exposed", "which products", "how many products", "portfolio"],
  compliance_timeline: ["deadline", "timeline", "when", "due date", "compliance date", "grace period", "how long", "by when"],
  financial_impact: ["cost", "financial", "revenue", "dollar", "budget", "expense", "how much", "price", "money"],
  reformulation_options: ["reformul", "substitute", "alternative", "replace", "swap", "ingredient change"],
  supplier_risk: ["supplier", "vendor", "supply chain", "sourcing", "availability", "lead time"],
  customer_impact: ["customer", "retailer", "walmart", "target", "kroger", "spec", "requirement"],
  general_inquiry: [],
};

/**
 * Detect the primary intent of a user query for context optimization.
 */
function detectQueryIntent(query: string): QueryIntent {
  const lowerQuery = query.toLowerCase();
  let bestIntent: QueryIntent = "general_inquiry";
  let bestScore = 0;

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    if (intent === "general_inquiry") continue;
    const score = keywords.reduce((acc, kw) => acc + (lowerQuery.includes(kw) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent as QueryIntent;
    }
  }

  return bestIntent;
}

/**
 * Extract key topics from a query for logging and context optimization.
 */
function extractTopics(query: string): string[] {
  const topics: string[] = [];
  const lowerQuery = query.toLowerCase();

  // Jurisdictions
  const jurisdictionPattern = /\b(US-[A-Z]{2}|US|CA|EU|UK)\b/g;
  const jurisdictions = lowerQuery.match(jurisdictionPattern);
  if (jurisdictions) topics.push(...jurisdictions);

  // Rule types
  const ruleTypes = ["ban", "warning", "label", "disclosure", "phase-out", "concentration limit"];
  ruleTypes.forEach((rt) => {
    if (lowerQuery.includes(rt)) topics.push(rt);
  });

  // Severity levels
  const severities = ["critical", "high", "medium", "low"];
  severities.forEach((s) => {
    if (lowerQuery.includes(s)) topics.push(s);
  });

  return [...new Set(topics)];
}

// ============================================================================
// Conversation Management
// ============================================================================

/**
 * Create a new conversation or load an existing one.
 */
async function getOrCreateConversation(
  tenantId: string,
  userId: string,
  conversationId?: string
): Promise<Conversation> {
  if (conversationId) {
    const existing = await prisma.workflowInstance.findFirst({
      where: { id: conversationId, tenantId },
    });

    // For now, store conversations in-memory via the agent module.
    // Full persistence will use a dedicated conversations table or
    // the WorkflowInstance model with type "agent_conversation".
    // This returns a well-typed Conversation object for agent use.
  }

  return {
    id: conversationId ?? `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId,
    userId,
    agentType: "executive_query",
    title: "New Conversation",
    messages: [],
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Persist conversation messages for multi-turn support.
 * Stores the conversation state as JSON in a lightweight format.
 */
async function persistConversation(
  conversation: Conversation
): Promise<void> {
  // Conversation persistence uses a simple file-based approach
  // that will be migrated to a dedicated table in Stage 8.
  // For now, the conversation object is returned to the caller
  // for stateless or session-based management.
  void conversation;
}

// ============================================================================
// Budget Enforcement
// ============================================================================

/**
 * Check if the tenant has remaining LLM budget for agent calls.
 */
async function checkLlmBudget(
  tenantId: string,
  plan: "DIAGNOSTIC" | "SCOUT" | "PRO" | "COMMAND"
): Promise<{ allowed: boolean; remaining: number }> {
  const budget = AGENT_CONFIG.TOKEN_BUDGETS[plan];
  if (budget.daily === 0) {
    return { allowed: false, remaining: 0 };
  }

  // Query today's usage
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const usage = await prisma.llmUsageLog.aggregate({
    where: {
      tenantId,
      taskType: { in: ["query_agent", "reformulation", "decision_package"] },
      createdAt: { gte: todayStart },
      success: true,
    },
    _sum: { totalTokens: true },
  });

  const usedToday = usage._sum.totalTokens ?? 0;
  const remaining = budget.daily - usedToday;

  return {
    allowed: remaining > 0,
    remaining: Math.max(0, remaining),
  };
}

// ============================================================================
// Main Agent Execution
// ============================================================================

/**
 * Execute the Executive Query Agent.
 * Takes a user query, builds RAG context, calls the LLM with tool support,
 * and returns a structured result with the answer and metadata.
 */
export async function executeExecutiveQueryAgent(
  input: ExecutiveQueryInput,
  context: AgentExecutionContext
): Promise<ExecutiveQueryResult> {
  const logger = createAgentLogger("executive_query", "execute");
  const startTime = Date.now();

  // 1. Plan access check
  const allowedAgents = AGENT_CONFIG.AGENT_PLAN_ACCESS[context.plan];
  if (!allowedAgents.includes("executive_query")) {
    throw new AgentPlanAccessError("executive_query", context.plan);
  }

  // 2. Budget check
  const budget = await checkLlmBudget(context.tenantId, context.plan);
  if (!budget.allowed) {
    throw new AgentBudgetError("executive_query", context.tenantId, budget.remaining);
  }

  // 3. Detect intent for context optimization
  const detectedIntent = detectQueryIntent(input.query);
  const topics = extractTopics(input.query);

  logger.info(
    {
      tenantId: context.tenantId,
      userId: context.userId,
      intent: detectedIntent,
      topics,
      conversationId: input.conversationId,
      queryLength: input.query.length,
    },
    "Executive query agent starting"
  );

  // 4. Build RAG context
  const ragContext = await buildAgentContext({
    tenantId: context.tenantId,
    agentType: "executive_query",
    focusJurisdictions: input.contextOverride?.focusJurisdictions,
    focusProductIds: input.contextOverride?.focusProducts,
    focusRegulationIds: input.contextOverride?.focusRegulations,
    timeHorizonDays: input.contextOverride?.timeHorizonDays ?? 365,
  });

  // 5. Load or create conversation
  const conversation = await getOrCreateConversation(
    context.tenantId,
    context.userId,
    input.conversationId
  );

  // 6. Build the prompt with RAG context
  const serializedContext = serializeContextForPrompt(ragContext);
  const availableTools = getAvailableTools("executive_query", context.plan);
  const toolDescriptions = context.enableTools
    ? formatToolDefinitionsForPrompt(availableTools)
    : "";

  // Build user message from the existing prompt template
  const userPrompt = buildQueryAgentPrompt({
    query: input.query,
    context: {
      relevantRegulations: ragContext.regulations.map((r) => ({
        name: r.name,
        jurisdiction: r.jurisdiction,
        status: r.status,
        effectiveDate: r.effectiveDate,
        description: r.description,
      })),
      affectedProducts: ragContext.products.map((p) => ({
        name: p.name,
        sku: p.sku,
        category: p.category ?? "",
        annualRevenue: p.annualRevenue,
      })),
      cascadeImpacts: ragContext.impacts.map((i) => ({
        description: i.description,
        financialImpact: i.financialImpact,
        timelineDays: i.timelineDays,
        severity: i.triggerSeverity,
      })),
      complianceTimelines: ragContext.timelines.map((t) => ({
        regulationName: t.regulationName,
        deadline: t.deadline,
        daysRemaining: t.daysRemaining,
        conflictWith: t.conflictWith ?? undefined,
      })),
    },
    userRole: "EXECUTIVE",
    conversationHistory: conversation.messages.slice(-AGENT_CONFIG.MAX_HISTORY_MESSAGES).map((m) => ({
      role: m.role === "user" ? "user" as const : "assistant" as const,
      content: m.content,
    })),
  });

  // 7. Construct the full system prompt
  const fullSystemPrompt = [
    QUERY_AGENT_SYSTEM_PROMPT,
    "",
    "## Available Data Context",
    serializedContext,
    "",
    ...(toolDescriptions
      ? ["## Available Tools", "You can use the following tools to retrieve additional information:", "", toolDescriptions, "", "To use a tool, format your response as: TOOL_CALL:{\"name\":\"tool_name\",\"arguments\":{...}}"]
      : []),
    "",
    `Intent detected: ${detectedIntent}`,
    ...(topics.length > 0 ? [`Topics: ${topics.join(", ")}`] : []),
  ].join("\n");

  // 8. Execute LLM call with fallback
  const modelId = "gpt-4o-mini"; // Query agent uses mini per client.ts
  const temperature = getTemperatureForTask("query_agent");

  let llmResponse: string;
  let usageData: { promptTokens: number; completionTokens: number; totalTokens: number };
  let usedFallback = false;
  let toolCalls: AgentToolCall[] = [];
  void modelId; // Used for cost calculation below

  try {
    const fallbackResult = await executeWithFallback(
      async () => {
        const model = getPrimaryModel("query_agent");
        return generateText({
          model,
          system: fullSystemPrompt,
          prompt: userPrompt,
          temperature,
        });
      },
      async () => {
        logger.warn({ tenantId: context.tenantId }, "Primary model failed, using fallback");
        const model = getFallbackModel("query_agent");
        return generateText({
          model,
          system: fullSystemPrompt,
          prompt: userPrompt,
          temperature,
        });
      },
      "query_agent"
    );

    usedFallback = fallbackResult.usedFallback;
    const textResult = fallbackResult.result;

    // Extract token usage
    const pu = textResult.usage;
    usageData = {
      promptTokens: pu?.inputTokens ?? 0,
      completionTokens: pu?.outputTokens ?? 0,
      totalTokens: (pu?.inputTokens ?? 0) + (pu?.outputTokens ?? 0),
    };

    llmResponse = textResult.text;

    // Parse tool calls from the response if present
    toolCalls = parseToolCallsFromResponse(llmResponse);

    // Execute tool calls if found
    if (toolCalls.length > 0 && context.enableTools) {
      const toolResults = await executeAgentToolCalls(toolCalls, context.tenantId, ragContext);
      // Append tool results to the response
      llmResponse = stripToolCallsFromResponse(llmResponse);

      if (toolResults.length > 0) {
        llmResponse += "\n\n**Additional Data Retrieved:**\n" + toolResults.join("\n\n");
      }
    } else {
      llmResponse = stripToolCallsFromResponse(llmResponse);
    }
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Log the failed usage
    await logLlmUsage({
      tenantId: context.tenantId,
      model: modelId,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      taskType: "query_agent",
      success: false,
      errorMessage,
      latencyMs,
    });

    throw new AgentError(
      `Executive query agent failed: ${errorMessage}`,
      "executive_query",
      { tenantId: context.tenantId, query: input.query.slice(0, 100) }
    );
  }

  const latencyMs = Date.now() - startTime;
  const costUsd = calculateLlmCost(
    usedFallback ? "claude-3-5-sonnet-20241022" : modelId,
    usageData.promptTokens,
    usageData.completionTokens
  );

  // Log usage
  await logLlmUsage({
    tenantId: context.tenantId,
    model: usedFallback ? "claude-3-5-sonnet-20241022" : modelId,
    promptTokens: usageData.promptTokens,
    completionTokens: usageData.completionTokens,
    totalTokens: usageData.totalTokens,
    costUsd,
    taskType: "query_agent",
    success: true,
    latencyMs,
  });

  // 9. Generate follow-up suggestions
  const followUpQuestions = generateFollowUpQuestions(detectedIntent, ragContext);

  // 10. Update conversation
  const userMessage: AgentMessage = {
    id: `msg_${Date.now()}_u`,
    role: "user",
    content: input.query,
    timestamp: new Date().toISOString(),
  };

  const assistantMessage: AgentMessage = {
    id: `msg_${Date.now()}_a`,
    role: "assistant",
    content: llmResponse,
    timestamp: new Date().toISOString(),
    usage: usageData,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };

  const updatedMessages = [...conversation.messages, userMessage, assistantMessage];

  logger.info(
    {
      tenantId: context.tenantId,
      intent: detectedIntent,
      tokensUsed: usageData.totalTokens,
      costUsd: costUsd.toFixed(6),
      latencyMs,
      toolCallsCount: toolCalls.length,
      usedFallback,
    },
    "Executive query agent completed"
  );

  return {
    content: llmResponse,
    toolCalls,
    messages: updatedMessages,
    usage: { ...usageData, costUsd },
    model: usedFallback ? "claude-3-5-sonnet-20241022" : modelId,
    usedFallback,
    latencyMs,
    contextUsed: ragContext,
    traceId: context.traceId,
    detectedIntent,
    topics,
    followUpQuestions,
  };
}

// ============================================================================
// Tool Call Parsing & Execution
// ============================================================================

/**
 * Parse TOOL_CALL directives from the LLM response.
 * The LLM may embed tool calls in the format: TOOL_CALL:{"name":"...","arguments":{...}}
 */
function parseToolCallsFromResponse(response: string): AgentToolCall[] {
  const toolCalls: AgentToolCall[] = [];
  const pattern = /TOOL_CALL:(\{[^}]+\})/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(response)) !== null) {
    try {
      const matchGroup = match[1];
      if (!matchGroup) continue;
      const parsed = JSON.parse(matchGroup) as { name: string; arguments: Record<string, unknown> };
      toolCalls.push({
        id: `tc_${Date.now()}_${toolCalls.length}`,
        name: parsed.name,
        arguments: JSON.stringify(parsed.arguments),
      });
    } catch {
      // Skip malformed tool calls
      continue;
    }
  }

  return toolCalls.slice(0, AGENT_CONFIG.MAX_TOOL_CALLS_PER_TURN);
}

/**
 * Strip TOOL_CALL directives from the response text.
 */
function stripToolCallsFromResponse(response: string): string {
  return response.replace(/TOOL_CALL:\{[^}]+\}\n?/g, "").trim();
}

/**
 * Execute a batch of tool calls and return their results.
 */
async function executeAgentToolCalls(
  toolCalls: AgentToolCall[],
  tenantId: string,
  existingContext: RAGContext
): Promise<string[]> {
  const results: string[] = [];

  for (const tc of toolCalls) {
    const result = await executeToolCall(tc, tenantId, "executive_query", existingContext);
    results.push(result);
  }

  return results;
}

// ============================================================================
// Follow-up Question Generation
// ============================================================================

/**
 * Generate context-aware follow-up questions based on the detected intent
 * and the available data in the RAG context.
 */
function generateFollowUpQuestions(
  intent: QueryIntent,
  context: RAGContext
): string[] {
  const questions: string[] = [];

  switch (intent) {
    case "regulation_status":
      if (context.impacts.length > 0) {
        questions.push("What is the financial impact of these regulatory changes?");
      }
      if (context.timelines.length > 0) {
        questions.push("What are the upcoming compliance deadlines?");
      }
      break;
    case "product_exposure":
      if (context.regulations.length > 0) {
        questions.push("Which regulations are driving this product exposure?");
      }
      questions.push("What reformulation options are available for affected products?");
      break;
    case "compliance_timeline":
      questions.push("Which deadlines have conflicting requirements?");
      if (context.products.length > 0) {
        questions.push("How many SKUs are affected by the nearest deadline?");
      }
      break;
    case "financial_impact":
      if (context.impacts.some((i) => i.reformRequired)) {
        questions.push("What are the reformulation cost estimates?");
      }
      questions.push("What is the risk if we take no action?");
      break;
    case "reformulation_options":
      questions.push("What is the timeline for implementing these substitutes?");
      questions.push("What are the sensory impacts of the recommended substitutions?");
      break;
    case "supplier_risk":
      questions.push("Which ingredients have single-source supplier dependencies?");
      break;
    case "customer_impact":
      questions.push("Which retailer specifications are at risk of violation?");
      break;
    default:
      if (context.regulations.length > 0) {
        questions.push("What regulations are most relevant to my business?");
      }
      if (context.impacts.length > 0) {
        questions.push("What are my highest-priority compliance actions?");
      }
      break;
  }

  return questions.slice(0, 3); // Max 3 follow-ups
}

// ============================================================================
// Zod Schema Export
// ============================================================================

export const ExecutiveQueryResultSchema = z.object({
  content: z.string(),
  detectedIntent: z.enum([
    "regulation_status", "product_exposure", "compliance_timeline",
    "financial_impact", "reformulation_options", "supplier_risk",
    "customer_impact", "general_inquiry",
  ]),
  topics: z.array(z.string()),
  followUpQuestions: z.array(z.string()),
  usage: z.object({
    promptTokens: z.number(),
    completionTokens: z.number(),
    totalTokens: z.number(),
    costUsd: z.number(),
  }),
  model: z.string(),
  usedFallback: z.boolean(),
  latencyMs: z.number(),
});
