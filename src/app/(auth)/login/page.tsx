"use client";

import { useState, useCallback, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/stores/auth-store";
import { apiClient } from "@/lib/api-client";
import type { AuthUser } from "@/types/api";

// ============================================================================
// Login Page
// ============================================================================

interface LoginFormState {
  email: string;
  password: string;
  tenantSlug: string;
}

type FieldError = Partial<Record<keyof LoginFormState, string>>;

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const setLoading = useAuthStore((s) => s.setLoading);
  const setError = useAuthStore((s) => s.setError);
  const isLoading = useAuthStore((s) => s.isLoading);
  const authError = useAuthStore((s) => s.error);

  const [form, setForm] = useState<LoginFormState>({
    email: "",
    password: "",
    tenantSlug: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldError>({});

  const updateField = useCallback(
    (field: keyof LoginFormState, value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
      if (authError) setError(null);
    },
    [authError, setError]
  );

  const validate = useCallback((): boolean => {
    const errors: FieldError = {};

    if (!form.email.trim()) {
      errors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = "Enter a valid email address";
    }

    if (!form.password) {
      errors.password = "Password is required";
    } else if (form.password.length < 8) {
      errors.password = "Password must be at least 8 characters";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [form]);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      if (!validate()) return;

      setLoading(true);
      setError(null);

      try {
        const result = await apiClient.post<AuthUser, { email: string; password: string; tenantSlug?: string }>(
          "/api/auth/login",
          {
            email: form.email,
            password: form.password,
            ...(form.tenantSlug.trim() ? { tenantSlug: form.tenantSlug.trim() } : {}),
          }
        );

        login(result);
        router.push("/dashboard");
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Invalid email or password. Please try again.";
        setError(message);
      }
    },
    [validate, form, login, router, setLoading, setError]
  );

  const inputBaseClass =
    "block w-full rounded-lg border bg-slate-700/50 px-4 py-2.5 text-sm text-white placeholder-slate-400 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30";
  const inputErrorClass = "border-red-500 focus:border-red-500 focus:ring-red-500/30";
  const inputNormalClass = "border-slate-600";

  return (
    <div>
      <h1 className="mb-2 text-xl font-bold text-white">Sign in to Cascada</h1>
      <p className="mb-6 text-sm text-slate-400">
        Enter your credentials to access your dashboard
      </p>

      {/* Error display */}
      {authError && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300" role="alert">
          {authError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Email */}
        <div>
          <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-slate-300">
            Email address
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => updateField("email", e.target.value)}
            className={`${inputBaseClass} ${fieldErrors.email ? inputErrorClass : inputNormalClass}`}
            placeholder="you@company.com"
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
          />
          {fieldErrors.email && (
            <p id="login-email-error" className="mt-1 text-xs text-red-400">
              {fieldErrors.email}
            </p>
          )}
        </div>

        {/* Password */}
        <div>
          <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-slate-300">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => updateField("password", e.target.value)}
            className={`${inputBaseClass} ${fieldErrors.password ? inputErrorClass : inputNormalClass}`}
            placeholder="Enter your password"
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
          />
          {fieldErrors.password && (
            <p id="login-password-error" className="mt-1 text-xs text-red-400">
              {fieldErrors.password}
            </p>
          )}
        </div>

        {/* Tenant slug (optional) */}
        <div>
          <label htmlFor="login-tenant" className="mb-1.5 block text-sm font-medium text-slate-300">
            Organization slug <span className="text-slate-500">(optional)</span>
          </label>
          <input
            id="login-tenant"
            type="text"
            autoComplete="organization"
            value={form.tenantSlug}
            onChange={(e) => updateField("tenantSlug", e.target.value)}
            className={`${inputBaseClass} ${inputNormalClass}`}
            placeholder="your-company"
          />
          <p className="mt-1 text-xs text-slate-500">
            Leave blank if your account has only one organization
          </p>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isLoading}
          className="flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? (
            <>
              <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </button>
      </form>

      {/* Link to register */}
      <p className="mt-6 text-center text-sm text-slate-400">
        Don&apos;t have an account?{" "}
        <Link
          href="/register"
          className="font-medium text-blue-400 transition-colors hover:text-blue-300"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
