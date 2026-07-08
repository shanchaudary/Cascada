"use client";

import { useState, useCallback, useEffect } from "react";
import type { UserRole, Plan } from "@prisma/client";
import { PageHeader, DataTable, Badge, EmptyState, useToast } from "@/components/dashboard";
import type { ColumnDef } from "@/components/dashboard";
import { useAuthStore } from "@/stores/auth-store";
import { useUIStore } from "@/stores/ui-store";
import { apiClient } from "@/lib/api-client";
import { normalizeArray } from "@/lib/dashboard-normalizers";
import type { AuthUser } from "@/types/api";
import { formatPlan } from "@/utils/formatting";

// ============================================================================
// Settings Page — Profile / Team / Plan tabs
// ============================================================================

type TabId = "profile" | "team" | "plan" | "dataSources";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "team", label: "Team" },
  { id: "plan", label: "Plan" },
  { id: "dataSources", label: "Data Sources" },
];

const PLAN_INFO: Array<{ plan: Plan; label: string; price: string; features: string[] }> = [
  {
    plan: "DIAGNOSTIC",
    label: "Diagnostic",
    price: "One-time $2,500",
    features: ["Regulatory exposure snapshot", "50-state coverage", "Top risk identification"],
  },
  {
    plan: "SCOUT",
    label: "Scout",
    price: "$36K/yr",
    features: ["Continuous monitoring", "Real-time alerts", "Exposure mapping", "Trigger tracking"],
  },
  {
    plan: "PRO",
    label: "Pro",
    price: "$84K/yr",
    features: [
      "Everything in Scout",
      "Cascade analysis",
      "Decision packages",
      "Query Agent",
      "ERP integration",
    ],
  },
  {
    plan: "COMMAND",
    label: "Command",
    price: "$156K/yr",
    features: [
      "Everything in Pro",
      "Workflow orchestration",
      "Reformulation Agent",
      "Workflow Generator",
      "Priority support",
    ],
  },
];

// Team member row shape
interface TeamMemberRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
}

interface DataSourceRow {
  type: string;
  label: string;
  envVar: string;
  required: boolean;
  configured: boolean;
  credentialStatus: string;
  maskedValue: string;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
}

interface DataSourceTestResponse {
  type: string;
  healthy: boolean;
  checkedAt: string;
  message: string;
}

function roleBadgeVariant(
  role: UserRole,
): "critical" | "high" | "medium" | "low" | "info" | "success" | "warning" | "default" {
  switch (role) {
    case "SUPER_ADMIN":
      return "critical";
    case "TENANT_ADMIN":
      return "high";
    case "COMPLIANCE":
      return "info";
    case "EXECUTIVE":
      return "medium";
    case "VIEWER":
      return "default";
    default:
      return "default";
  }
}

function formatSyncDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

