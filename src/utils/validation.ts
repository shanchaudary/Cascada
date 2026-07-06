// Cascada — Validation Utilities
// Shared validation functions that don't belong in Zod schemas.

/**
 * Validate a CAS (Chemical Abstracts Service) registry number.
 * Format: XXXXXX-XX-X where X is a digit and the last digit is a check digit.
 */
export function isValidCasNumber(cas: string): boolean {
  const casRegex = /^\d{2,7}-\d{2}-\d$/;
  if (!casRegex.test(cas)) return false;

  // Validate check digit
  const digits = cas.replace(/-/g, "");
  const lastDigit = digits[digits.length - 1];
  if (!lastDigit) return false;
  const checkDigit = parseInt(lastDigit, 10);
  let sum = 0;
  for (let i = digits.length - 2, multiplier = 1; i >= 0; i--, multiplier++) {
    const d = digits[i];
    if (!d) continue;
    sum += parseInt(d, 10) * multiplier;
  }
  return sum % 10 === checkDigit;
}

/**
 * Validate an E-number (European food additive code).
 * Format: E followed by 3 digits, optionally followed by a Roman numeral or letter.
 */
export function isValidEnumber(eNumber: string): boolean {
  return /^E\d{3}[a-z]?$/i.test(eNumber);
}

/**
 * Validate a jurisdiction code.
 * E.g., "US", "US-CA", "EU", "UK"
 */
export function isValidJurisdiction(jurisdiction: string): boolean {
  // US federal
  if (jurisdiction === "US") return true;

  // US state codes
  if (/^US-[A-Z]{2}$/.test(jurisdiction)) {
    const validStates = new Set([
      "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
      "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
      "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
      "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
      "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
    ]);
    return validStates.has(jurisdiction.replace("US-", ""));
  }

  // International
  if (/^[A-Z]{2,3}$/.test(jurisdiction)) return true;

  // EU regions
  if (/^EU(-[A-Z]{2})?$/.test(jurisdiction)) return true;

  return false;
}

/**
 * Validate a SKU format.
 * Allows alphanumeric, hyphens, underscores. 1-50 characters.
 */
export function isValidSku(sku: string): boolean {
  return /^[A-Za-z0-9_-]{1,50}$/.test(sku);
}

/**
 * Sanitize a string for safe database text storage.
 * Removes null bytes and normalizes whitespace.
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/\0/g, "") // Remove null bytes
    .replace(/\r\n/g, "\n") // Normalize line endings
    .replace(/\u00A0/g, " ") // Non-breaking space → regular space
    .trim();
}

/**
 * Check if an object has all required keys.
 */
export function hasRequiredKeys<T extends Record<string, unknown>>(
  obj: unknown,
  keys: Array<keyof T>
): obj is T {
  if (typeof obj !== "object" || obj === null) return false;
  return keys.every((key) => key in obj);
}
