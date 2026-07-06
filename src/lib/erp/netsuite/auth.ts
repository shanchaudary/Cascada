// Cascada — NetSuite Authentication
// OAuth 1.0a implementation for NetSuite SuiteTalk REST API (Token-Based Authentication).
// NetSuite uses OAuth 1.0a with HMAC-SHA256 signing for all API requests.

import * as crypto from "crypto";
import type { NetSuiteTokenAuthConfig, NetSuiteOAuthParams } from "./types";
import { ErpAuthError } from "../../errors";
import { createErpSyncLogger } from "../../logger";

// ============================================================================
// NetSuite Auth Module
// ============================================================================

const NETSUITE_AUTH_LOGGER = createErpSyncLogger("NETSUITE", "auth", "auth");

/**
 * Generate OAuth 1.0a authorization header for NetSuite API requests.
 *
 * NetSuite requires OAuth 1.0a token-based authentication with the following:
 * - HMAC-SHA256 signature method
 * - Realm set to the NetSuite account ID (uppercase)
 * - All OAuth parameters in the Authorization header (not query string)
 *
 * The signing process follows RFC 5849:
 * 1. Collect and normalize request parameters
 * 2. Create the signature base string (method & URL & parameters)
 * 3. Calculate the HMAC-SHA256 signature using the signing key
 * 4. Construct the Authorization header with all OAuth parameters
 */
export function generateAuthHeader(
  config: NetSuiteTokenAuthConfig,
  method: string,
  url: string,
  body?: string
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");

  const oauthParams: Omit<NetSuiteOAuthParams, "oauth_signature"> = {
    oauth_consumer_key: config.consumerKey,
    oauth_token: config.tokenId,
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: timestamp,
    oauth_nonce: nonce,
    oauth_version: "1.0",
  };

  // Step 1: Collect and normalize parameters
  const allParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(oauthParams)) {
    allParams[key] = value;
  }

  // Parse query parameters from URL and add them
  const urlObj = new URL(url);
  for (const [key, value] of urlObj.searchParams.entries()) {
    allParams[encodeURIComponent(key)] = encodeURIComponent(value);
  }

  // Sort parameters alphabetically
  const sortedParams = Object.keys(allParams)
    .sort()
    .map((key) => `${key}=${allParams[key]}`)
    .join("&");

  // Step 2: Create signature base string
  const baseUrl = `${urlObj.origin}${urlObj.pathname}`;
  const signatureBaseString = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(sortedParams),
  ].join("&");

  // Step 3: Calculate HMAC-SHA256 signature
  const signingKey = `${percentEncode(config.consumerSecret)}&${percentEncode(config.tokenSecret)}`;
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(signatureBaseString)
    .digest("base64");

  // Step 4: Construct Authorization header
  const realm = config.accountId.toUpperCase().replace("_", "-");
  const authParams: NetSuiteOAuthParams = {
    ...oauthParams,
    oauth_signature: signature,
  };

  const authHeaderParts = [
    `OAuth realm="${realm}"`,
    ...Object.entries(authParams).map(
      ([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`
    ),
  ];

  NETSUITE_AUTH_LOGGER.debug(
    { method, url: baseUrl, realm },
    "Generated NetSuite OAuth header"
  );

  return authHeaderParts.join(", ");
}

/**
 * Validate that the NetSuite auth config has all required fields.
 * Throws ErpAuthError if any required field is missing.
 */
export function validateNetSuiteAuthConfig(
  config: Partial<NetSuiteTokenAuthConfig>
): config is NetSuiteTokenAuthConfig {
  const requiredFields: Array<keyof NetSuiteTokenAuthConfig> = [
    "accountId",
    "consumerKey",
    "consumerSecret",
    "tokenId",
    "tokenSecret",
    "baseUrl",
  ];

  const missing = requiredFields.filter((field) => !config[field]);

  if (missing.length > 0) {
    throw new ErpAuthError(
      "NETSUITE",
      `Missing required auth fields: ${missing.join(", ")}`
    );
  }

  return true;
}

/**
 * Build the base URL for NetSuite REST API calls.
 * Format: https://{accountId}.suitetalk.api.netsuite.com/services/rest/record/v1
 */
export function buildNetSuiteBaseUrl(accountId: string): string {
  const normalizedAccountId = accountId.toLowerCase().replace("_", "-");
  return `https://${normalizedAccountId}.suitetalk.api.netsuite.com/services/rest/record/v1`;
}

/**
 * Parse a NetSuite error response and return a structured error message.
 */
export function parseNetSuiteError(response: {
  status?: number;
  body?: unknown;
}): string {
  const status = response.status ?? 0;

  if (typeof response.body === "object" && response.body !== null) {
    const body = response.body as Record<string, unknown>;
    if (body["oErrorCode"]) {
      return `NetSuite error ${status}: ${body["oErrorCode"] as string} — ${body["detail"] as string}`;
    }
    if (body["title"]) {
      return `NetSuite error ${status}: ${body["title"] as string}`;
    }
  }

  return `NetSuite HTTP ${status}: ${JSON.stringify(response.body)}`;
}

// ============================================================================
// Utility functions
// ============================================================================

/**
 * Percent-encode a string per RFC 5849 Section 3.6.
 * This is stricter than standard URL encoding — it encodes characters
 * that are normally unreserved in URLs but must be encoded in OAuth.
 */
function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}
