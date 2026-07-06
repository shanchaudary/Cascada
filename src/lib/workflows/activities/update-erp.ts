// Cascada — Update ERP Activity
// Temporal activity that pushes changes from Cascada workflows back to
// the customer's ERP system. This is the critical integration point
// where compliance actions become real operational changes — updating
// Bills of Materials, ingredient records, pricing, and item status.
// Uses the ERP connector infrastructure from Stage 5.

import { prisma, withTenant } from "@/lib/db";
import { createWorkflowLogger } from "@/lib/logger";
import { WorkflowActivityError } from "@/lib/errors";
import type {
  UpdateErpInput,
  UpdateErpOutput,
} from "../types";
import { UpdateErpInputSchema } from "../types";

const logger = createWorkflowLogger("activity-update-erp");

// ============================================================================
// ERP Operation Handlers
// ============================================================================

/**
 * Map of ERP operations to their handler functions.
 * Each handler receives the ERP connection details, entity IDs,
 * and update payload, then calls the appropriate ERP API endpoint.
 */
const ERP_OPERATION_HANDLERS: Record<
  string,
  (conn: ErpConnectionRecord, entityIds: string[], payload: Record<string, unknown>) => Promise<ErpOperationResult>
> = {
  update_bom: handleUpdateBom,
  update_item: handleUpdateItem,
  update_supplier: handleUpdateSupplier,
  update_pricing: handleUpdatePricing,
  deactivate_item: handleDeactivateItem,
};

interface ErpConnectionRecord {
  id: string;
  erpType: string;
  connectionName: string;
  connectionString: string;
  authConfig: unknown;
  fieldMappings: unknown;
  syncStatus: string;
}

interface ErpOperationResult {
  entitiesUpdated: number;
  entityIds: string[];
  errors: Array<{ entityId: string; error: string }>;
}

// ============================================================================
// Activity Implementation
// ============================================================================

/**
 * Update ERP Activity — pushes workflow changes to the ERP system.
 *
 * This activity performs the following:
 * 1. Validates the input using Zod schema
 * 2. Retrieves the ERP connection from the database
 * 3. Verifies the connection is active and healthy
 * 4. Dispatches the operation to the appropriate handler
 * 5. Records the result in the database for audit
 * 6. Returns success/failure status with error details
 *
 * Idempotency: uses workflowInstanceId + stepId as deduplication key.
 * If an ERP update for this step was already applied successfully,
 * it is returned without re-executing.
 *
 * Retry policy: up to 3 retries with exponential backoff.
 * ERP systems may have transient failures that resolve on retry.
 */
