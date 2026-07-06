// Cascada — Infor CloudSuite M3 Authentication
// OAuth2 client credentials flow for Infor M3 ION API.

import type { InforM3AuthConfig, InforM3TokenResponse } from "./types";
import { ErpAuthError } from "../../errors";
import { createErpSyncLogger } from "../../logger";

const INFOR_AUTH_LOGGER = createErpSyncLogger("INFOR_M3", "auth", "auth");

/**
 * Acquire an OAuth2 access token for Infor M3 ION API.
 * Infor uses their ION API gateway with OAuth2 client credentials.
 */
export async function acquireInforM3Token(config: InforM3AuthConfig): Promise<string> {
  const tokenUrl = `${config.baseUrl}/oauth2/${config.tenantId}/oauth2/token`;

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
    scope: "ionapi.read",
  });

  try {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ErpAuthError("INFOR_M3", `Token acquisition failed: ${errorText}`);
    }

    const tokenResponse = await response.json() as InforM3TokenResponse;
    INFOR_AUTH_LOGGER.info(
      { expiresIn: tokenResponse.expires_in },
      "Infor M3 token acquired"
    );

    return tokenResponse.access_token;
  } catch (error) {
    if (error instanceof ErpAuthError) throw error;
    throw new ErpAuthError(
      "INFOR_M3",
      `Token request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Validate Infor M3 auth config.
 */
export function validateInforM3AuthConfig(config: Partial<InforM3AuthConfig>): config is InforM3AuthConfig {
  const requiredFields: Array<keyof InforM3AuthConfig> = [
    "tenantId", "clientId", "clientSecret", "organization", "baseUrl",
  ];
  const missing = requiredFields.filter((field) => !config[field]);
  if (missing.length > 0) {
    throw new ErpAuthError("INFOR_M3", `Missing required auth fields: ${missing.join(", ")}`);
  }
  return true;
}

/**
 * Build Infor M3 ION API base URL.
 * Format: https://{tenant}-m3.ion.2.infor.com/IONSERVICES/api/M3/{organization}
 */
export function buildInforM3BaseUrl(tenantId: string, organization: string): string {
  return `https://${tenantId}-m3.ion.2.infor.com/IONSERVICES/api/M3/${organization}`;
}
