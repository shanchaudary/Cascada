"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { Plan, UserRole } from "@prisma/client";
import { Sidebar, Header, NotificationToast } from "@/components/dashboard";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useUIStore } from "@/stores/ui-store";
import type { AuthUser } from "@/types/api";

interface AuthMeResponse {
  user: AuthUser;
}

// ============================================================================
// React Query client — created once per layout mount
// ============================================================================

function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 2,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// ============================================================================
// Dashboard Layout — sidebar + header + main content
// ============================================================================

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const logout = useAuthStore((s) => s.logout);
  const refreshSession = useAuthStore((s) => s.refreshSession);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const [hasCheckedSession, setHasCheckedSession] = useState(false);

  // Hydrate client auth state from the server session before redirecting.
  useEffect(() => {
    let cancelled = false;

    async function hydrateSession() {
      if (isAuthenticated && user) {
        setHasCheckedSession(true);
        return;
      }

      try {
        const profile = await apiClient.get<AuthMeResponse>("/api/auth/me");
        if (!cancelled) {
          refreshSession(profile.user);
        }
      } catch {
        if (!cancelled) {
          logout();
          router.push("/login");
        }
      } finally {
        if (!cancelled) {
          setHasCheckedSession(true);
        }
      }
    }

    void hydrateSession();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user, refreshSession, logout, router]);

  // Handle logout
  const handleLogout = async () => {
    try {
      await apiClient.post<{ message: string }>("/api/auth/logout");
    } catch {
      // Local logout still proceeds if the server session is already absent.
    } finally {
      logout();
      router.push("/login");
    }
  };

  // Don't render dashboard chrome until authenticated
  if (!hasCheckedSession || !isAuthenticated || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" role="status" aria-label="Loading" />
      </div>
    );
  }

  const sidebarUser = {
    name: user.name,
    email: user.email,
    role: user.role as UserRole,
    plan: user.tenantPlan as Plan,
  };

  const mainMarginClass = sidebarCollapsed ? "lg:ml-[72px]" : "lg:ml-64";

  return (
    <QueryProvider>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        {/* Sidebar */}
        <Sidebar user={sidebarUser} onLogout={handleLogout} />

        {/* Main content area */}
        <div className={`flex min-h-screen flex-col transition-all duration-200 ${mainMarginClass}`}>
          {/* Header */}
          <Header
            userName={user.name}
            onSignOut={handleLogout}
          />

          {/* Page content */}
          <main className="flex-1 px-4 py-6 lg:px-8">
            {children}
          </main>
        </div>

        {/* Toast notifications */}
        <NotificationToast />
      </div>
    </QueryProvider>
  );
}
