// Cascada — Prisma Client Singleton
// Prevents multiple PrismaClient instances in development (hot reload)
// Enforces tenant-scoped queries via RLS

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Sets the RLS (Row Level Security) context for the current database session.
 * Must be called before any tenant-scoped query.
 *
 * Usage in API routes:
 *   await setTenantContext(tenantId);
 *   const products = await prisma.product.findMany(); // Automatically scoped
 */
export async function setTenantContext(tenantId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `SET LOCAL app.current_tenant_id = '${tenantId}';`
  );
}

/**
 * Clears the RLS context. Call this after tenant-scoped operations
 * in long-running processes that serve multiple tenants.
 */
export async function clearTenantContext(): Promise<void> {
  await prisma.$executeRawUnsafe(`RESET app.current_tenant_id;`);
}

/**
 * Execute a query within a tenant-scoped RLS context.
 * Automatically sets and clears the context.
 *
 * Usage:
 *   const products = await withTenant('tenant_123', async () => {
 *     return prisma.product.findMany();
 *   });
 */
export async function withTenant<T>(
  tenantId: string,
  fn: () => Promise<T>
): Promise<T> {
  await setTenantContext(tenantId);
  try {
    return await fn();
  } finally {
    await clearTenantContext();
  }
}

export default prisma;
