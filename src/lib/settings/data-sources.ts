import type { PipelineType } from "@/lib/pipelines/types";

export type DataSourceCredentialMode = "secret" | "public";

export interface DataSourceDefinition {
  type: PipelineType;
  label: string;
  envVar: string | null;
  required: boolean;
  credentialMode: DataSourceCredentialMode;
  blankStatus?: "Missing" | "Requested";
}

export interface DataSourceCredentialStatus {
  configured: boolean;
  credentialStatus: string;
  maskedValue: string;
}

export interface DataSourceStatus extends DataSourceDefinition, DataSourceCredentialStatus {
  envVar: string;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
}

type DataSourceEnv = Record<string, string | undefined>;

const REQUESTED_VALUES = new Set(["requested", "request submitted", "pending", "awaiting"]);

const MISSING_VALUES = new Set([
  "",
  "none",
  "n/a",
  "na",
  "not needed",
  "not-needed",
  "not_needed",
  "todo",
  "tbd",
  "changeme",
  "change-me",
]);

export const DATA_SOURCE_DEFINITIONS: readonly DataSourceDefinition[] = [
  {
    type: "legiscan",
    label: "LegiScan",
    envVar: "LEGISCAN_API_KEY",
    required: true,
    credentialMode: "secret",
    blankStatus: "Requested",
  },
  {
    type: "openfda",
    label: "openFDA",
    envVar: "OPENFDA_API_KEY",
    required: false,
    credentialMode: "secret",
  },
  {
    type: "federal_register",
    label: "Federal Register",
    envVar: null,
    required: false,
    credentialMode: "public",
  },
  {
    type: "usda",
    label: "USDA FoodData Central",
    envVar: "USDA_API_KEY",
    required: true,
    credentialMode: "secret",
  },
] as const;

export function getDataSourceDefinition(type: PipelineType): DataSourceDefinition | undefined {
  return DATA_SOURCE_DEFINITIONS.find((source) => source.type === type);
}

export function getCredentialStatus(
  source: DataSourceDefinition,
  env: DataSourceEnv = process.env,
): DataSourceCredentialStatus {
  if (source.credentialMode === "public") {
    return {
      configured: true,
      credentialStatus: "Public API / No key required",
      maskedValue: "No key required",
    };
  }

  const rawValue = source.envVar ? env[source.envVar] : undefined;
  const normalizedValue = rawValue?.trim() ?? "";
  const normalizedLower = normalizedValue.toLowerCase();

  if (
    REQUESTED_VALUES.has(normalizedLower) ||
    (normalizedLower === "" && source.blankStatus === "Requested")
  ) {
    return {
      configured: false,
      credentialStatus: "Requested",
      maskedValue: "Requested",
    };
  }

  if (MISSING_VALUES.has(normalizedLower)) {
    return {
      configured: false,
      credentialStatus: "Missing",
      maskedValue: "Missing",
    };
  }

  return {
    configured: true,
    credentialStatus: "Configured",
    maskedValue: "Configured",
  };
}

export function shouldBlockDataSourceTest(
  source: DataSourceDefinition,
  credentialStatus: DataSourceCredentialStatus,
): boolean {
  return source.credentialMode === "secret" && source.required && !credentialStatus.configured;
}

export function buildDataSourceStatus(
  source: DataSourceDefinition,
  lastSuccessfulSyncAt: string | null,
  lastError: string | null,
  env: DataSourceEnv = process.env,
): DataSourceStatus {
  const credentialStatus = getCredentialStatus(source, env);

  return {
    ...source,
    envVar: source.envVar ?? "",
    ...credentialStatus,
    lastSuccessfulSyncAt,
    lastError,
  };
}
