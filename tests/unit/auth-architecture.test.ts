import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("auth architecture", () => {
  it("keeps the NextAuth catch-all route as the session owner", () => {
    const nextAuthRoute = read("src/app/api/auth/[...nextauth]/route.ts");
    const authConfig = read("src/lib/auth.ts");

    expect(nextAuthRoute).toContain('import { handlers } from "@/lib/auth"');
    expect(nextAuthRoute).toContain("export const { GET, POST } = handlers");
    expect(authConfig).toContain("trustHost: true");
  });

  it("uses custom login only as the app JSON facade around NextAuth credentials", () => {
    const loginRoute = read("src/app/api/auth/login/route.ts");

    expect(loginRoute).toContain('signIn("credentials"');
    expect(loginRoute).toContain("tenantSlug");
    expect(loginRoute).toContain("auditLog.create");
    expect(loginRoute).toContain("InvalidCredentialsError");
  });

  it("stores and verifies password hashes without the old fake bearer behavior", () => {
    const auth = read("src/lib/auth.ts");
    const apiClient = read("src/lib/api-client.ts");

    expect(auth).toContain("passwordHash");
    expect(auth).toContain("verifyPassword(password, userRecord.passwordHash)");
    expect(auth).toContain("isDevCredentialModeEnabled()");
    expect(apiClient).not.toContain("next-auth/react");
    expect(apiClient).not.toContain('"authenticated"');
  });

  it("clears Auth.js v5 and legacy NextAuth cookie names on logout", () => {
    const logoutRoute = read("src/app/api/auth/logout/route.ts");

    expect(logoutRoute).toContain("authjs.session-token");
    expect(logoutRoute).toContain("__Secure-authjs.session-token");
    expect(logoutRoute).toContain("next-auth.session-token");
    expect(logoutRoute).toContain("__Secure-next-auth.session-token");
  });

  it("uses session tenant claims for current-tenant scoping", () => {
    const tenantRoute = read("src/app/api/tenants/current/route.ts");

    expect(tenantRoute).toContain('const tenantId = sessionUser["tenantId"]');
    expect(tenantRoute).toContain("where: { id: tenantId }");
    expect(tenantRoute).not.toContain("DEFAULT_TENANT_ID");
  });
});
