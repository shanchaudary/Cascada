import type { PipelineSourceConfig } from "./types";

export type PipelineCredentialState = "not_required" | "configured" | "requested" | "missing";

export interface PipelineCredentialStatus {
  configured: boolean;
  state: PipelineCredentialState;
  message: string;
}

const REQUESTED_VALUES = new Set(["requested", "request submitted", "pending", "awaiting"]);
const MISSING_VALUES = new Set([
  "",
  "none",
  "n/a",
  "na",
  "todo",
  "tbd",
  "changeme",
  "change-me",
]);

export function getPipelineCredentialStatus(
  config: PipelineSourceConfig,
  env: Record<string, string | undefined> = process.env,
): PipelineCredentialStatus {
  if (!config.apiKeyRequired) {
    return {
      configured: true,
      state: "not_required",
      message: `${config.name} does not require a configured API key`,
    };
  }

  const rawValue = config.apiKeyEnvVar ? env[config.apiKeyEnvVar] : undefined;
  const normalized = rawValue?.trim() ?? "";
  const normalizedLower = normalized.toLowerCase();

  if (REQUESTED_VALUES.has(normalizedLower)) {
    return {
      configured: false,
      state: "requested",
      message: `${config.apiKeyEnvVar} is requested but not configured`,
    };
  }

  if (MISSING_VALUES.has(normalizedLower)) {
    return {
      configured: false,
      state: "missing",
      message: `${config.apiKeyEnvVar} is missing`,
    };
  }

  return {
    configured: true,
    state: "configured",
    message: `${config.apiKeyEnvVar} is configured`,
  };
}
