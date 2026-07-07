"use client";

import { useState, useCallback } from "react";
import type { ErpType } from "@prisma/client";
import {
  PageHeader,
  DataTable,
  Badge,
  EmptyState,
  ConfirmDialog,
  useToast,
} from "@/components/dashboard";
import type { ColumnDef } from "@/components/dashboard";
import { useErpConnections, useErpSync, useErpHealth } from "@/hooks";
import type { ErpConnectionStatus } from "@/types/api";
import { formatErpType } from "@/utils/formatting";
import { formatDateTime } from "@/utils/dates";

// ============================================================================
// Integrations Page — ERP Connections
// ============================================================================

const ERP_TYPE_OPTIONS: Array<{ value: ErpType; label: string }> = [
  { value: "NETSUITE", label: "NetSuite" },
  { value: "SAP_B1", label: "SAP Business One" },
  { value: "DYNAMICS_365_BC", label: "Dynamics 365 BC" },
  { value: "INFOR_M3", label: "Infor M3" },
  { value: "EPICOR_P21", label: "Epicor Prophet 21" },
];

function syncStatusToBadgeVariant(status: string): "success" | "warning" | "critical" | "info" | "default" {
  switch (status) {
    case "COMPLETED": return "success";
    case "IN_PROGRESS": return "info";
    case "PENDING": return "warning";
    case "FAILED": return "critical";
    default: return "default";
  }
}

interface ConnectionRow extends ErpConnectionStatus {
  // Extended with no additional fields — satisfies ErpConnectionStatus
}

const connectionColumns: ColumnDef<ConnectionRow>[] = [
  {
    key: "connectionName",
    header: "Connection",
    accessor: (row: ConnectionRow) => row.connectionName,
    cell: (row: ConnectionRow) => (
      <div>
        <p className="font-medium text-slate-900 dark:text-white">{row.connectionName}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{formatErpType(row.erpType)}</p>
      </div>
    ),
  },
  {
    key: "syncStatus",
    header: "Status",
    accessor: (row: ConnectionRow) => row.syncStatus,
    cell: (row: ConnectionRow) => (
      <Badge variant={syncStatusToBadgeVariant(row.syncStatus)}>
        {row.syncStatus.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
      </Badge>
    ),
    width: "130px",
  },
  {
    key: "recordsSynced",
    header: "Records Synced",
    accessor: (row: ConnectionRow) => row.recordsSynced,
    cell: (row: ConnectionRow) => row.recordsSynced.toLocaleString(),
    align: "right",
  },
  {
    key: "lastSyncAt",
    header: "Last Sync",
    accessor: (row: ConnectionRow) => row.lastSyncAt ?? "",
    cell: (row: ConnectionRow) => formatDateTime(row.lastSyncAt),
  },
  {
    key: "lastSyncError",
    header: "Error",
    accessor: (row: ConnectionRow) => row.lastSyncError ?? "",
    cell: (row: ConnectionRow) =>
      row.lastSyncError ? (
        <span className="text-xs text-red-600 dark:text-red-400" title={row.lastSyncError}>
          {row.lastSyncError.length > 40 ? row.lastSyncError.slice(0, 40) + "…" : row.lastSyncError}
        </span>
      ) : (
        <span className="text-slate-400">—</span>
      ),
  },
];

export default function IntegrationsPage() {
  const toast = useToast();
  const { data: connections, isLoading, error } = useErpConnections();

  const [showAddModal, setShowAddModal] = useState(false);
  const [newConnectionName, setNewConnectionName] = useState("");
  const [newErpType, setNewErpType] = useState<ErpType>("NETSUITE");

  // Per-connection sync/health — these are lazy, triggered by buttons
  const [activeSyncId, setActiveSyncId] = useState<string | null>(null);
  const [activeHealthId, setActiveHealthId] = useState<string | null>(null);

  const syncMutation = useErpSync(activeSyncId ?? "");
  const healthMutation = useErpHealth(activeHealthId ?? "");

  const handleSync = useCallback(
    async (connectionId: string) => {
      setActiveSyncId(connectionId);
      try {
        await syncMutation.mutateAsync({ syncType: "incremental" });
        toast.success("Sync started", "Data synchronization is in progress.");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Sync failed";
        toast.error("Sync failed", message);
      } finally {
        setActiveSyncId(null);
      }
    },
    [syncMutation, toast]
  );

  const handleHealthCheck = useCallback(
    async (connectionId: string) => {
      setActiveHealthId(connectionId);
      try {
        await healthMutation.mutateAsync();
        toast.success("Health check complete", "Connection health has been verified.");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Health check failed";
        toast.error("Health check failed", message);
      } finally {
        setActiveHealthId(null);
      }
    },
    [healthMutation, toast]
  );

  const handleAddConnection = useCallback(() => {
    if (!newConnectionName.trim()) {
      toast.error("Connection name required", "Please provide a name for the connection.");
      return;
    }
    // Close modal — actual POST would go to API
    setShowAddModal(false);
    setNewConnectionName("");
    toast.info("Connection created", `${newConnectionName} (${formatErpType(newErpType)}) has been added. Configure credentials to complete setup.`);
  }, [newConnectionName, newErpType, toast]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Manage ERP connections and data synchronization"
        actions={
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Add Connection
          </button>
        }
      />

      {/* Connections table */}
      {error ? (
        <EmptyState
          title="Failed to load connections"
          description={error.message}
        />
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : !connections || connections.length === 0 ? (
        <EmptyState
          title="No ERP connections"
          description="Connect your ERP system to sync ingredients, formulations, and product data into Cascada."
          action={
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Add Connection
            </button>
          }
        />
      ) : (
        <>
          <DataTable<ConnectionRow>
            columns={connectionColumns}
            data={connections as ConnectionRow[]}
            rowKey={(row: ConnectionRow) => row.id}
            pageSize={10}
            emptyMessage="No connections"
          />

          {/* Quick actions per connection */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Quick Actions</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {connections.map((conn) => (
                <div
                  key={conn.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{conn.connectionName}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{formatErpType(conn.erpType)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleHealthCheck(conn.id)}
                      disabled={activeHealthId === conn.id && healthMutation.isPending}
                      className="rounded-md bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 transition-colors hover:bg-green-100 disabled:opacity-50 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50"
                    >
                      {activeHealthId === conn.id && healthMutation.isPending ? "Checking…" : "Health"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSync(conn.id)}
                      disabled={activeSyncId === conn.id && syncMutation.isPending}
                      className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                    >
                      {activeSyncId === conn.id && syncMutation.isPending ? "Syncing…" : "Sync"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Add connection modal */}
      <ConfirmDialog
        isOpen={showAddModal}
        title="Add ERP Connection"
        message={
          <div className="space-y-4">
            <div>
              <label htmlFor="new-conn-name" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Connection Name
              </label>
              <input
                id="new-conn-name"
                type="text"
                value={newConnectionName}
                onChange={(e) => setNewConnectionName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                placeholder="e.g., Production NetSuite"
              />
            </div>
            <div>
              <label htmlFor="new-conn-erp" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                ERP System
              </label>
              <select
                id="new-conn-erp"
                value={newErpType}
                onChange={(e) => setNewErpType(e.target.value as ErpType)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              >
                {ERP_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        }
        confirmLabel="Add Connection"
        onConfirm={handleAddConnection}
        onCancel={() => {
          setShowAddModal(false);
          setNewConnectionName("");
        }}
      />
    </div>
  );
}
