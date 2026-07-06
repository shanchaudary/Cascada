// Cascada — ERP Sync Engine
// Orchestrates incremental and full syncs between ERP systems and our database.
// Handles: watermark management, conflict detection/resolution, sync logging,
// concurrent sync limits, and sync state persistence.

import type { ErpType } from "@prisma/client";
import type {
  SyncWatermark,
  SyncResult,
  MultiEntitySyncResult,
  ErpIngredient,
  ErpFormulation,
  ErpProduct,
  ErpCustomer,
  ErpSupplier,
  FieldMappingConfig,
  SyncError,
} from "../../types/erp";
import type {
  SyncExecutionContext,
  ConflictResolutionStrategy,
  SyncConflict,
  ConflictResolutionResult,
  ErpConnectorParams,
} from "./types";
import { prisma, withTenant } from "../db";
import { createErpSyncLogger } from "../logger";
import { ErpSyncError, ErpConnectionError } from "../errors";
import { ERP_SYNC_CONFIG, PLAN_FEATURES } from "../constants";
import { BaseErpConnector } from "./base-connector";

// ============================================================================
// Sync Engine
// ============================================================================

/**
 * Central sync engine that coordinates all ERP sync operations.
 *
 * Responsibilities:
 * - Manage sync lifecycle (start, execute, complete, fail)
 * - Persist sync logs to the SyncLog table
 * - Update ErpConnection sync state and watermarks
 * - Detect and resolve conflicts between ERP and local data
 * - Enforce concurrent sync limits per tenant
 * - Upsert synced entities into the database
 * - Update cascade graph after significant data changes
 */
export class ErpSyncEngine {
  private readonly logger = createErpSyncLogger("engine", "global", "sync-engine");

  /**
   * Execute a full sync for all entity types on an ERP connection.
   * This replaces all local data with fresh data from the ERP.
   */
  async executeFullSync(
    connector: BaseErpConnector,
    tenantId: string,
    connectionId: string,
    conflictStrategy: ConflictResolutionStrategy = "erp_wins"
  ): Promise<MultiEntitySyncResult> {
    const startTime = Date.now();

    this.logger.info(
      { tenantId, connectionId, erpType: connector.erpType, conflictStrategy },
      "Starting full ERP sync"
    );

    // Validate tenant can perform ERP sync (COMMAND plan required)
    await this.validateSyncAllowed(tenantId, connectionId);

    // Update connection status to SYNCING
    await this.updateConnectionStatus(connectionId, "SYNCING");

    try {
      // Execute the full sync via the connector
      const result = await connector.fullSync();

      // Persist all synced entities to the database
      const persistResults = await this.persistSyncResults(
        tenantId,
        connectionId,
        result,
        conflictStrategy
      );

      // Log the sync
      await this.logSync(connectionId, "full", "all", {
        recordsTotal:
          result.ingredients.recordsTotal +
          result.formulations.recordsTotal +
          result.products.recordsTotal +
          result.customers.recordsTotal +
          result.suppliers.recordsTotal,
        recordsSuccess:
          result.ingredients.recordsSuccess +
          result.formulations.recordsSuccess +
          result.products.recordsSuccess +
          result.customers.recordsSuccess +
          result.suppliers.recordsSuccess,
        recordsFailed:
          result.ingredients.recordsFailed +
          result.formulations.recordsFailed +
          result.products.recordsFailed +
          result.customers.recordsFailed +
          result.suppliers.recordsFailed,
        durationMs: result.totalDurationMs,
        persistResults,
      });

      // Update connection status back to CONNECTED
      await this.updateConnectionStatus(connectionId, "CONNECTED");

      // Update watermarks for incremental syncs
      await this.updateWatermarks(connectionId, result);

      const totalDurationMs = Date.now() - startTime;
      this.logger.info(
        {
          tenantId,
          connectionId,
          totalDurationMs,
          ingredientCount: result.ingredients.recordsSuccess,
          formulationCount: result.formulations.recordsSuccess,
          productCount: result.products.recordsSuccess,
          customerCount: result.customers.recordsSuccess,
          supplierCount: result.suppliers.recordsSuccess,
        },
        "Full ERP sync completed successfully"
      );

      return result;
    } catch (error) {
      await this.updateConnectionStatus(connectionId, "ERROR", error instanceof Error ? error.message : undefined);
      throw new ErpSyncError(
        connector.erpType,
        "all",
        `Full sync failed: ${error instanceof Error ? error.message : String(error)}`,
        { tenantId, connectionId }
      );
    }
  }

