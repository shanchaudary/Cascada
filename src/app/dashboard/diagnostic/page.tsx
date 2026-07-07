"use client";

import { useState, useCallback } from "react";
import type { Severity } from "@prisma/client";
import {
  PageHeader,
  Badge,
  EmptyState,
  StatCard,
  useToast,
} from "@/components/dashboard";
import { apiClient } from "@/lib/api-client";
import type { DiagnosticResultData } from "@/types/api";
import { formatCurrency } from "@/utils/formatting";
import { formatDashboardDate } from "@/utils/dates";

// ============================================================================
// Diagnostic Page — paid diagnostic wedge product
// ============================================================================

const PRODUCT_CATEGORIES = [
  "Beverages",
  "Snacks",
  "Confectionery",
  "Dairy",
  "Bakery",
  "Sauces & Condiments",
  "Frozen Foods",
  "Meat & Poultry",
  "Seafood",
  "Supplements",
];

const MARKET_OPTIONS = [
  "US-Federal",
  "US-CA",
  "US-NY",
  "US-TX",
  "US-WA",
  "US-IL",
  "US-FL",
  "EU",
  "UK",
  "Canada",
];

interface DiagnosticFormState {
  companyName: string;
  contactName: string;
  contactEmail: string;
  productCategories: string[];
  markets: string[];
}

const INITIAL_FORM: DiagnosticFormState = {
  companyName: "",
  contactName: "",
  contactEmail: "",
  productCategories: [],
  markets: [],
};

function severityToBadgeVariant(severity: Severity): "critical" | "high" | "medium" | "low" | "info" {
  return severity.toLowerCase() as "critical" | "high" | "medium" | "low" | "info";
}

