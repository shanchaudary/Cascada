"use client";

import { useState, useCallback, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/stores/auth-store";
import { apiClient } from "@/lib/api-client";
import type { AuthUser } from "@/types/api";

// ============================================================================
// Register Page — Zod validation on client side
// ============================================================================

interface RegisterFormState {
  companyName: string;
  contactName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

type FieldError = Partial<Record<keyof RegisterFormState, string>>;

function validateForm(form: RegisterFormState): FieldError {
  const errors: FieldError = {};

  if (!form.companyName.trim()) {
    errors.companyName = "Company name is required";
  } else if (form.companyName.trim().length < 2) {
    errors.companyName = "Company name must be at least 2 characters";
  }

  if (!form.contactName.trim()) {
    errors.contactName = "Contact name is required";
  } else if (form.contactName.trim().length < 2) {
    errors.contactName = "Contact name must be at least 2 characters";
  }

  if (!form.email.trim()) {
    errors.email = "Email is required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = "Enter a valid email address";
  }

  if (!form.password) {
    errors.password = "Password is required";
  } else if (form.password.length < 8) {
    errors.password = "Password must be at least 8 characters";
  } else if (!/[A-Z]/.test(form.password)) {
    errors.password = "Password must contain at least one uppercase letter";
  } else if (!/[a-z]/.test(form.password)) {
    errors.password = "Password must contain at least one lowercase letter";
  } else if (!/[0-9]/.test(form.password)) {
    errors.password = "Password must contain at least one number";
  }

  if (!form.confirmPassword) {
    errors.confirmPassword = "Please confirm your password";
  } else if (form.password !== form.confirmPassword) {
    errors.confirmPassword = "Passwords do not match";
  }

  return errors;
}

const INITIAL_FORM: RegisterFormState = {
  companyName: "",
  contactName: "",
  email: "",
  password: "",
  confirmPassword: "",
};

export default function RegisterPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [form, setForm] = useState<RegisterFormState>(INITIAL_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldError>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = useCallback(
    (field: keyof RegisterFormState, value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
      if (submitError) setSubmitError(null);
    },
    [submitError]
  );

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      const validationErrors = validateForm(form);
      setFieldErrors(validationErrors);

      if (Object.keys(validationErrors).length > 0) return;

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        // Register
        await apiClient.post<void, {
          companyName: string;
          contactName: string;
          email: string;
          password: string;
        }>("/api/auth/register", {
          companyName: form.companyName.trim(),
          contactName: form.contactName.trim(),
          email: form.email.trim(),
          password: form.password,
        });

        // Auto-login after successful registration
        const authResult = await apiClient.post<AuthUser, {
          email: string;
          password: string;
        }>("/api/auth/login", {
          email: form.email.trim(),
          password: form.password,
        });

        login(authResult);
        router.push("/dashboard");
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Registration failed. Please try again.";
        setSubmitError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [form, login, router]
  );

  const inputBaseClass =
    "block w-full rounded-lg border bg-slate-700/50 px-4 py-2.5 text-sm text-white placeholder-slate-400 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30";
  const inputErrorClass = "border-red-500 focus:border-red-500 focus:ring-red-500/30";
  const inputNormalClass = "border-slate-600";

  const renderField = (
    id: keyof RegisterFormState,
    label: string,
    type: string = "text",
    placeholder: string = "",
    options?: { autoComplete?: string; hint?: string }
  ) => (
    <div>
      <label htmlFor={`reg-${id}`} className="mb-1.5 block text-sm font-medium text-slate-300">
        {label}
      </label>
      <input
        id={`reg-${id}`}
        type={type}
        autoComplete={options?.autoComplete}
        value={form[id]}
        onChange={(e) => updateField(id, e.target.value)}
        className={`${inputBaseClass} ${fieldErrors[id] ? inputErrorClass : inputNormalClass}`}
        placeholder={placeholder}
        aria-invalid={Boolean(fieldErrors[id])}
        aria-describedby={fieldErrors[id] ? `reg-${id}-error` : undefined}
      />
      {options?.hint && !fieldErrors[id] && (
        <p className="mt-1 text-xs text-slate-500">{options.hint}</p>
      )}
      {fieldErrors[id] && (
        <p id={`reg-${id}-error`} className="mt-1 text-xs text-red-400">
          {fieldErrors[id]}
        </p>
      )}
    </div>
  );

  return (
    <div>
      <h1 className="mb-2 text-xl font-bold text-white">Create your account</h1>
      <p className="mb-6 text-sm text-slate-400">
        Get started with Cascada regulatory impact analysis
      </p>

      {/* Error display */}
      {submitError && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300" role="alert">
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {renderField("companyName", "Company name", "text", "Acme Foods Inc.")}

        {renderField("contactName", "Full name", "text", "Jane Doe", {
          autoComplete: "name",
        })}

        {renderField("email", "Email address", "email", "you@company.com", {
          autoComplete: "email",
        })}

        {renderField("password", "Password", "password", "Create a strong password", {
          autoComplete: "new-password",
          hint: "At least 8 characters with uppercase, lowercase, and a number",
        })}

        {renderField("confirmPassword", "Confirm password", "password", "Re-enter your password", {
          autoComplete: "new-password",
        })}

        {/* Submit */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? (
            <>
              <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Creating account…
            </>
          ) : (
            "Create account"
          )}
        </button>
      </form>

      {/* Terms */}
      <p className="mt-4 text-center text-xs text-slate-500">
        By creating an account, you agree to our Terms of Service and Privacy Policy.
      </p>

      {/* Link to login */}
      <p className="mt-4 text-center text-sm text-slate-400">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-blue-400 transition-colors hover:text-blue-300"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
