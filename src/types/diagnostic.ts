// Cascada — Diagnostic Type Definitions
// Types for the paid diagnostic wedge product.

import type { Severity, DiagnosticStatus, PaymentStatus } from "@prisma/client";

// ============================================================================
// Diagnostic form types
// ============================================================================
export interface DiagnosticSubmission {
  companyName: string;
  contactEmail: string;
  contactName: string;
  productCategories: string[];
  markets: string[];
  ingredientsOfConcern: string[];
  erpSystem: string | null;
  additionalNotes: string | null;
}

// ============================================================================
// Diagnostic analysis types
// ============================================================================
export interface StateExposure {
  state: string;
  jurisdiction: string;
  activeRegulations: number;
  pendingRegulations: number;
  proposedRegulations: number;
  skusPotentiallyAffected: number;
  revenueAtRisk: number;
  topRegulations: Array<{
    name: string;
    sourceUrl: string;
    ruleType: string;
    severity: Severity;
    substancesAffected: string[];
    effectiveDate: string | null;
    complianceDate: string | null;
  }>;
}

export interface CategoryExposure {
  category: string;
  regulationsAffecting: number;
  ingredientsAtRisk: string[];
  skusAffected: number;
  estimatedReformulationCost: { min: number; max: number };
  estimatedLabelChangeCost: { min: number; max: number };
}

export interface DiagnosticAnalysis {
  companyName: string;
  analysisDate: string;
  overallRiskScore: number; // 0-1
  summary: {
    totalActiveRegulations: number;
    totalPendingRegulations: number;
    totalSkusAtRisk: number;
    totalRevenueAtRisk: number;
    estimatedComplianceCost: { min: number; max: number };
    criticalDeadlines: number;
  };
  exposureByState: StateExposure[];
  exposureByCategory: CategoryExposure[];
  ingredientRisks: Array<{
    ingredient: string;
    casNumber: string | null;
    regulationsAffecting: number;
    productCategoriesAffected: string[];
    substitutionAvailable: boolean;
    estimatedSubstitutionCost: number | null;
  }>;
  recommendations: Array<{
    priority: number;
    title: string;
    description: string;
    estimatedCost: number;
    timelineDays: number;
    impactScore: number;
  }>;
  complianceTimeline: Array<{
    date: string;
    event: string;
    jurisdiction: string;
    severity: Severity;
    actionRequired: string;
  }>;
}

// ============================================================================
// Diagnostic report types (PDF generation)
// ============================================================================
export interface DiagnosticReportData {
  diagnostic: {
    id: string;
    companyName: string;
    contactName: string;
    contactEmail: string;
    status: DiagnosticStatus;
    paymentStatus: PaymentStatus;
    amount: number;
    createdAt: string;
    completedAt: string | null;
  };
  analysis: DiagnosticAnalysis;
  generatedAt: string;
  reportVersion: string;
}

// ============================================================================
// Payment types
// ============================================================================
export interface DiagnosticPayment {
  diagnosticId: string;
  amount: number;
  stripePaymentIntentId: string;
  stripeCustomerId: string;
  status: PaymentStatus;
  createdAt: string;
}

// ============================================================================
// Pricing configuration
// ============================================================================
export const DIAGNOSTIC_PRICING = {
  BASE_PRICE: 2500, // USD
  EXPEDITED_SURCHARGE: 1000, // 3-day turnaround vs 10-day
  ADDITIONAL_STATE_FEE: 0, // All 50 states included
  CURRENCY: "usd" as const,
} as const;
