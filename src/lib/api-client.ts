// Cascada — Type-safe API Client
// Wrapper around fetch with cookie credentials, error mapping, and generics.

import type { ApiError, ApiResponse, PaginatedResponse } from "@/types/api";

// ============================================================================
// Configuration
// ============================================================================

export function resolveBaseUrl(): string {
  if (typeof window !== "undefined") {
    const publicUrl = process.env["NEXT_PUBLIC_APP_URL"];
    return publicUrl && publicUrl.trim().length > 0 ? publicUrl : window.location.origin;
  }

  const serverUrl = process.env["NEXTAUTH_URL"];
  return serverUrl && serverUrl.trim().length > 0 ? serverUrl : "http://localhost:3000";
}

// ============================================================================
// Error types
// ============================================================================

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly context: Record<string, unknown>;
  public readonly timestamp: string;

  constructor(apiError: ApiError["error"]) {
    super(apiError.message);
    this.name = "ApiClientError";
    this.code = apiError.code;
    this.statusCode = apiError.statusCode;
    this.context = apiError.context ?? {};
    this.timestamp = apiError.timestamp;
  }
}

// ============================================================================
// Auth token resolution
// ============================================================================

async function getAuthToken(): Promise<string | null> {
  try {
    return null;
  } catch {
    // Server-side or session unavailable — cookies handle auth on API routes
    return null;
  }
}

// ============================================================================
// Request builder
// ============================================================================

interface RequestOptions {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export function buildUrl(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): string {
  const url = new URL(path, resolveBaseUrl());
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
  }
  return url.toString();
}

async function buildHeaders(custom?: Record<string, string>): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...custom,
  };

  const token = await getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return headers;
}

// ============================================================================
// Core request function
// ============================================================================

async function request<TResponse>(options: RequestOptions): Promise<TResponse> {
  const { method, path, body, params, headers: customHeaders, signal } = options;

  const url = buildUrl(path, params);
  const headers = await buildHeaders(customHeaders);

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
    credentials: "include",
  });

  // Successful responses
  if (response.ok) {
    // 204 No Content
    if (response.status === 204) {
      return undefined as TResponse;
    }

    const json = await response.json();

    // If the API wraps in ApiResponse<T>, unwrap to T
    if (json && typeof json === "object" && "data" in json && "meta" in json) {
      const wrapped = json as ApiResponse<TResponse>;
      return wrapped.data;
    }

    // If the API wraps in ApiResponse<T> without meta
    if (json && typeof json === "object" && "data" in json) {
      return (json as ApiResponse<TResponse>).data;
    }

    return json as TResponse;
  }

  // Error responses — attempt to parse structured error
  let apiError: ApiError["error"];
  try {
    const errorBody = await response.json();
    if (errorBody && typeof errorBody === "object" && "error" in errorBody) {
      apiError = (errorBody as ApiError).error;
    } else {
      apiError = {
        code: "UNKNOWN_ERROR",
        message: typeof errorBody?.message === "string" ? errorBody.message : response.statusText,
        statusCode: response.status,
        timestamp: new Date().toISOString(),
      };
    }
  } catch {
    apiError = {
      code: "NETWORK_ERROR",
      message: response.statusText || `Request failed with status ${response.status}`,
      statusCode: response.status,
      timestamp: new Date().toISOString(),
    };
  }

  throw new ApiClientError(apiError);
}

// ============================================================================
// API Client
// ============================================================================

export const apiClient = {
  /**
   * Perform a GET request.
   */
  async get<TResponse>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<TResponse> {
    return request<TResponse>({
      method: "GET",
      path,
      params,
      signal: options?.signal,
      headers: options?.headers,
    });
  },

  /**
   * Perform a POST request.
   */
  async post<TResponse, TBody = unknown>(
    path: string,
    body?: TBody,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<TResponse> {
    return request<TResponse>({
      method: "POST",
      path,
      body,
      signal: options?.signal,
      headers: options?.headers,
    });
  },

  /**
   * Perform a PATCH request.
   */
  async patch<TResponse, TBody = unknown>(
    path: string,
    body?: TBody,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<TResponse> {
    return request<TResponse>({
      method: "PATCH",
      path,
      body,
      signal: options?.signal,
      headers: options?.headers,
    });
  },

  /**
   * Perform a DELETE request.
   */
  async del<TResponse = void>(
    path: string,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<TResponse> {
    return request<TResponse>({
      method: "DELETE",
      path,
      signal: options?.signal,
      headers: options?.headers,
    });
  },
} as const;

// ============================================================================
// Typed paginated fetch helper
// ============================================================================

export async function fetchPaginated<TItem>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<PaginatedResponse<TItem>> {
  const url = buildUrl(path, params);
  const headers = await buildHeaders();

  const response = await fetch(url, {
    method: "GET",
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    let apiError: ApiError["error"];
    try {
      const errorBody = await response.json();
      apiError = errorBody?.error ?? {
        code: "UNKNOWN_ERROR",
        message: response.statusText,
        statusCode: response.status,
        timestamp: new Date().toISOString(),
      };
    } catch {
      apiError = {
        code: "NETWORK_ERROR",
        message: `Request failed with status ${response.status}`,
        statusCode: response.status,
        timestamp: new Date().toISOString(),
      };
    }
    throw new ApiClientError(apiError);
  }

  return response.json() as Promise<PaginatedResponse<TItem>>;
}