  /**
   * Execute an incremental sync for a single entity type.
   * Uses the stored watermark to only fetch records modified since the last sync.
   */
  async executeIncrementalSync(
    connector: BaseErpConnector,
    tenantId: string,
    connectionId: string,
    entityType: "ingredients" | "formulations" | "products" | "customers" | "suppliers",
    conflictStrategy: ConflictResolutionStrategy = "newer_wins"
  ): Promise<SyncResult<ErpIngredient | ErpFormulation | ErpProduct | ErpCustomer | ErpSupplier>> {
    const startTime = Date.now();

    this.logger.info(
      { tenantId, connectionId, erpType: connector.erpType, entityType, conflictStrategy },
      "Starting incremental ERP sync"
    );

    await this.validateSyncAllowed(tenantId, connectionId);

    // Get stored watermark for this entity type
    const watermark = await this.getWatermark(connectionId, entityType);

    // Update connection status
    await this.updateConnectionStatus(connectionId, "SYNCING");

    try {
      let result: SyncResult<ErpIngredient | ErpFormulation | ErpProduct | ErpCustomer | ErpSupplier>;

      switch (entityType) {
        case "ingredients":
          result = await connector.syncIngredients(watermark ?? undefined);
          break;
        case "formulations":
          result = await connector.syncFormulations(watermark ?? undefined);
          break;
        case "products":
          result = await connector.syncProducts(watermark ?? undefined);
          break;
        case "customers":
          result = await connector.syncCustomers(watermark ?? undefined);
          break;
        case "suppliers":
          result = await connector.syncSuppliers(watermark ?? undefined);
          break;
        default:
          throw new ErpSyncError(connector.erpType, entityType, `Unknown entity type: ${String(entityType)}`);
      }

      // Persist the synced entities
      await this.persistEntitySync(tenantId, connectionId, entityType, result, conflictStrategy);

      // Log the sync
      await this.logSync(connectionId, "incremental", entityType, {
        recordsTotal: result.recordsTotal,
        recordsSuccess: result.recordsSuccess,
        recordsFailed: result.recordsFailed,
        durationMs: result.durationMs,
      });

      // Update watermark
      if (result.nextWatermark) {
        await this.saveWatermark(connectionId, entityType, result.nextWatermark);
      }

      await this.updateConnectionStatus(connectionId, "CONNECTED");

      this.logger.info(
        {
          tenantId,
          connectionId,
          entityType,
          total: result.recordsTotal,
          success: result.recordsSuccess,
          failed: result.recordsFailed,
          durationMs: Date.now() - startTime,
        },
        "Incremental ERP sync completed"
      );

      return result;
    } catch (error) {
      await this.updateConnectionStatus(connectionId, "ERROR", error instanceof Error ? error.message : undefined);
      throw new ErpSyncError(
        connector.erpType,
        entityType,
        `Incremental sync failed: ${error instanceof Error ? error.message : String(error)}`,
        { tenantId, connectionId }
      );
    }
  }

  // ==========================================================================
  // Data persistence — upsert synced entities into the database
  // ==========================================================================

  /**
   * Persist all entity results from a full sync.
   */
  private async persistSyncResults(
    tenantId: string,
    connectionId: string,
    result: MultiEntitySyncResult,
    conflictStrategy: ConflictResolutionStrategy
  ): Promise<Record<string, { upserted: number; conflicts: number }>> {
    const persistResults: Record<string, { upserted: number; conflicts: number }> = {};

    persistResults["ingredients"] = await this.persistIngredients(tenantId, connectionId, result.ingredients.data, conflictStrategy);
    persistResults["formulations"] = await this.persistFormulations(tenantId, connectionId, result.formulations.data, conflictStrategy);
    persistResults["products"] = await this.persistProducts(tenantId, connectionId, result.products.data, conflictStrategy);
    persistResults["customers"] = await this.persistCustomers(tenantId, connectionId, result.customers.data, conflictStrategy);
    persistResults["suppliers"] = await this.persistSuppliers(tenantId, connectionId, result.suppliers.data, conflictStrategy);

    return persistResults;
  }