export async function updateErp(input: UpdateErpInput): Promise<UpdateErpOutput> {
  const log = logger.child({
    stepId: input.stepId,
    workflowInstanceId: input.workflowInstanceId,
    operation: input.operation,
  });

  // Validate input
  const parsed = UpdateErpInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new WorkflowActivityError(
      "updateErp",
      `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      { validationErrors: parsed.error.issues }
    );
  }

  const validated = parsed.data;
  log.info(
    { operation: validated.operation, entityCount: validated.entityIds.length },
    "Starting ERP update"
  );

  try {
    // Check idempotency — if this step was already processed, return cached result
    const existingResult = await checkIdempotencyKey(validated.tenantId, validated.workflowInstanceId, validated.stepId);
    if (existingResult) {
      log.info("ERP update already applied — returning cached result");
      return existingResult;
    }

    // Retrieve ERP connection from database
    const erpConnection = await withTenant(validated.tenantId, async () => {
      const conn = await prisma.erpConnection.findUnique({
        where: { id: validated.erpConnectionId },
      });

      if (!conn) {
        throw new WorkflowActivityError(
          "updateErp",
          `ERP connection not found: ${validated.erpConnectionId}`,
          { erpConnectionId: validated.erpConnectionId }
        );
      }

      if (conn.syncStatus === "DISCONNECTED" || conn.syncStatus === "ERROR") {
        throw new WorkflowActivityError(
          "updateErp",
          `ERP connection is not available (status: ${conn.syncStatus})`,
          { erpConnectionId: validated.erpConnectionId, syncStatus: conn.syncStatus }
        );
      }

      return conn;
    });

    // Dispatch to the appropriate operation handler
    const handler = ERP_OPERATION_HANDLERS[validated.operation];
    if (!handler) {
      throw new WorkflowActivityError(
        "updateErp",
        `Unknown ERP operation: ${validated.operation}`,
        { operation: validated.operation }
      );
    }

    const operationResult = await handler(
      erpConnection as unknown as ErpConnectionRecord,
      validated.entityIds,
      validated.updatePayload
    );

    // Determine overall sync status
    const syncStatus = operationResult.errors.length === 0
      ? "synced"
      : operationResult.entitiesUpdated > 0
        ? "partial"
        : "failed";

    // Record the result in the audit log
    const completedAt = new Date().toISOString();
    await withTenant(validated.tenantId, async () => {
      await prisma.auditLog.create({
        data: {
          tenantId: validated.tenantId,
          action: "erp_update_completed",
          entityType: "workflow_step",
          entityId: `${validated.workflowInstanceId}_${validated.stepId}`,
          newValue: {
            operation: validated.operation,
            erpConnectionId: validated.erpConnectionId,
            erpType: erpConnection.erpType,
            entitiesUpdated: operationResult.entitiesUpdated,
            entityIds: operationResult.entityIds,
            syncStatus,
            errors: operationResult.errors,
            completedAt,
          },
        },
      });

      // Create a sync log entry
      await prisma.syncLog.create({
        data: {
          erpConnectionId: validated.erpConnectionId,
          syncType: "incremental",
          entityType: `workflow_${validated.operation}`,
          recordsTotal: validated.entityIds.length,
          recordsSuccess: operationResult.entitiesUpdated,
          recordsFailed: operationResult.errors.length,
          errorDetails: operationResult.errors.length > 0 ? { errors: operationResult.errors } : undefined,
          startedAt: new Date(validated.triggeredAt),
          completedAt: new Date(),
          duration: Date.now() - new Date(validated.triggeredAt).getTime(),
        },
      });
    });

    log.info(
      {
        entitiesUpdated: operationResult.entitiesUpdated,
        syncStatus,
        errorCount: operationResult.errors.length,
      },
      "ERP update completed"
    );

    return {
      operation: validated.operation,
      entitiesUpdated: operationResult.entitiesUpdated,
      entityIds: operationResult.entityIds,
      syncStatus,
      errors: operationResult.errors,
      completedAt,
    };
  } catch (error) {
    if (error instanceof WorkflowActivityError) throw error;

    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message }, "ERP update failed");
    throw new WorkflowActivityError("updateErp", message, {
      workflowInstanceId: validated.workflowInstanceId,
      stepId: validated.stepId,
      operation: validated.operation,
    });
  }
}

// ============================================================================
// ERP Operation Handlers
// ============================================================================

/**
 * Update a Bill of Materials (BOM) in the ERP system.
 * Used during reformulation workflows when ingredients are replaced.
 * Calls the ERP's BOM API with the updated ingredient list,
 * quantities, and unit of measure for each affected formulation.
 */
async function handleUpdateBom(
  connection: ErpConnectionRecord,
  entityIds: string[],
  payload: Record<string, unknown>
): Promise<ErpOperationResult> {
  logger.info(
    { erpType: connection.erpType, bomCount: entityIds.length },
    "Updating BOMs in ERP"
  );

  const results: ErpOperationResult = {
    entitiesUpdated: 0,
    entityIds: [],
    errors: [],
  };

  for (const bomId of entityIds) {
    try {
      await callErpApi(connection, "PUT", `/bom/${bomId}`, {
        items: payload["items"],
        version: payload["version"],
        effectiveDate: payload["effectiveDate"],
        changeReason: payload["changeReason"],
      });
      results.entitiesUpdated++;
      results.entityIds.push(bomId);
    } catch (error) {
      results.errors.push({
        entityId: bomId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/**
 * Update an ingredient item record in the ERP system.
 * Used when ingredient properties change (e.g., supplier, certifications,
 * allergen flags) as part of a compliance or reformulation action.
 */
async function handleUpdateItem(
  connection: ErpConnectionRecord,
  entityIds: string[],
  payload: Record<string, unknown>
): Promise<ErpOperationResult> {
  logger.info(
    { erpType: connection.erpType, itemCount: entityIds.length },
    "Updating items in ERP"
  );

  const results: ErpOperationResult = {
    entitiesUpdated: 0,
    entityIds: [],
    errors: [],
  };

  for (const itemId of entityIds) {
    try {
      await callErpApi(connection, "PATCH", `/items/${itemId}`, payload);
      results.entitiesUpdated++;
      results.entityIds.push(itemId);
    } catch (error) {
      results.errors.push({
        entityId: itemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/**
 * Update supplier information in the ERP system.
 * Used during supplier transition workflows when alternative suppliers
 * are identified and need to be linked to ingredients.
 */
async function handleUpdateSupplier(
  connection: ErpConnectionRecord,
  entityIds: string[],
  payload: Record<string, unknown>
): Promise<ErpOperationResult> {
  logger.info(
    { erpType: connection.erpType, supplierCount: entityIds.length },
    "Updating suppliers in ERP"
  );

  const results: ErpOperationResult = {
    entitiesUpdated: 0,
    entityIds: [],
    errors: [],
  };

  for (const supplierId of entityIds) {
    try {
      await callErpApi(connection, "PATCH", `/suppliers/${supplierId}`, payload);
      results.entitiesUpdated++;
      results.entityIds.push(supplierId);
    } catch (error) {
      results.errors.push({
        entityId: supplierId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/**
 * Update pricing in the ERP system.
 * Used when reformulation or supplier changes affect the cost of
 * ingredients, formulations, or finished products.
 */
async function handleUpdatePricing(
  connection: ErpConnectionRecord,
  entityIds: string[],
  payload: Record<string, unknown>
): Promise<ErpOperationResult> {
  logger.info(
    { erpType: connection.erpType, priceCount: entityIds.length },
    "Updating pricing in ERP"
  );

  const results: ErpOperationResult = {
    entitiesUpdated: 0,
    entityIds: [],
    errors: [],
  };

  for (const priceId of entityIds) {
    try {
      await callErpApi(connection, "PUT", `/pricing/${priceId}`, payload);
      results.entitiesUpdated++;
      results.entityIds.push(priceId);
    } catch (error) {
      results.errors.push({
        entityId: priceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/**
 * Deactivate an item in the ERP system.
 * Used during product withdrawal workflows when a product must be
 * removed from the active catalog. The item is marked as inactive
 * rather than deleted to preserve historical records.
 */
async function handleDeactivateItem(
  connection: ErpConnectionRecord,
  entityIds: string[],
  payload: Record<string, unknown>
): Promise<ErpOperationResult> {
  logger.info(
    { erpType: connection.erpType, itemCount: entityIds.length },
    "Deactivating items in ERP"
  );

  const results: ErpOperationResult = {
    entitiesUpdated: 0,
    entityIds: [],
    errors: [],
  };

  for (const itemId of entityIds) {
    try {
      await callErpApi(connection, "PATCH", `/items/${itemId}`, {
        isActive: false,
        deactivatedReason: payload["reason"],
        deactivatedAt: new Date().toISOString(),
      });
      results.entitiesUpdated++;
      results.entityIds.push(itemId);
    } catch (error) {
      results.errors.push({
        entityId: itemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

// ============================================================================
// ERP API Client
// ============================================================================

/**
 * Call the ERP system's REST API.
 * This is a real API call that uses the connection details from the
 * database to authenticate and communicate with the ERP system.
 * The actual API format varies by ERP type (NetSuite, SAP B1, etc.)
 * and the field mappings configured for the connection.
 */
async function callErpApi(
  connection: ErpConnectionRecord,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<Response> {
  // Build the request URL from the connection string
  const baseUrl = connection.connectionString;
  const url = `${baseUrl}${path}`;

  // Get auth headers based on ERP type
  const authHeaders = buildAuthHeaders(connection);

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ERP API error (${response.status}): ${errorText}`);
  }

  return response;
}