export default function DiagnosticPage() {
  const toast = useToast();

  const [form, setForm] = useState<DiagnosticFormState>(INITIAL_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);
  const [result, setResult] = useState<DiagnosticResultData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateField = useCallback(
    (field: keyof DiagnosticFormState, value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      if (error) setError(null);
    },
    [error]
  );

  const toggleArrayItem = useCallback(
    (field: "productCategories" | "markets", item: string) => {
      setForm((prev) => ({
        ...prev,
        [field]: prev[field].includes(item)
          ? prev[field].filter((i) => i !== item)
          : [...prev[field], item],
      }));
    },
    []
  );

  const validate = useCallback((): boolean => {
    if (!form.companyName.trim()) {
      setError("Company name is required");
      return false;
    }
    if (!form.contactName.trim()) {
      setError("Contact name is required");
      return false;
    }
    if (!form.contactEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) {
      setError("Valid contact email is required");
      return false;
    }
    if (form.productCategories.length === 0) {
      setError("Select at least one product category");
      return false;
    }
    if (form.markets.length === 0) {
      setError("Select at least one market");
      return false;
    }
    return true;
  }, [form]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!validate()) return;

      setIsPaymentProcessing(true);

      // Stripe checkout placeholder — in production, this would redirect to Stripe
      try {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        setIsPaymentProcessing(false);
        setIsSubmitting(true);

        const diagnosticResult = await apiClient.post<DiagnosticResultData, {
          companyName: string;
          contactName: string;
          contactEmail: string;
          productCategories: string[];
          markets: string[];
        }>("/api/cascade/exposure/diagnostic", {
          companyName: form.companyName.trim(),
          contactName: form.contactName.trim(),
          contactEmail: form.contactEmail.trim(),
          productCategories: form.productCategories,
          markets: form.markets,
        });

        setResult(diagnosticResult);
        toast.success("Diagnostic complete", "Your regulatory exposure analysis is ready.");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Diagnostic failed";
        setError(message);
        toast.error("Diagnostic failed", message);
      } finally {
        setIsSubmitting(false);
        setIsPaymentProcessing(false);
      }
    },
    [form, validate, toast]
  );

  // Results view
  if (result) {
    const topRisks = result.topRegulatoryRisks.slice(0, 5);

    return (
      <div className="space-y-6">
        <PageHeader
          title="Diagnostic Results"
          description={`Analysis for ${result.generatedAt ? formatDashboardDate(result.generatedAt) : "your company"}`}
          actions={
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setForm(INITIAL_FORM);
              }}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              New Diagnostic
            </button>
          }
        />

        {/* Summary stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="SKUs at Risk"
            value={result.totalSkusAtRisk.toLocaleString()}
            severity="CRITICAL"
          />
          <StatCard
            label="Min Compliance Cost"
            value={formatCurrency(result.estimatedComplianceCost.min, { compact: true })}
            severity="HIGH"
          />
          <StatCard
            label="Max Compliance Cost"
            value={formatCurrency(result.estimatedComplianceCost.max, { compact: true })}
            severity="HIGH"
          />
          <StatCard
            label="Jurisdictions Tracked"
            value={Object.keys(result.exposureByState).length}
            severity="MEDIUM"
          />
        </div>

        {/* Top regulatory risks */}
        <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
            Top Regulatory Risks
          </h2>
          {topRisks.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No high-risk regulations identified.</p>
          ) : (
            <div className="space-y-3">
              {topRisks.map((risk, idx) => (
                <div
                  key={`${risk.regulation}-${idx}`}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={severityToBadgeVariant(risk.severity)}>{risk.severity}</Badge>
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                        {risk.regulation}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {risk.jurisdiction} · {risk.affectedCategories.join(", ")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recommendations */}
        <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">Recommendations</h2>
          <ol className="space-y-3">
            {result.recommendations.map((rec, idx) => (
              <li key={idx} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                  {idx + 1}
                </span>
                <p className="text-sm text-slate-700 dark:text-slate-300">{rec}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  // Form view
  return (
    <div className="space-y-6">
      <PageHeader
        title="Regulatory Diagnostic"
        description="Get a snapshot of your regulatory exposure across 50 states"
      />

      <div className="mx-auto max-w-2xl">
        <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
          {/* Pricing banner */}
          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                  One-Time Diagnostic
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  50-state regulatory exposure analysis for your product portfolio
                </p>
              </div>
              <p className="text-lg font-bold text-blue-800 dark:text-blue-300">$2,500</p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Company name */}
            <div>
              <label htmlFor="diag-company" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Company Name
              </label>
              <input
                id="diag-company"
                type="text"
                value={form.companyName}
                onChange={(e) => updateField("companyName", e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:focus:border-blue-500"
                placeholder="Acme Foods Inc."
              />
            </div>

            {/* Contact name */}
            <div>
              <label htmlFor="diag-contact" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Contact Name
              </label>
              <input
                id="diag-contact"
                type="text"
                value={form.contactName}
                onChange={(e) => updateField("contactName", e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:focus:border-blue-500"
                placeholder="Jane Doe"
              />
            </div>

            {/* Contact email */}
            <div>
              <label htmlFor="diag-email" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Contact Email
              </label>
              <input
                id="diag-email"
                type="email"
                value={form.contactEmail}
                onChange={(e) => updateField("contactEmail", e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:focus:border-blue-500"
                placeholder="jane@acmefoods.com"
              />
            </div>

            {/* Product categories */}
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Product Categories
              </label>
              <div className="flex flex-wrap gap-2">
                {PRODUCT_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleArrayItem("productCategories", cat)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      form.productCategories.includes(cat)
                        ? "bg-blue-600 text-white"
                        : "border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Markets */}
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Markets
              </label>
              <div className="flex flex-wrap gap-2">
                {MARKET_OPTIONS.map((market) => (
                  <button
                    key={market}
                    type="button"
                    onClick={() => toggleArrayItem("markets", market)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      form.markets.includes(market)
                        ? "bg-blue-600 text-white"
                        : "border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                    }`}
                  >
                    {market}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting || isPaymentProcessing}
              className="flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPaymentProcessing ? (
                "Processing payment…"
              ) : isSubmitting ? (
                <>
                  <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Running diagnostic…
                </>
              ) : (
                "Run Diagnostic — $2,500"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