  /**
   * Persist a single entity type's sync result.
   */
  private async persistEntitySync(
    tenantId: string,
    connectionId: string,
    entityType: string,
    result: SyncResult<ErpIngredient | ErpFormulation | ErpProduct | ErpCustomer | ErpSupplier>,
    conflictStrategy: ConflictResolutionStrategy
  ): Promise<void> {
    const data = result.data;

    switch (entityType) {
      case "ingredients":
        await this.persistIngredients(tenantId, connectionId, data as ErpIngredient[], conflictStrategy);
        break;
      case "formulations":
        await this.persistFormulations(tenantId, connectionId, data as ErpFormulation[], conflictStrategy);
        break;
      case "products":
        await this.persistProducts(tenantId, connectionId, data as ErpProduct[], conflictStrategy);
        break;
      case "customers":
        await this.persistCustomers(tenantId, connectionId, data as ErpCustomer[], conflictStrategy);
        break;
      case "suppliers":
        await this.persistSuppliers(tenantId, connectionId, data as ErpSupplier[], conflictStrategy);
        break;
    }
  }

  /**
   * Upsert ingredients from ERP into the local database.
   * For each ingredient: if an ingredient with the same tenant+erpId exists, update it;
   * otherwise create a new record.
   */
  private async persistIngredients(
    tenantId: string,
    connectionId: string,
    ingredients: ErpIngredient[],
    conflictStrategy: ConflictResolutionStrategy
  ): Promise<{ upserted: number; conflicts: number }> {
    let upserted = 0;
    let conflicts = 0;

    const result = await withTenant(tenantId, async () => {
      for (const ingredient of ingredients) {
        try {
          const existing = await prisma.ingredient.findFirst({
            where: { tenantId, erpId: ingredient.erpId },
          });

          if (existing) {
            // Check for conflicts
            const hasConflict = this.detectIngredientConflict(existing, ingredient);
            if (hasConflict && conflictStrategy !== "erp_wins") {
              conflicts++;
              if (conflictStrategy === "local_wins") continue;
              if (conflictStrategy === "manual") continue;
              // "newer_wins" and "merge" fall through to update for now
            }

            await prisma.ingredient.update({
              where: { id: existing.id },
              data: {
                name: ingredient.name,
                alternateNames: ingredient.alternateNames,
                casNumber: ingredient.casNumber,
                eenumber: ingredient.eenumber,
                category: ingredient.category,
                isSynthetic: ingredient.isSynthetic,
                sourceType: ingredient.sourceType,
                allergenFlags: ingredient.allergenFlags,
                supplierIds: ingredient.supplierIds,
                metadata: (ingredient.metadata ?? {}) as any,
                updatedAt: new Date(),
              },
            });
          } else {
            await prisma.ingredient.create({
              data: {
                tenantId,
                erpId: ingredient.erpId,
                name: ingredient.name,
                alternateNames: ingredient.alternateNames,
                casNumber: ingredient.casNumber,
                eenumber: ingredient.eenumber,
                category: ingredient.category,
                isSynthetic: ingredient.isSynthetic,
                sourceType: ingredient.sourceType,
                allergenFlags: ingredient.allergenFlags,
                supplierIds: ingredient.supplierIds,
                metadata: (ingredient.metadata ?? {}) as any,
              },
            });
          }
          upserted++;
        } catch (error) {
          this.logger.error(
            { erpId: ingredient.erpId, error: error instanceof Error ? error.message : String(error) },
            "Failed to persist ingredient"
          );
        }
      }
    });

    return { upserted, conflicts };
  }

