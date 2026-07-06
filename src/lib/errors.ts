// Cascada — Custom Error Types
// Structured error handling. No console.log, no generic Error.
// Every error in the system is one of these types with a code, message, and context.

/**
 * Base application error with structured fields.
 * All custom errors extend this class.
 */
export class CascadaError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly context: Record<string, unknown>;
  public readonly isOperational: boolean;
  public readonly timestamp: string;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    context: Record<string, unknown> = {},
    isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();

    // Maintain proper stack trace in V8 environments
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        name: this.name,
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        context: this.context,
        timestamp: this.timestamp,
      },
    };
  }
}

// ============================================================================
// Authentication & Authorization Errors (401, 403)
// ============================================================================

export class AuthenticationError extends CascadaError {
  constructor(message: string = "Authentication required", context?: Record<string, unknown>) {
    super(message, "AUTH_REQUIRED", 401, context);
  }
}

export class InvalidCredentialsError extends CascadaError {
  constructor(context?: Record<string, unknown>) {
    super("Invalid email or password", "INVALID_CREDENTIALS", 401, context);
  }
}

export class TokenExpiredError extends CascadaError {
  constructor(context?: Record<string, unknown>) {
    super("Session has expired", "TOKEN_EXPIRED", 401, context);
  }
}

export class AuthorizationError extends CascadaError {
  constructor(
    message: string = "Insufficient permissions",
    context?: Record<string, unknown>
  ) {
    super(message, "FORBIDDEN", 403, context);
  }
}

export class TenantAccessError extends CascadaError {
  constructor(tenantId: string, context?: Record<string, unknown>) {
    super("Access denied to tenant", "TENANT_ACCESS_DENIED", 403, {
      tenantId,
      ...context,
    });
  }
}

// ============================================================================
// Validation Errors (400)
// ============================================================================

export class ValidationError extends CascadaError {
  public readonly validationErrors: Array<{
    field: string;
    message: string;
    value?: unknown;
  }>;

  constructor(
    validationErrors: Array<{ field: string; message: string; value?: unknown }>,
    message: string = "Validation failed"
  ) {
    super(message, "VALIDATION_ERROR", 400, { validationErrors });
    this.validationErrors = validationErrors;
  }
}

export class InvalidInputError extends CascadaError {
  constructor(field: string, message: string, value?: unknown) {
    super(`Invalid input for ${field}: ${message}`, "INVALID_INPUT", 400, {
      field,
      value,
    });
  }
}

// ============================================================================
// Resource Errors (404, 409)
// ============================================================================

export class NotFoundError extends CascadaError {
  constructor(resource: string, id?: string, context?: Record<string, unknown>) {
    super(
      `${resource}${id ? ` with id ${id}` : ""} not found`,
      "NOT_FOUND",
      404,
      { resource, id, ...context }
    );
  }
}

export class ConflictError extends CascadaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "CONFLICT", 409, context);
  }
}

// ============================================================================
// ERP Integration Errors
// ============================================================================

export class ErpConnectionError extends CascadaError {
  constructor(erpType: string, message: string, context?: Record<string, unknown>) {
    super(`ERP connection error (${erpType}): ${message}`, "ERP_CONNECTION_ERROR", 502, {
      erpType,
      ...context,
    });
  }
}

export class ErpSyncError extends CascadaError {
  constructor(
    erpType: string,
    entityType: string,
    message: string,
    context?: Record<string, unknown>
  ) {
    super(
      `ERP sync error (${erpType}, ${entityType}): ${message}`,
      "ERP_SYNC_ERROR",
      502,
      { erpType, entityType, ...context }
    );
  }
}

export class ErpAuthError extends CascadaError {
  constructor(erpType: string, message: string = "Authentication failed") {
    super(`ERP auth error (${erpType}): ${message}`, "ERP_AUTH_ERROR", 401, {
      erpType,
    });
  }
}

// ============================================================================
// LLM Errors
// ============================================================================

export class LlmError extends CascadaError {
  constructor(message: string, model: string, context?: Record<string, unknown>) {
    super(`LLM error (${model}): ${message}`, "LLM_ERROR", 502, {
      model,
      ...context,
    });
  }
}

