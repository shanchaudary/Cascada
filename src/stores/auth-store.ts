// Cascada — Auth Zustand Store
// Manages authentication state with localStorage persistence.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthUser } from "@/types/api";

// ============================================================================
// Types
// ============================================================================

interface TenantInfo {
  id: string;
  slug: string;
  plan: string;
  name: string;
}

interface AuthState {
  user: AuthUser | null;
  tenant: TenantInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

interface AuthActions {
  login: (user: AuthUser) => void;
  logout: () => void;
  refreshSession: (user: AuthUser) => void;
  updateProfile: (updates: Partial<Pick<AuthUser, "name" | "email">>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

type AuthStore = AuthState & AuthActions;

// ============================================================================
// Initial state
// ============================================================================

const initialState: AuthState = {
  user: null,
  tenant: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
};

// ============================================================================
// Store
// ============================================================================

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      ...initialState,

      login: (user: AuthUser) => {
        set({
          user,
          tenant: {
            id: user.tenantId,
            slug: user.tenantSlug,
            plan: user.tenantPlan,
            name: "",
          },
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      },

      logout: () => {
        set({
          ...initialState,
        });
      },

      refreshSession: (user: AuthUser) => {
        set({
          user,
          tenant: {
            id: user.tenantId,
            slug: user.tenantSlug,
            plan: user.tenantPlan,
            name: "",
          },
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      },

      updateProfile: (updates) => {
        set((state) => {
          if (!state.user) return state;
          return {
            user: {
              ...state.user,
              ...updates,
            },
          };
        });
      },

      setLoading: (isLoading: boolean) => {
        set({ isLoading });
      },

      setError: (error: string | null) => {
        set({ error, isLoading: false });
      },
    }),
    {
      name: "cascada-auth",
      partialize: (state) => ({
        user: state.user,
        tenant: state.tenant,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