  /**
   * Upsert formulations (BOMs) from ERP into the local database.
   * Creates formulation records and their associated FormulationItem entries.
   */
  private async persistFormulations(
    tenantId: string,
    connectionId: string,
    formulations: ErpFormulation[],
    conflictStrategy: ConflictResolutionStrategy
  ): Promise<{ upserted: number; conflicts: number }> {
    let upserted = 0;
    let conflicts = 0;

    await withTenant(tenantId, async () => {
      for (const formulation of formulations) {
        try {
          // Find existing formulation by erpId and version
          const existing = await prisma.formulation.findFirst({
            where: { tenantId, erpId: formulation.erpId, version: formulation.version },
            include: { items: true },
          });

          const formulationData = {
            name: formulation.name,
            description: formulation.description,
            version: formulation.version,
            status: this.mapFormulationStatus(formulation.status),
            batchSize: formulation.batchSize,
            batchSizeUnit: formulation.batchSizeUnit,
            totalCost: formulation.totalCost,
          };

          if (existing) {
            const hasConflict = this.detectFormulationConflict(existing, formulation);
            if (hasConflict && conflictStrategy !== "erp_wins") {
              conflicts++;
              if (conflictStrategy === "local_wins") continue;
            }

            // Delete existing items and recreate (simpler than diffing)
            await prisma.formulationItem.deleteMany({
              where: { formulationId: existing.id },
            });

            await prisma.formulation.update({
              where: { id: existing.id },
              data: formulationData,
            });

            // Create new items
            await this.createFormulationItems(existing.id, formulation, tenantId);
          } else {
            const newFormulation = await prisma.formulation.create({
              data: {
                tenantId,
                erpId: formulation.erpId,
                ...formulationData,
              },
            });

            await this.createFormulationItems(newFormulation.id, formulation, tenantId);
          }
          upserted++;
        } catch (error) {
          this.logger.error(
            { erpId: formulation.erpId, error: error instanceof Error ? error.message : String(error) },
            "Failed to persist formulation"
          );
        }
      }
    });

    return { upserted, conflicts };
  }

  /**
   * Create FormulationItem records for a formulation.
   * Resolves ingredient ERP IDs to internal ingredient IDs.
   */
  private async createFormulationItems(
    formulationId: string,
    formulation: ErpFormulation,
    tenantId: string
  ): Promise<void> {
    for (const item of formulation.items) {
      // Resolve ingredient by ERP ID
      const ingredient = await prisma.ingredient.findFirst({
        where: { tenantId, erpId: item.ingredientErpId },
      });

      if (!ingredient) {
        this.logger.warn(
          { ingredientErpId: item.ingredientErpId, formulationErpId: formulation.erpId },
          "Ingredient not found for formulation item, skipping"
        );
        continue;
      }

      // Resolve replacement ingredient if specified
      let replacesIngredientId: string | null = null;
      if (item.replacesIngredientErpId) {
        const replacement = await prisma.ingredient.findFirst({
          where: { tenantId, erpId: item.replacesIngredientErpId },
        });
        replacesIngredientId = replacement?.id ?? null;
      }

      await prisma.formulationItem.create({
        data: {
          formulationId,
          ingredientId: ingredient.id,
          quantity: item.quantity,
          unit: item.unit,
          percentage: item.percentage,
          isAlternate: item.isAlternate,
          replacesIngredientId: replacesIngredientId,
          sortOrder: item.sortOrder,
        },
      });
    }
  }

  /**
   * Upsert products from ERP into the local database.
   * Also creates ProductFormulation links and CustomerProduct associations.
   */
  private async persistProducts(
    tenantId: string,
    connectionId: string,
    products: ErpProduct[],
    conflictStrategy: ConflictResolutionStrategy
  ): Promise<{ upserted: number; conflicts: number }> {
    let upserted = 0;
    let conflicts = 0;

    await withTenant(tenantId, async () => {
      for (const product of products) {
        try {
          const existing = await prisma.product.findFirst({
            where: { tenantId, sku: product.sku },
          });

          const productData = {
            name: product.name,
            category: product.category,
            brand: product.brand,
            markets: product.markets,
            retailers: product.retailers,
            isActive: product.isActive,
            annualVolume: product.annualVolume,
            annualRevenue: product.annualRevenue,
          };

          if (existing) {
            const hasConflict = this.detectProductConflict(existing, product);
            if (hasConflict && conflictStrategy !== "erp_wins") {
              conflicts++;
              if (conflictStrategy === "local_wins") continue;
            }

            await prisma.product.update({
              where: { id: existing.id },
              data: productData,
            });

            // Update formulation links
            await this.updateProductFormulations(existing.id, product, tenantId);
          } else {
            const newProduct = await prisma.product.create({
              data: {
                tenantId,
                erpId: product.erpId,
                sku: product.sku,
                ...productData,
              },
            });

            await this.updateProductFormulations(newProduct.id, product, tenantId);
          }
          upserted++;
        } catch (error) {
          this.logger.error(
            { sku: product.sku, error: error instanceof Error ? error.message : String(error) },
            "Failed to persist product"
          );
        }
      }
    });

    return { upserted, conflicts };
  }

