// Cascada — Dynamics 365 Business Central Authentication
// OAuth2 client credentials flow for D365 BC API.

import type { D365AuthConfig, D365TokenResponse } from "./types";
import { ErpAuthError } from "../../errors";
import { createErpSyncLogger } from "../../logger";

const D365_AUTH_LOGGER = createErpSyncLogger("DYNAMICS_365_BC", "auth", "auth");

/**
 * Acquire an OAuth2 access token using client credentials flow.
 * D365 BC uses Microsoft Entra ID (Azure AD) for authentication.
 */
export async function acquireD365Token(config: D365AuthConfig): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: `${config.baseUrl}/.default`,
    grant_type: "client_credentials",
  });

  try {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ErpAuthError("DYNAMICS_365_BC", `Token acquisition failed: ${errorText}`);
    }

    const tokenResponse = await response.json() as D365TokenResponse;
    D365_AUTH_LOGGER.info(
      { expiresIn: tokenResponse.expires_in, tokenType: tokenResponse.token_type },
      "D365 BC token acquired"
    );

    return tokenResponse.access_token;
  } catch (error) {
    if (error instanceof ErpAuthError) throw error;
    throw new ErpAuthError(
      "DYNAMICS_365_BC",
      `Token request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Validate D365 BC auth config.
 */
export function validateD365AuthConfig(config: Partial<D365AuthConfig>): config is D365AuthConfig {
  const requiredFields: Array<keyof D365AuthConfig> = [
    "tenantId", "clientId", "clientSecret", "environment", "companyId", "baseUrl",
  ];
  const missing = requiredFields.filter((field) => !config[field]);
  if (missing.length > 0) {
    throw new ErpAuthError("DYNAMICS_365_BC", `Missing required auth fields: ${missing.join(", ")}`);
  }
  return true;
}

/**
 * Build D365 BC API base URL.
 * Format: https://api.businesscentral.dynamics.com/v2.0/{environment}/api/v2.0/companies({companyId})
 */
export function buildD365BaseUrl(environment: string, companyId: string): string {
  return `https://api.businesscentral.dynamics.com/v2.0/${environment}/api/v2.0/companies(${companyId})`;
}
