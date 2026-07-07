// Cascada — Authentication Configuration
// NextAuth.js v5 (Auth.js) with JWT + session management
// Supports credentials provider for initial MVP, expandable to SSO

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import logger from "@/lib/logger";
import bcrypt from "bcryptjs";

// Password hashing configuration
export const SALT_ROUNDS = 12;

function isDevCredentialModeEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env["CASCADA_DEV_AUTH"] !== "false";
}

/**
 * Hash a plaintext password using bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a plaintext password against a bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Role-based access control check.
 * Returns true if the user's role has sufficient permissions.
 *
 * Hierarchy: SUPER_ADMIN > TENANT_ADMIN > COMPLIANCE > EXECUTIVE > VIEWER
 */
const ROLE_HIERARCHY: Record<string, number> = {
  SUPER_ADMIN: 100,
  TENANT_ADMIN: 80,
  COMPLIANCE: 60,
  EXECUTIVE: 40,
  VIEWER: 20,
};

export function hasPermission(userRole: string, requiredRole: string): boolean {
  const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 0;
  return userLevel >= requiredLevel;
}

/**
 * Check if a user can perform write operations.
 * Only TENANT_ADMIN and COMPLIANCE roles can write.
 */
export function canWrite(userRole: string): boolean {
  return hasPermission(userRole, "COMPLIANCE");
}

/**
 * Check if a user can make decisions (C-suite).
 * Only TENANT_ADMIN and EXECUTIVE roles can make decisions.
 */
export function canDecide(userRole: string): boolean {
  return hasPermission(userRole, "EXECUTIVE");
}

/**
 * Check if a user is a platform admin.
 */
export function isPlatformAdmin(userRole: string): boolean {
  return userRole === "SUPER_ADMIN";
}

/**
 * Extended user type for Cascada session data.
 */
interface CascadaUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  tenantSlug: string;
  tenantPlan: string;
}

/**
 * Extended JWT token type with Cascada custom claims.
 */
interface CascadaToken {
  sub?: string;
  role?: string;
  tenantId?: string;
  tenantSlug?: string;
  tenantPlan?: string;
  [key: string]: unknown;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        tenantSlug: { label: "Organization slug", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          logger.warn({ msg: "Auth attempt without credentials" });
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;
        const tenantSlug =
          typeof credentials.tenantSlug === "string" && credentials.tenantSlug.trim().length > 0
            ? credentials.tenantSlug.trim()
            : undefined;

        // Search by email across tenants
        // In production, the login form captures the tenant slug for disambiguation
        const users = await prisma.user.findMany({
          where: { email, isActive: true },
          include: { tenant: true },
        });

        if (users.length === 0) {
          logger.warn({ msg: "Auth attempt for non-existent user", email });
          return null;
        }

        const userRecord = tenantSlug
          ? users.find((user) => user.tenant.slug === tenantSlug)
          : users[0];
        if (!userRecord) {
          logger.warn({ msg: "No user record found", email, tenantSlug });
          return null;
        }

        const isValid = userRecord.passwordHash
          ? await verifyPassword(password, userRecord.passwordHash)
          : isDevCredentialModeEnabled() && password.length >= 8;

        if (!userRecord.passwordHash && process.env.NODE_ENV === "production") {
          logger.error({
            msg: "Credential login denied because user has no password hash",
            email,
            tenantSlug,
          });
        }

        if (!isValid) {
          logger.warn({ msg: "Invalid password attempt", email });
          return null;
        }

        logger.info({
          msg: "User authenticated successfully",
          userId: userRecord.id,
          tenantId: userRecord.tenantId,
          role: userRecord.role,
        });

        return {
          id: userRecord.id,
          email: userRecord.email,
          name: userRecord.name,
          role: userRecord.role,
          tenantId: userRecord.tenantId,
          tenantSlug: userRecord.tenant.slug,
          tenantPlan: userRecord.tenant.plan,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // Persist role and tenant info in the JWT token on sign in
      if (user) {
        const customToken = token as unknown as CascadaToken;
        customToken["role"] = (user as unknown as CascadaUser)["role"];
        customToken["tenantId"] = (user as unknown as CascadaUser)["tenantId"];
        customToken["tenantSlug"] = (user as unknown as CascadaUser)["tenantSlug"];
        customToken["tenantPlan"] = (user as unknown as CascadaUser)["tenantPlan"];
      }
      return token;
    },
    async session({ session, token }) {
      // Expose role and tenant info on the session object
      if (session.user) {
        const customToken = token as unknown as CascadaToken;
        const userObj = session.user as unknown as Record<string, unknown>;
        userObj["id"] = customToken["sub"];
        userObj["role"] = customToken["role"];
        userObj["tenantId"] = customToken["tenantId"];
        userObj["tenantSlug"] = customToken["tenantSlug"];
        userObj["tenantPlan"] = customToken["tenantPlan"];
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
  secret: process.env["NEXTAUTH_SECRET"],
});