  /**
   * Update ProductFormulation links for a product.
   */
  private async updateProductFormulations(
    productId: string,
    product: ErpProduct,
    tenantId: string
  ): Promise<void> {
    for (const formulationErpId of product.formulationErpIds) {
      const formulation = await prisma.formulation.findFirst({
        where: { tenantId, erpId: formulationErpId },
      });

      if (formulation) {
        await prisma.productFormulation.upsert({
          where: {
            id: `${productId}_${formulation.id}`, // Composite key workaround
          },
          create: {
            productId,
            formulationId: formulation.id,
            isCurrent: true,
            effectiveDate: new Date(),
          },
          update: {
            isCurrent: true,
          },
        });
      }
    }
  }

  /**
   * Upsert customers from ERP into the local database.
   */
  private async persistCustomers(
    tenantId: string,
    connectionId: string,
    customers: ErpCustomer[],
    conflictStrategy: ConflictResolutionStrategy
  ): Promise<{ upserted: number; conflicts: number }> {
    let upserted = 0;
    let conflicts = 0;

    await withTenant(tenantId, async () => {
      for (const customer of customers) {
        try {
          const existing = await prisma.customer.findFirst({
            where: { tenantId, erpId: customer.erpId },
          });

          const customerData = {
            name: customer.name,
            type: this.mapCustomerType(customer.type),
            requirements: (customer.requirements ?? {}) as any,
            contactEmail: customer.contactEmail,
          };

          if (existing) {
            await prisma.customer.update({
              where: { id: existing.id },
              data: customerData,
            });
          } else {
            await prisma.customer.create({
              data: {
                tenantId,
                erpId: customer.erpId,
                ...customerData,
              },
            });
          }
          upserted++;
        } catch (error) {
          this.logger.error(
            { erpId: customer.erpId, error: error instanceof Error ? error.message : String(error) },
            "Failed to persist customer"
          );
        }
      }
    });

    return { upserted, conflicts };
  }

  /**
   * Upsert suppliers from ERP into the local database.
   */
  private async persistSuppliers(
    tenantId: string,
    connectionId: string,
    suppliers: ErpSupplier[],
    conflictStrategy: ConflictResolutionStrategy
  ): Promise<{ upserted: number; conflicts: number }> {
    let upserted = 0;
    let conflicts = 0;

    await withTenant(tenantId, async () => {
      for (const supplier of suppliers) {
        try {
          const existing = await prisma.supplier.findFirst({
            where: { tenantId, erpId: supplier.erpId },
          });

          const supplierData = {
            name: supplier.name,
            contactEmail: supplier.contactEmail,
            certifications: supplier.certifications,
            ingredientIds: supplier.ingredientErpIds,
            riskScore: supplier.riskScore,
          };

          if (existing) {
            await prisma.supplier.update({
              where: { id: existing.id },
              data: supplierData,
            });
          } else {
            await prisma.supplier.create({
              data: {
                tenantId,
                erpId: supplier.erpId,
                ...supplierData,
              },
            });
          }
          upserted++;
        } catch (error) {
          this.logger.error(
            { erpId: supplier.erpId, error: error instanceof Error ? error.message : String(error) },
            "Failed to persist supplier"
          );
        }
      }
    });

    return { upserted, conflicts };
  }

  // ==========================================================================
  // Conflict detection
  // ==========================================================================

  /**
   * Detect if there's a conflict between a local ingredient and the ERP version.
   * A conflict exists when the same field has different non-null values on both sides.
   */
  private detectIngredientConflict(
    local: { name: string; casNumber: string | null; category: string | null; updatedAt: Date },
    erp: ErpIngredient
  ): boolean {
    if (local.name !== erp.name) return true;
    if (local.casNumber !== (erp.casNumber ?? null)) return true;
    if (local.category !== (erp.category ?? null)) return true;
    return false;
  }

  private detectFormulationConflict(
    local: { name: string; version: number; updatedAt: Date },
    erp: ErpFormulation
  ): boolean {
    if (local.name !== erp.name) return true;
    if (local.version !== erp.version) return true;
    return false;
  }

