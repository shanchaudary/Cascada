import { auth, hasPermission } from "@/lib/auth";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";

export type PipelineRequiredRole = "COMPLIANCE" | "TENANT_ADMIN";

export async function requirePipelineAccess(requiredRole: PipelineRequiredRole): Promise<{
  userId: string;
  role: string;
  tenantId: string;
}> {
  const session = await auth();

  if (!session?.user) {
    throw new AuthenticationError("Authentication required");
  }

  const sessionUser = session.user as Record<string, unknown>;
  const userId = sessionUser["id"];
  const role = sessionUser["role"];
  const tenantId = sessionUser["tenantId"];

  if (typeof userId !== "string" || typeof role !== "string" || typeof tenantId !== "string") {
    throw new AuthenticationError("Session is missing required claims");
  }

  if (!hasPermission(role, requiredRole)) {
    throw new AuthorizationError("Insufficient permissions for pipeline access", {
      requiredRole,
      role,
    });
  }

  return { userId, role, tenantId };
}
