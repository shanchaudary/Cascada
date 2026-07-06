import type { ReactNode } from "react";

// ============================================================================
// Auth Layout — centered card on dark gradient, no sidebar/header
// ============================================================================

interface AuthLayoutProps {
  children: ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-12">
      {/* Brand header */}
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-xl font-bold text-white shadow-lg">
          C
        </div>
        <span className="text-2xl font-bold tracking-tight text-white">
          Cascada
        </span>
      </div>

      {/* Card container */}
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800/80 p-8 shadow-2xl backdrop-blur-sm">
        {children}
      </div>

      {/* Footer */}
      <p className="mt-8 text-center text-sm text-slate-500">
        Regulatory cascade impact analysis for food manufacturers
      </p>
    </div>
  );
}
