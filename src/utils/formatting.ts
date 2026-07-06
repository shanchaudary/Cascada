// Cascada — Formatting Utilities

/**
 * Format a number as USD currency.
 */
export function formatCurrency(
  amount: number | null | undefined,
  options?: { compact?: boolean }
): string {
  if (amount == null) return "—";

  if (options?.compact) {
    if (Math.abs(amount) >= 1_000_000) {
      return `$${(amount / 1_000_000).toFixed(1)}M`;
    }
    if (Math.abs(amount) >= 1_000) {
      return `$${(amount / 1_000).toFixed(1)}K`;
    }
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Format a number as a percentage.
 */
export function formatPercentage(
  value: number | null | undefined,
  decimals: number = 1
): string {
  if (value == null) return "—";
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format a risk score (0-1) as a human-readable label.
 */
export function formatRiskScore(score: number | null | undefined): string {
  if (score == null) return "Unknown";
  if (score >= 0.8) return "Critical";
  if (score >= 0.6) return "High";
  if (score >= 0.4) return "Medium";
  if (score >= 0.2) return "Low";
  return "Minimal";
}

/**
 * Format a severity enum value as a display string.
 */
export function formatSeverity(severity: string): string {
  const labels: Record<string, string> = {
    CRITICAL: "Critical",
    HIGH: "High",
    MEDIUM: "Medium",
    LOW: "Low",
    INFO: "Info",
  };
  return labels[severity] ?? severity;
}

/**
 * Format an ERP type enum as a display string.
 */
export function formatErpType(erpType: string): string {
  const labels: Record<string, string> = {
    NETSUITE: "NetSuite",
    SAP_B1: "SAP Business One",
    DYNAMICS_365_BC: "Dynamics 365 BC",
    INFOR_M3: "Infor M3",
    EPICOR_P21: "Epicor Prophet 21",
  };
  return labels[erpType] ?? erpType;
}

/**
 * Format a plan enum as a display string with price.
 */
export function formatPlan(plan: string): string {
  const labels: Record<string, string> = {
    DIAGNOSTIC: "Diagnostic Only",
    SCOUT: "Scout ($36K/yr)",
    PRO: "Pro ($84K/yr)",
    COMMAND: "Command ($156K/yr)",
  };
  return labels[plan] ?? plan;
}

/**
 * Format a jurisdiction code as a human-readable location.
 */
export function formatJurisdiction(jurisdiction: string): string {
  if (jurisdiction === "US") return "Federal (US)";
  if (jurisdiction.startsWith("US-")) {
    const stateCode = jurisdiction.replace("US-", "");
    const stateNames: Record<string, string> = {
      AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
      CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
      FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
      IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
      KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
      MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
      MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
      NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
      NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
      OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
      SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
      VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
      WI: "Wisconsin", WY: "Wyoming", DC: "Washington DC",
    };
    return stateNames[stateCode] ?? jurisdiction;
  }
  return jurisdiction;
}

/**
 * Truncate a string to a maximum length with ellipsis.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}
