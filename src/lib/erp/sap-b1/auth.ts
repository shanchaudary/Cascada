// Cascada — SAP Business One Authentication
// Session-based authentication for SAP B1 Service Layer.

import type { SapB1AuthConfig, SapB1LoginResponse, SapB1ErrorResponse } from "./types";
import { ErpAuthError } from "../../errors";
import { createErpSyncLogger } from "../../logger";

const SAP_B1_AUTH_LOGGER = createErpSyncLogger("SAP_B1", "auth", "auth");

/**
 * Authenticate with SAP B1 Service Layer and get a session ID.
 * SAP B1 uses session-based authentication — POST to /Login with credentials
 * to get a SessionId that must be sent in all subsequent requests.
 */
export async function loginToSapB1(config: SapB1AuthConfig): Promise<string> {
  const loginUrl = `${config.baseUrl}/Login`;

  try {
    const response = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        CompanyDB: config.companyDb,
        UserName: config.username,
        Password: config.password,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json() as SapB1ErrorResponse;
      const errorMsg = errorBody.error?.message?.value ?? `HTTP ${response.status}`;
      throw new ErpAuthError("SAP_B1", `Login failed: ${errorMsg}`);
    }

    const loginResponse = await response.json() as SapB1LoginResponse;
    const sessionId = loginResponse.SessionId;

    if (!sessionId) {
      throw new ErpAuthError("SAP_B1", "Login succeeded but no session ID returned");
    }

    SAP_B1_AUTH_LOGGER.info(
      { companyDb: config.companyDb, sessionTimeout: loginResponse.SessionTimeout },
      "SAP B1 login successful"
    );

    return sessionId;
  } catch (error) {
    if (error instanceof ErpAuthError) throw error;
    throw new ErpAuthError(
      "SAP_B1",
      `Login request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Logout from SAP B1 Service Layer (invalidate session).
 */
export async function logoutFromSapB1(
  baseUrl: string,
  sessionId: string
): Promise<void> {
  try {
    await fetch(`${baseUrl}/Logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `B1SESSION=${sessionId}`,
      },
    });
    SAP_B1_AUTH_LOGGER.info("SAP B1 logout successful");
  } catch (error) {
    SAP_B1_AUTH_LOGGER.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "SAP B1 logout failed (non-critical)"
    );
  }
}

/**
 * Validate that the SAP B1 auth config has all required fields.
 */
export function validateSapB1AuthConfig(
  config: Partial<SapB1AuthConfig>
): config is SapB1AuthConfig {
  const requiredFields: Array<keyof SapB1AuthConfig> = [
    "server",
    "companyDb",
    "username",
    "password",
    "baseUrl",
  ];

  const missing = requiredFields.filter((field) => !config[field]);
  if (missing.length > 0) {
    throw new ErpAuthError(
      "SAP_B1",
      `Missing required auth fields: ${missing.join(", ")}`
    );
  }

  return true;
}

/**
 * Build the base URL for SAP B1 Service Layer API.
 * Format: https://{server}:50000/b1s/v1
 */
export function buildSapB1BaseUrl(server: string): string {
  // Remove trailing slash and protocol if present
  const cleanServer = server.replace(/\/+$/, "").replace(/^https?:\/\//, "");
  return `https://${cleanServer}:50000/b1s/v1`;
}

/**
 * Parse an SAP B1 error response into a readable message.
 */
export function parseSapB1Error(response: {
  status?: number;
  body?: unknown;
}): string {
  if (typeof response.body === "object" && response.body !== null) {
    const body = response.body as { error?: { message?: { value?: string }; code?: number } };
    if (body.error?.message?.value) {
      return `SAP B1 error ${body.error.code ?? response.status}: ${body.error.message.value}`;
    }
  }
  return `SAP B1 HTTP ${response.status ?? 0}: ${JSON.stringify(response.body)}`;
}