const teamColumns: ColumnDef<TeamMemberRow>[] = [
  {
    key: "name",
    header: "Name",
    accessor: (row: TeamMemberRow) => row.name,
    cell: (row: TeamMemberRow) => (
      <span className="font-medium text-slate-900 dark:text-white">{row.name}</span>
    ),
  },
  {
    key: "email",
    header: "Email",
    accessor: (row: TeamMemberRow) => row.email,
  },
  {
    key: "role",
    header: "Role",
    accessor: (row: TeamMemberRow) => row.role,
    cell: (row: TeamMemberRow) => (
      <Badge variant={roleBadgeVariant(row.role)}>
        {row.role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
      </Badge>
    ),
    width: "140px",
  },
  {
    key: "isActive",
    header: "Status",
    accessor: (row: TeamMemberRow) => row.isActive,
    cell: (row: TeamMemberRow) => (
      <Badge variant={row.isActive ? "success" : "default"}>
        {row.isActive ? "Active" : "Inactive"}
      </Badge>
    ),
    width: "100px",
  },
];

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const addToast = useUIStore((s) => s.addToast);
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<TabId>("profile");
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMemberRow[]>([]);
  const [dataSources, setDataSources] = useState<DataSourceRow[]>([]);
  const [isLoadingDataSources, setIsLoadingDataSources] = useState(false);
  const [testingSource, setTestingSource] = useState<string | null>(null);

  const isAdmin = user?.role === "TENANT_ADMIN" || user?.role === "SUPER_ADMIN";

  // Load team members
  const loadTeamMembers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const result = await apiClient.get<unknown>("/api/tenants/current/users");
      setTeamMembers(normalizeArray<TeamMemberRow>(result, ["users", "items", "data"]));
    } catch {
      addToast({
        variant: "error",
        title: "Failed to load team",
        message: "Could not fetch team members.",
        durationMs: 8000,
      });
    }
  }, [isAdmin, addToast]);

  const loadDataSources = useCallback(async () => {
    if (!isAdmin) return;
    setIsLoadingDataSources(true);
    try {
      const result = await apiClient.get<unknown>("/api/settings/data-sources");
      setDataSources(normalizeArray<DataSourceRow>(result, ["dataSources", "items", "data"]));
    } catch {
      addToast({
        variant: "error",
        title: "Failed to load data sources",
        message: "Could not fetch regulatory data-source status.",
        durationMs: 8000,
      });
    } finally {
      setIsLoadingDataSources(false);
    }
  }, [isAdmin, addToast]);

  // Load team on mount if admin
  useEffect(() => {
    if (isAdmin) void loadTeamMembers();
  }, [isAdmin, loadTeamMembers]);

  useEffect(() => {
    if (activeTab === "dataSources") void loadDataSources();
  }, [activeTab, loadDataSources]);

  const handleSaveProfile = useCallback(async () => {
    setIsSaving(true);
    try {
      await apiClient.patch<AuthUser, { name: string; email: string }>("/api/tenants/current", {
        name: name.trim(),
        email: email.trim(),
      });
      updateProfile({ name: name.trim(), email: email.trim() });
      toast.success("Profile updated", "Your profile has been saved.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update profile";
      toast.error("Update failed", message);
    } finally {
      setIsSaving(false);
    }
  }, [name, email, updateProfile, toast]);

  const handleTestDataSource = useCallback(
    async (source: DataSourceRow) => {
      setTestingSource(source.type);
      try {
        const result = await apiClient.post<DataSourceTestResponse, { type: string }>(
          "/api/settings/data-sources",
          { type: source.type },
        );

        if (result.healthy) {
          toast.success(`${source.label} connected`, result.message);
        } else {
          toast.warning(`${source.label} unavailable`, result.message);
        }

        await loadDataSources();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Connection test failed";
        toast.error(`${source.label} test failed`, message);
      } finally {
        setTestingSource(null);
      }
    },
    [loadDataSources, toast],
  );

  const currentPlan = (user?.tenantPlan ?? "DIAGNOSTIC") as Plan;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Manage your profile, team, and subscription" />

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Profile tab */}
      {activeTab === "profile" && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
            Profile Information
          </h2>
          <div className="max-w-md space-y-4">
            <div>
              <label
                htmlFor="settings-name"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Full Name
              </label>
              <input
                id="settings-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:focus:border-blue-500"
              />
            </div>
            <div>
              <label
                htmlFor="settings-email"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Email
              </label>
              <input
                id="settings-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:focus:border-blue-500"
              />
            </div>
            <button
              type="button"
              onClick={handleSaveProfile}
              disabled={isSaving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      )}

      {/* Team tab */}
      {activeTab === "team" && (
        <div>
          {!isAdmin ? (
            <EmptyState
              title="Admin access required"
              description="Only tenant administrators can manage team members."
            />
          ) : teamMembers.length === 0 ? (
            <EmptyState
              title="No team members"
              description="Team members will appear here once they are invited."
            />
          ) : (
            <DataTable<TeamMemberRow>
              columns={teamColumns}
              data={teamMembers}
              rowKey={(row: TeamMemberRow) => row.id}
              pageSize={10}
              emptyMessage="No team members"
            />
          )}
        </div>
      )}

      {/* Plan tab */}
      {activeTab === "plan" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              Current plan: <strong>{formatPlan(currentPlan)}</strong>
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLAN_INFO.map((planInfo) => {
              const isCurrent = planInfo.plan === currentPlan;
              return (
                <div
                  key={planInfo.plan}
                  className={`rounded-lg border p-5 ${
                    isCurrent
                      ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200 dark:border-blue-400 dark:bg-blue-900/20 dark:ring-blue-800"
                      : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      {planInfo.label}
                    </h3>
                    {isCurrent && <Badge variant="info">Current</Badge>}
                  </div>
                  <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                    {planInfo.price}
                  </p>
                  <ul className="mt-3 space-y-1.5">
                    {planInfo.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m4.5 12.75 6 6 9-13.5"
                          />
                        </svg>
                        {feature}
                      </li>
                    ))}
                  </ul>
                  {!isCurrent && (
                    <button
                      type="button"
                      className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Contact Sales
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Data Sources tab */}
      {activeTab === "dataSources" && (
        <div>
          {!isAdmin ? (
            <EmptyState
              title="Admin access required"
              description="Only tenant administrators can view platform data-source status."
            />
          ) : isLoadingDataSources ? (
            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-4 h-5 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-16 animate-pulse rounded bg-slate-100 dark:bg-slate-800"
                  />
                ))}
              </div>
            </div>
          ) : dataSources.length === 0 ? (
            <EmptyState
              title="No data sources"
              description="Regulatory data-source status will appear after the platform configuration is available."
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <div className="grid gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-medium uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400 md:grid-cols-[1fr_140px_180px_140px]">
                <span>Source</span>
                <span>Status</span>
                <span>Last successful sync</span>
                <span className="md:text-right">Connection</span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {dataSources.map((source) => (
                  <div
                    key={source.type}
                    className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_140px_180px_140px] md:items-center"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-900 dark:text-white">{source.label}</p>
                        {source.required && <Badge variant="info">Required</Badge>}
                      </div>
                      <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
                        {source.envVar || "Public API"}
                      </p>
                    </div>
                    <div>
                      <Badge
                        variant={
                          source.configured ? "success" : source.required ? "warning" : "default"
                        }
                      >
                        {source.credentialStatus || source.maskedValue}
                      </Badge>
                      {source.lastError && (
                        <p className="mt-1 line-clamp-2 text-xs text-red-600 dark:text-red-400">
                          {source.lastError}
                        </p>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      {formatSyncDate(source.lastSuccessfulSyncAt)}
                    </p>
                    <div className="md:text-right">
                      <button
                        type="button"
                        onClick={() => void handleTestDataSource(source)}
                        disabled={testingSource === source.type}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        {testingSource === source.type ? "Testing..." : "Test"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
