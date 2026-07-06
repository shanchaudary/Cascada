// Cascada — Epicor Prophet 21 Authentication
// Basic auth with session management for Epicor P21 REST API.

import type { EpicorP21AuthConfig, EpicorP21SessionResponse } from "./types";
import { ErpAuthError } from "../../errors";
import { createErpSyncLogger } from "../../logger";

const EPICOR_AUTH_LOGGER = createErpSyncLogger("EPICOR_P21", "auth", "auth");

/**
 * Create a session with Epicor P21 REST API.
 * Epicor P21 supports both Basic Auth and session tokens.
 * We use session tokens for better performance on repeated calls.
 */
export async function createEpicorP21Session(config: EpicorP21AuthConfig): Promise<string> {
  const sessionUrl = `${config.baseUrl}/api/v1/session`;

  try {
    const credentials = Buffer.from(`${config.username}:${config.password}`).toString("base64");

    const response = await fetch(sessionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify({
        Company: config.company,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ErpAuthError("EPICOR_P21", `Session creation failed: ${errorText}`);
    }

    const sessionResponse = await response.json() as EpicorP21SessionResponse;
    const sessionId = sessionResponse.SessionId;

    if (!sessionId) {
      throw new ErpAuthError("EPICOR_P21", "Session creation succeeded but no session ID returned");
    }

    EPICOR_AUTH_LOGGER.info(
      { company: config.company, userName: sessionResponse.UserName },
      "Epicor P21 session created"
    );

    return sessionId;
  } catch (error) {
    if (error instanceof ErpAuthError) throw error;
    throw new ErpAuthError(
      "EPICOR_P21",
      `Session request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Delete an Epicor P21 session (logout).
 */
export async function deleteEpicorP21Session(
  baseUrl: string,
  sessionId: string
): Promise<void> {
  try {
    await fetch(`${baseUrl}/api/v1/session`, {
      method: "DELETE",
      headers: {
        "X-P21-Session-Id": sessionId,
      },
    });
    EPICOR_AUTH_LOGGER.info("Epicor P21 session deleted");
  } catch (error) {
    EPICOR_AUTH_LOGGER.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "Epicor P21 session deletion failed (non-critical)"
    );
  }
}

/**
 * Validate Epicor P21 auth config.
 */
export function validateEpicorP21AuthConfig(config: Partial<EpicorP21AuthConfig>): config is EpicorP21AuthConfig {
  const requiredFields: Array<keyof EpicorP21AuthConfig> = [
    "server", "company", "username", "password", "baseUrl",
  ];
  const missing = requiredFields.filter((field) => !config[field]);
  if (missing.length > 0) {
    throw new ErpAuthError("EPICOR_P21", `Missing required auth fields: ${missing.join(", ")}`);
  }
  return true;
}

/**
 * Build Epicor P21 REST API base URL.
 * Format: https://{server}/P21WebApi
 */
export function buildEpicorP21BaseUrl(server: string): string {
  const cleanServer = server.replace(/\/+$/, "").replace(/^https?:\/\//, "");
  return `https://${cleanServer}/P21WebApi`;
}