  private detectProductConflict(
    local: { name: string; sku: string; updatedAt: Date },
    erp: ErpProduct
  ): boolean {
    if (local.name !== erp.name) return true;
    if (local.sku !== erp.sku) return true;
    return false;
  }

  // ==========================================================================
  // Watermark management
  // ==========================================================================

  /**
   * Get the stored watermark for a specific entity type on a connection.
   */
  async getWatermark(
    connectionId: string,
    entityType: string
  ): Promise<SyncWatermark | null> {
    const connection = await prisma.erpConnection.findUnique({
      where: { id: connectionId },
      select: { syncState: true },
    });

    if (!connection) return null;

    const syncState = connection.syncState as Record<string, unknown>;
    const entityState = syncState[entityType] as Record<string, unknown> | undefined;

    if (!entityState) return null;

    return {
      lastSyncTimestamp: entityState["lastSyncTimestamp"] as string,
      cursor: entityState["cursor"] as string | undefined,
      offset: entityState["offset"] as number | undefined,
    };
  }

  /**
   * Save a watermark for a specific entity type on a connection.
   */
  private async saveWatermark(
    connectionId: string,
    entityType: string,
    watermark: SyncWatermark
  ): Promise<void> {
    const connection = await prisma.erpConnection.findUnique({
      where: { id: connectionId },
      select: { syncState: true },
    });

    if (!connection) return;

    const syncState = (connection.syncState as Record<string, unknown>) ?? {};
    syncState[entityType] = {
      lastSyncTimestamp: watermark.lastSyncTimestamp,
      cursor: watermark.cursor,
      offset: watermark.offset,
    };

    await prisma.erpConnection.update({
      where: { id: connectionId },
      data: {
        syncState: syncState as any,
        lastSyncAt: new Date(),
      },
    });
  }

  /**
   * Update watermarks for all entity types after a full sync.
   */
  private async updateWatermarks(
    connectionId: string,
    result: MultiEntitySyncResult
  ): Promise<void> {
    const entities: Array<[string, SyncResult<unknown>]> = [
      ["ingredients", result.ingredients as SyncResult<unknown>],
      ["formulations", result.formulations as SyncResult<unknown>],
      ["products", result.products as SyncResult<unknown>],
      ["customers", result.customers as SyncResult<unknown>],
      ["suppliers", result.suppliers as SyncResult<unknown>],
    ];

    for (const [entityType, syncResult] of entities) {
      if (syncResult.nextWatermark) {
        await this.saveWatermark(connectionId, entityType, syncResult.nextWatermark);
      }
    }
  }

  // ==========================================================================
  // Connection management
  // ==========================================================================