/**
 * Build authentication headers for the ERP API call.
 * Each ERP type uses a different authentication mechanism:
 * - NetSuite: Token-Based Authentication (TBA)
 * - SAP B1: Session-based with CSLF token
 * - Dynamics 365 BC: OAuth2 Bearer token
 * - Infor M3: OAuth2 with ION API
 * - Epicor P21: Basic auth or API key
 */
function buildAuthHeaders(connection: ErpConnectionRecord): Record<string, string> {
  const authConfig = connection.authConfig as Record<string, unknown> | null;

  switch (connection.erpType) {
    case "NETSUITE": {
      // NetSuite Token-Based Authentication
      const tokenId = (authConfig?.["tokenId"] as string) ?? "";
      const tokenSecret = (authConfig?.["tokenSecret"] as string) ?? "";
      return {
        Authorization: `NLAuth nlauth_account=${authConfig?.["account"]}, nlauth_signature=${tokenSecret}`,
        "X-NetSuite-TokenId": tokenId,
      };
    }
    case "SAP_B1": {
      const sessionId = (authConfig?.["sessionId"] as string) ?? "";
      return {
        Cookie: `B1SESSION=${sessionId}`,
      };
    }
    case "DYNAMICS_365_BC": {
      const accessToken = (authConfig?.["accessToken"] as string) ?? "";
      return {
        Authorization: `Bearer ${accessToken}`,
      };
    }
    case "INFOR_M3": {
      const accessToken = (authConfig?.["accessToken"] as string) ?? "";
      return {
        Authorization: `Bearer ${accessToken}`,
      };
    }
    case "EPICOR_P21": {
      const apiKey = (authConfig?.["apiKey"] as string) ?? "";
      return {
        Authorization: `Basic ${apiKey}`,
      };
    }
    default:
      return {};
  }
}

// ============================================================================
// Idempotency Check
// ============================================================================

/**
 * Check if an ERP update for this workflow step has already been completed.
 * Returns the previous result if found, or null if this is a new execution.
 * This prevents duplicate ERP updates when a workflow activity is retried.
 */
async function checkIdempotencyKey(
  tenantId: string,
  workflowInstanceId: string,
  stepId: string
): Promise<UpdateErpOutput | null> {
  const existing = await withTenant(tenantId, async () => {
    return prisma.auditLog.findFirst({
      where: {
        tenantId,
        action: "erp_update_completed",
        entityType: "workflow_step",
        entityId: `${workflowInstanceId}_${stepId}`,
      },
    });
  });

  if (!existing?.newValue) return null;

  const data = existing.newValue as Record<string, unknown>;
  return {
    operation: data["operation"] as string,
    entitiesUpdated: data["entitiesUpdated"] as number,
    entityIds: data["entityIds"] as string[],
    syncStatus: data["syncStatus"] as "synced" | "queued" | "partial" | "failed",
    errors: (data["errors"] as Array<{ entityId: string; error: string }>) ?? [],
    completedAt: data["completedAt"] as string,
  };
}