export class LlmStructuredOutputError extends CascadaError {
  constructor(model: string, context?: Record<string, unknown>) {
    super(
      `LLM failed to produce valid structured output`,
      "LLM_STRUCTURED_OUTPUT_ERROR",
      502,
      { model, ...context }
    );
  }
}

export class LlmRateLimitError extends CascadaError {
  constructor(model: string, context?: Record<string, unknown>) {
    super(`LLM rate limit exceeded (${model})`, "LLM_RATE_LIMIT", 429, {
      model,
      ...context,
    });
  }
}

// ============================================================================
// Pipeline Errors
// ============================================================================

export class PipelineError extends CascadaError {
  constructor(pipelineType: string, message: string, context?: Record<string, unknown>) {
    super(
      `Pipeline error (${pipelineType}): ${message}`,
      "PIPELINE_ERROR",
      502,
      { pipelineType, ...context }
    );
  }
}

export class PipelineRateLimitError extends CascadaError {
  constructor(pipelineType: string, context?: Record<string, unknown>) {
    super(
      `Pipeline rate limit exceeded (${pipelineType})`,
      "PIPELINE_RATE_LIMIT",
      429,
      { pipelineType, ...context }
    );
  }
}

// ============================================================================
// Cascade Engine Errors
// ============================================================================

export class CascadeGraphError extends CascadaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`Cascade graph error: ${message}`, "CASCADE_GRAPH_ERROR", 500, context);
  }
}

export class CascadeTraversalError extends CascadaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(
      `Cascade traversal error: ${message}`,
      "CASCADE_TRAVERSAL_ERROR",
      500,
      context
    );
  }
}

export class CascadeImpactError extends CascadaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(
      `Cascade impact scoring error: ${message}`,
      "CASCADE_IMPACT_ERROR",
      500,
      context
    );
  }
}

export class CascadeCostError extends CascadaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(
      `Cascade cost estimation error: ${message}`,
      "CASCADE_COST_ERROR",
      500,
      context
    );
  }
}

export class CascadeTimelineError extends CascadaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(
      `Cascade timeline error: ${message}`,
      "CASCADE_TIMELINE_ERROR",
      500,
      context
    );
  }
}

// ============================================================================
// Payment Errors
// ============================================================================

export class PaymentError extends CascadaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "PAYMENT_ERROR", 402, context);
  }
}

export class PaymentRequiredError extends CascadaError {
  constructor(feature: string, plan: string, context?: Record<string, unknown>) {
    super(
      `Feature '${feature}' requires ${plan} plan or higher`,
      "PAYMENT_REQUIRED",
      402,
      { feature, requiredPlan: plan, ...context }
    );
  }
}

// ============================================================================
// Rule Engine Errors
// ============================================================================

export class RuleParsingError extends CascadaError {
  constructor(
    sourceId: string,
    message: string,
    context?: Record<string, unknown>
  ) {
    super(
      `Rule parsing error for source ${sourceId}: ${message}`,
      "RULE_PARSING_ERROR",
      422,
      { sourceId, ...context }
    );
  }
}

export class SubstanceMatchError extends CascadaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(
      `Substance matching error: ${message}`,
      "SUBSTANCE_MATCH_ERROR",
      422,
      context
    );
  }
}

export class SmeValidationError extends CascadaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(
      `SME validation error: ${message}`,
      "SME_VALIDATION_ERROR",
      403,
      context
    );
  }
}

// ============================================================================
// Error helper: determine if an error is operational (expected) or programming (bug)
// ============================================================================

export function isOperationalError(error: Error): boolean {
  if (error instanceof CascadaError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Convert unknown thrown values into a proper Error object.
 * Use in catch blocks where the caught value is `unknown`.
 */
export function toError(unknown: unknown): Error {
  if (unknown instanceof Error) return unknown;
  if (typeof unknown === "string") return new Error(unknown);
  return new Error(`Unknown error: ${JSON.stringify(unknown)}`);
}
