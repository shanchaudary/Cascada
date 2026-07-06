// Cascada — Dashboard Preferences Zustand Store
// Manages dashboard filter state: time range, severity, and custom filters.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Severity } from "@prisma/client";

// ============================================================================
// Types
// ============================================================================

type TimeRange = "24h" | "7d" | "30d" | "90d" | "1y" | "all";

interface DashboardFilters {
  jurisdictions: string[];
  productCategories: string[];
  triggerTypes: string[];
  erpConnectionIds: string[];
  searchQuery: string;
}

interface DashboardState {
  selectedTimeRange: TimeRange;
  selectedSeverity: Severity | null;
  filters: DashboardFilters;
}

interface DashboardActions {
  setTimeRange: (range: TimeRange) => void;
  setSeverityFilter: (severity: Severity | null) => void;
  setJurisdictions: (jurisdictions: string[]) => void;
  setProductCategories: (categories: string[]) => void;
  setTriggerTypes: (types: string[]) => void;
  setErpConnectionIds: (ids: string[]) => void;
  setSearchQuery: (query: string) => void;
  resetFilters: () => void;
}

type DashboardStore = DashboardState & DashboardActions;

// ============================================================================
// Initial state
// ============================================================================

const defaultFilters: DashboardFilters = {
  jurisdictions: [],
  productCategories: [],
  triggerTypes: [],
  erpConnectionIds: [],
  searchQuery: "",
};

const initialState: DashboardState = {
  selectedTimeRange: "30d",
  selectedSeverity: null,
  filters: { ...defaultFilters },
};

// ============================================================================
// Store
// ============================================================================

export const useDashboardStore = create<DashboardStore>()(
  persist(
    (set) => ({
      ...initialState,

      setTimeRange: (range: TimeRange) => {
        set({ selectedTimeRange: range });
      },

      setSeverityFilter: (severity: Severity | null) => {
        set({ selectedSeverity: severity });
      },

      setJurisdictions: (jurisdictions: string[]) => {
        set((state) => ({
          filters: { ...state.filters, jurisdictions },
        }));
      },

      setProductCategories: (categories: string[]) => {
        set((state) => ({
          filters: { ...state.filters, productCategories: categories },
        }));
      },

      setTriggerTypes: (types: string[]) => {
        set((state) => ({
          filters: { ...state.filters, triggerTypes: types },
        }));
      },

      setErpConnectionIds: (ids: string[]) => {
        set((state) => ({
          filters: { ...state.filters, erpConnectionIds: ids },
        }));
      },

      setSearchQuery: (query: string) => {
        set((state) => ({
          filters: { ...state.filters, searchQuery: query },
        }));
      },

      resetFilters: () => {
        set({
          selectedTimeRange: "30d",
          selectedSeverity: null,
          filters: { ...defaultFilters },
        });
      },
    }),
    {
      name: "cascada-dashboard",
    }
  )
);
