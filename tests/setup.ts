// Cascada — Test Setup
// Global setup for all test suites.

import { beforeAll, afterAll } from "vitest";

// Set test environment variables before any imports
// Use bracket notation for process.env due to strict noPropertyAccessFromIndexSignature
const env = process.env as Record<string, string>;
env["NODE_ENV"] = "test";
env["DATABASE_URL"] = "postgresql://cascada:test@localhost:5432/cascada_test";
env["DATABASE_URL_DIRECT"] = "postgresql://cascada:test@localhost:5432/cascada_test";
env["REDIS_URL"] = "redis://localhost:6379/1"; // Use DB 1 for tests
env["NEXTAUTH_SECRET"] = "test-secret-do-not-use-in-production-32ch";
env["NEXTAUTH_URL"] = "http://localhost:3000";
env["LOG_LEVEL"] = "error"; // Suppress logs during tests
env["ENCRYPTION_KEY"] = "test-encryption-key-32-characters";
env["APP_URL"] = "http://localhost:3000";

// Mock console methods to keep test output clean
// Only show errors and warnings
const originalConsole = { ...console };

beforeAll(() => {
  // Tests can override this if they need to see logs
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
});

afterAll(() => {
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.debug = originalConsole.debug;
});