  /**
   * Validate that a tenant is allowed to perform ERP syncs.
   * Only COMMAND plan tenants can use ERP connectors.
   */
  private async validateSyncAllowed(tenantId: string, connectionId: string): Promise<void> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true },
    });

    if (!tenant) {
      throw new ErpConnectionError("unknown", "Tenant not found", { tenantId });
    }

    const planFeatures = PLAN_FEATURES[tenant.plan as keyof typeof PLAN_FEATURES];
    if (!planFeatures || planFeatures.maxErpConnections === 0) {
      throw new ErpConnectionError(
        "unknown",
        `ERP sync requires COMMAND plan. Current plan: ${tenant.plan}`,
        { tenantId, currentPlan: tenant.plan }
      );
    }

    // Check concurrent sync limit
    const activeSyncs = await prisma.erpConnection.count({
      where: {
        tenantId,
        syncStatus: "SYNCING",
      },
    });

    if (activeSyncs >= ERP_SYNC_CONFIG.MAX_CONCURRENT_SYNCS) {
      throw new ErpSyncError(
        "unknown",
        "all",
        `Maximum concurrent syncs reached (${ERP_SYNC_CONFIG.MAX_CONCURRENT_SYNCS})`,
        { tenantId, activeSyncs }
      );
    }
  }

  /**
   * Update the sync status of an ERP connection.
   */
  private async updateConnectionStatus(
    connectionId: string,
    status: "CONNECTED" | "SYNCING" | "ERROR" | "DISCONNECTED",
    errorMessage?: string
  ): Promise<void> {
    await prisma.erpConnection.update({
      where: { id: connectionId },
      data: {
        syncStatus: status,
        ...(errorMessage && { lastSyncError: errorMessage }),
        ...(status === "CONNECTED" && { lastSyncError: null }),
      },
    });
  }

  // ==========================================================================
  // Sync logging
  // ==========================================================================

  /**
   * Create a SyncLog record for a completed sync operation.
   */
  private async logSync(
    connectionId: string,
    syncType: string,
    entityType: string,
    details: {
      recordsTotal: number;
      recordsSuccess: number;
      recordsFailed: number;
      durationMs?: number;
      persistResults?: Record<string, { upserted: number; conflicts: number }>;
    }
  ): Promise<void> {
    await prisma.syncLog.create({
      data: {
        erpConnectionId: connectionId,
        syncType,
        entityType,
        recordsTotal: details.recordsTotal,
        recordsSuccess: details.recordsSuccess,
        recordsFailed: details.recordsFailed,
        errorDetails: details.recordsFailed > 0
          ? { failedCount: details.recordsFailed }
          : undefined,
        startedAt: new Date(Date.now() - (details.durationMs ?? 0)),
        completedAt: new Date(),
        duration: details.durationMs,
      },
    });
  }

  // ==========================================================================
  // Type mapping helpers
  // ==========================================================================

  /**
   * Map ERP formulation status string to our FormulationStatus enum.
   */
  private mapFormulationStatus(status: string): "DRAFT" | "ACTIVE" | "ARCHIVED" | "UNDER_REVIEW" {
    const normalized = status.toUpperCase().replace(/\s+/g, "_");
    switch (normalized) {
      case "ACTIVE":
      case "APPROVED":
      case "RELEASED":
      case "LIVE":
        return "ACTIVE";
      case "DRAFT":
      case "PLANNING":
      case "PENDING":
        return "DRAFT";
      case "ARCHIVED":
      case "INACTIVE":
      case "OBSOLETE":
        return "ARCHIVED";
      case "UNDER_REVIEW":
      case "REVIEW":
      case "PENDING_APPROVAL":
        return "UNDER_REVIEW";
      default:
        return "DRAFT";
    }
  }

  /**
   * Map ERP customer type string to our CustomerType enum.
   */
  private mapCustomerType(type: string): "RETAILER" | "DISTRIBUTOR" | "FOODSERVICE" | "PRIVATE_LABEL" | "DIRECT_TO_CONSUMER" {
    const normalized = type.toUpperCase().replace(/\s+/g, "_");
    switch (normalized) {
      case "RETAILER":
      case "RETAIL":
        return "RETAILER";
      case "DISTRIBUTOR":
      case "WHOLESALER":
        return "DISTRIBUTOR";
      case "FOODSERVICE":
      case "FOOD_SERVICE":
      case "RESTAURANT":
        return "FOODSERVICE";
      case "PRIVATE_LABEL":
      case "PRIVATELABEL":
      case "PL":
        return "PRIVATE_LABEL";
      case "DIRECT_TO_CONSUMER":
      case "DTC":
      case "CONSUMER":
        return "DIRECT_TO_CONSUMER";
      default:
        return "DISTRIBUTOR";
    }
  }

  // ==========================================================================
  // Connector factory
  // ==========================================================================

  /**
   * Create a connector instance from connection parameters.
   * This factory method instantiates the appropriate connector class
   * based on the ErpType stored in the ErpConnection record.
   */
  async createConnector(connectionId: string): Promise<BaseErpConnector> {
    const connection = await prisma.erpConnection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new ErpConnectionError("unknown", `Connection ${connectionId} not found`);
    }

    const params: ErpConnectorParams = {
      erpType: connection.erpType,
      connectionId: connection.id,
      tenantId: connection.tenantId,
      connectionString: connection.connectionString,
      authConfig: connection.authConfig as Record<string, unknown>,
      fieldMappings: (connection.fieldMappings as unknown as FieldMappingConfig) ?? this.getDefaultFieldMappings(),
      syncState: (connection.syncState as Record<string, unknown>) ?? {},
    };

    // Dynamic import to avoid circular dependencies
    const { createConnectorByType } = await import("./index");
    return createConnectorByType(params);
  }

  /**
   * Get default field mappings for when no custom mappings are configured.
   */
  private getDefaultFieldMappings(): FieldMappingConfig {
    return {
      ingredient: [],
      formulation: [],
      product: [],
      customer: [],
      supplier: [],
    };
  }
}
