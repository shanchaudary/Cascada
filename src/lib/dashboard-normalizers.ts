import type { Severity, TriggerStatus } from "@prisma/client";
import type {
  CascadeTriggerSummary,
  DashboardSummary,
  ExposureByState,
  PaginatedResponse,
  ProductWithExposure,
  UpcomingDeadline,
} from "@/types/api";

export interface DashboardCostChartDataPoint {
  name: string;
  reformulation: number;
  labelChange: number;
  withdrawal: number;
  penalty: number;
}

export interface DashboardSeverityCount {
  severity: Severity;
  count: number;
}

type CostBucket = "reformulation" | "labelChange" | "withdrawal" | "penalty";

const SEVERITIES: readonly Severity[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFO",
];

const TRIGGER_STATUSES: readonly TriggerStatus[] = [
  "DETECTED",
  "ANALYZING",
  "IMPACT_ASSESSED",
  "DECISION_PACKAGE_READY",
  "DECISION_MADE",
  "WORKFLOW_STARTED",
  "COMPLETED",
  "DISMISSED",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapData(value: unknown): unknown {
  const record = asRecord(value);
  return record && "data" in record ? record["data"] : value;
}

function arrayFromEnvelope(value: unknown, keys: readonly string[]): unknown[] {
  const data = unwrapData(value);

  if (Array.isArray(data)) {
    return data;
  }

  const record = asRecord(data);
  if (!record) {
    return [];
  }

  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

export function normalizeArray<T>(
  value: unknown,
  keys: readonly string[] = ["items", "data"],
): T[] {
  return arrayFromEnvelope(value, keys) as T[];
}

function paginationRecord(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return asRecord(record?.["pagination"]) ?? asRecord(record?.["meta"]);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function dateStringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return null;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && SEVERITIES.includes(value as Severity);
}

function isTriggerStatus(value: unknown): value is TriggerStatus {
  return typeof value === "string" && TRIGGER_STATUSES.includes(value as TriggerStatus);
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function normalizePaginatedResponse<T>(
  value: unknown,
  keys: readonly string[] = ["items", "data"],
): PaginatedResponse<T> {
  const record = asRecord(value);
  const pagination = paginationRecord(value);
  const items = normalizeArray<T>(value, keys);
  const total = numberValue(
    record?.["total"],
    numberValue(
      record?.["totalItems"],
      numberValue(
        record?.["totalProducts"],
        numberValue(
          record?.["totalUsers"],
          numberValue(
            pagination?.["total"],
            numberValue(
              pagination?.["totalItems"],
              numberValue(
                pagination?.["totalProducts"],
                numberValue(pagination?.["totalUsers"], items.length),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  const page = numberValue(record?.["page"], numberValue(pagination?.["page"], 1));
  const limit = numberValue(
    record?.["limit"],
    numberValue(pagination?.["limit"], items.length || 1),
  );

  return {
    items,
    total,
    page,
    limit,
    totalPages: numberValue(
      record?.["totalPages"],
      numberValue(
        pagination?.["totalPages"],
        Math.max(1, Math.ceil(total / Math.max(limit, 1))),
      ),
    ),
  };
}

function toTriggerSummary(value: unknown): CascadeTriggerSummary | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = stringValue(record["id"]) ?? stringValue(record["triggerId"]);
  if (!id) {
    return null;
  }

  return {
    id,
    title: stringValue(record["title"]) ?? "Untitled trigger",
    severity: isSeverity(record["severity"]) ? record["severity"] : "INFO",
    status: isTriggerStatus(record["status"]) ? record["status"] : "DETECTED",
    triggerType: stringValue(record["triggerType"]) ?? "REGULATORY_CHANGE",
    totalSkusAffected: numberValue(record["totalSkusAffected"]),
    estimatedCostMin: nullableNumberValue(record["estimatedCostMin"]),
    estimatedCostMax: nullableNumberValue(record["estimatedCostMax"]),
    deadlineDate: dateStringValue(record["deadlineDate"]),
    createdAt: dateStringValue(record["createdAt"]) ?? new Date(0).toISOString(),
  };
}

export function normalizeCascadeTriggers(value: unknown): CascadeTriggerSummary[] {
  return arrayFromEnvelope(value, ["triggers", "items"])
    .map(toTriggerSummary)
    .filter((trigger): trigger is CascadeTriggerSummary => trigger !== null);
}

function toExposureByState(value: unknown): ExposureByState | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const jurisdiction = stringValue(record["jurisdiction"]) ?? stringValue(record["state"]);
  if (!jurisdiction) {
    return null;
  }

  const topRegulations = normalizeArray<unknown>(record["topRegulations"])
    .map((item, index) => {
      const regulation = asRecord(item);
      const severityValue = regulation?.["severity"];
      const severity = isSeverity(severityValue) ? severityValue : "INFO";
      return {
        id: stringValue(regulation?.["id"]) ?? `${jurisdiction}-regulation-${index}`,
        name: stringValue(regulation?.["name"]) ?? stringValue(regulation?.["title"]) ?? "Regulation",
        severity,
      };
    });

  const breakdownRegulations = normalizeArray<unknown>(record["triggerBreakdown"])
    .map((item) => {
      const bucket = asRecord(item);
      const severityValue = bucket?.["severity"];
      const severity = isSeverity(severityValue) ? severityValue : null;
      const count = numberValue(bucket?.["count"]);
      if (!severity || count <= 0) {
        return null;
      }

      return {
        id: `${jurisdiction}-${severity.toLowerCase()}-triggers`,
        name: `${count} ${severity.toLowerCase()} trigger${count === 1 ? "" : "s"}`,
        severity,
      };
    })
    .filter((item): item is ExposureByState["topRegulations"][number] => item !== null);

  return {
    state: stringValue(record["state"]) ?? jurisdiction,
    jurisdiction,
    skuCount: numberValue(record["skuCount"], numberValue(record["skusAffected"])),
    revenueAtRisk: numberValue(record["revenueAtRisk"], numberValue(record["financialExposure"])),
    regulationCount: numberValue(record["regulationCount"], numberValue(record["activeRuleCount"])),
    topRegulations: topRegulations.length > 0 ? topRegulations : breakdownRegulations,
  };
}

export function normalizeExposureByState(value: unknown): ExposureByState[] {
  return arrayFromEnvelope(value, ["exposures", "items"])
    .map(toExposureByState)
    .filter((item): item is ExposureByState => item !== null);
}

function toProductWithExposure(value: unknown): ProductWithExposure | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = stringValue(record["id"]) ?? stringValue(record["productId"]);
  const name = stringValue(record["name"]) ?? stringValue(record["productName"]);
  const sku = stringValue(record["sku"]);

  if (!id || !name || !sku) {
    return null;
  }

  return {
    id,
    name,
    sku,
    category: stringValue(record["category"]),
    brand: stringValue(record["brand"]),
    markets: stringArrayValue(record["markets"]),
    retailers: stringArrayValue(record["retailers"]),
    annualRevenue: nullableNumberValue(record["annualRevenue"]),
    annualVolume: nullableNumberValue(record["annualVolume"]),
    activeTriggers: numberValue(record["activeTriggers"], numberValue(record["activeTriggerCount"])),
    pendingRegulations: numberValue(
      record["pendingRegulations"],
      numberValue(record["matchedRuleSubstances"]),
    ),
    riskScore: nullableNumberValue(record["riskScore"]),
    reformulationCost: nullableNumberValue(record["reformulationCost"]),
  };
}

export function normalizeProductExposureResponse(
  value: unknown,
): PaginatedResponse<ProductWithExposure> {
  const normalized = normalizePaginatedResponse<unknown>(value, ["items", "products", "data"]);

  return {
    ...normalized,
    items: normalized.items
      .map(toProductWithExposure)
      .filter((item): item is ProductWithExposure => item !== null),
  };
}

export function buildSeverityDistribution(value: unknown): DashboardSeverityCount[] {
  const counts: Partial<Record<Severity, number>> = {};

  for (const trigger of normalizeCascadeTriggers(value)) {
    counts[trigger.severity] = (counts[trigger.severity] ?? 0) + 1;
  }

  return SEVERITIES
    .map((severity) => ({ severity, count: counts[severity] ?? 0 }))
    .filter((entry) => entry.count > 0);
}

function countForSeverity(value: unknown, severity: Severity): number {
  const entry = arrayFromEnvelope(value, ["triggersBySeverity", "items"]).find((item) => {
    const record = asRecord(item);
    return record?.["severity"] === severity;
  });

  return numberValue(asRecord(entry)?.["count"]);
}

function sumCountFields(value: unknown): number {
  return arrayFromEnvelope(value, ["items"]).reduce<number>((sum, item) => {
    return sum + numberValue(asRecord(item)?.["count"]);
  }, 0);
}

export function normalizeDashboardSummary(value: unknown): DashboardSummary {
  const data = unwrapData(value);
  const record = asRecord(data);
  const estimatedCostRange = asRecord(record?.["estimatedCostRange"]);

  return {
    activeTriggers: numberValue(
      record?.["activeTriggers"],
      numberValue(record?.["totalActiveTriggers"]),
    ),
    criticalTriggers: numberValue(
      record?.["criticalTriggers"],
      countForSeverity(record?.["triggersBySeverity"], "CRITICAL"),
    ),
    skusAtRisk: numberValue(record?.["skusAtRisk"], numberValue(record?.["totalSkusAffected"])),
    revenueAtRisk: numberValue(
      record?.["revenueAtRisk"],
      numberValue(estimatedCostRange?.["max"]),
    ),
    upcomingDeadlines: numberValue(
      record?.["upcomingDeadlines"],
      sumCountFields(record?.["complianceDeadlines"]),
    ),
    recentRegulations: numberValue(
      record?.["recentRegulations"],
      numberValue(record?.["recentActivityCount"]),
    ),
    pendingDecisions: numberValue(
      record?.["pendingDecisions"],
      numberValue(record?.["pendingDecisionPackages"]),
    ),
    activeWorkflows: numberValue(record?.["activeWorkflows"]),
  };
}

function toUpcomingDeadline(value: unknown): UpcomingDeadline | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = stringValue(record["id"]) ?? stringValue(record["ruleId"]);
  const deadline = dateStringValue(record["deadline"]) ?? dateStringValue(record["complianceDate"]);

  if (!id || !deadline) {
    return null;
  }

  return {
    id,
    title: stringValue(record["title"]) ?? stringValue(record["ruleDescription"]) ?? "Compliance deadline",
    deadline,
    severity: isSeverity(record["severity"]) ? record["severity"] : "INFO",
    skusAffected: numberValue(record["skusAffected"], numberValue(record["affectedSkusCount"])),
    daysRemaining: numberValue(record["daysRemaining"]),
  };
}

export function normalizeUpcomingDeadlines(value: unknown): UpcomingDeadline[] {
  return arrayFromEnvelope(value, ["deadlines", "items"])
    .map(toUpcomingDeadline)
    .filter((deadline): deadline is UpcomingDeadline => deadline !== null);
}

function costBucketForCategory(category: string): CostBucket | null {
  const normalized = category.toLowerCase();

  if (normalized.includes("reformulation")) return "reformulation";
  if (normalized.includes("label")) return "labelChange";
  if (normalized.includes("withdrawal")) return "withdrawal";
  if (normalized.includes("penalt")) return "penalty";

  return null;
}

export function buildCostChartData(value: unknown): DashboardCostChartDataPoint[] {
  const data = unwrapData(value);
  const record = asRecord(data);

  if (!record) {
    return [];
  }

  const legacyReformulationCosts = arrayFromEnvelope(record["reformulationCosts"], ["items"]);
  if (legacyReformulationCosts.length > 0) {
    return legacyReformulationCosts.slice(0, 8).map((item) => {
      const costRecord = asRecord(item);
      const bestOption = asRecord(costRecord?.["bestOption"]);

      return {
        name: stringValue(costRecord?.["ingredientName"]) ?? "Ingredient",
        reformulation: numberValue(bestOption?.["totalCost"]),
        labelChange: 0,
        withdrawal: 0,
        penalty: 0,
      };
    });
  }

  const topTriggers = arrayFromEnvelope(record["topExpensiveTriggers"], ["items"]);
  if (topTriggers.length > 0) {
    return topTriggers.slice(0, 8).map((item) => {
      const trigger = asRecord(item);

      return {
        name: stringValue(trigger?.["title"]) ?? "Trigger",
        reformulation: numberValue(trigger?.["estimatedCostMax"]),
        labelChange: 0,
        withdrawal: 0,
        penalty: 0,
      };
    });
  }

  return arrayFromEnvelope(record["reformVsLabelVsWithdrawal"], ["items"])
    .map((item) => {
      const cost = asRecord(item);
      const category = stringValue(cost?.["category"]) ?? "Cost";
      const bucket = costBucketForCategory(category);
      const point: DashboardCostChartDataPoint = {
        name: category,
        reformulation: 0,
        labelChange: 0,
        withdrawal: 0,
        penalty: 0,
      };

      if (bucket) {
        point[bucket] = numberValue(cost?.["totalCost"]);
      }

      return point;
    })
    .filter((point) => (
      point.reformulation + point.labelChange + point.withdrawal + point.penalty
    ) > 0);
}
