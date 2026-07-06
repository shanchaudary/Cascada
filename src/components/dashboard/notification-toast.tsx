"use client";

import { useEffect, useCallback } from "react";
import type { ToastNotification, ToastVariant } from "@/stores/ui-store";
import { useUIStore } from "@/stores/ui-store";

// ============================================================================
// Variant styling
// ============================================================================
const VARIANT_STYLES: Record<ToastVariant, { container: string; icon: string }> = {
  success: {
    container:
      "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/30",
    icon: "text-green-600 dark:text-green-400",
  },
  error: {
    container:
      "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/30",
    icon: "text-red-600 dark:text-red-400",
  },
  warning: {
    container:
      "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/30",
    icon: "text-amber-600 dark:text-amber-400",
  },
  info: {
    container:
      "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/30",
    icon: "text-blue-600 dark:text-blue-400",
  },
};

// ============================================================================
// Variant icons
// ============================================================================
function ToastIcon({ variant }: { variant: ToastVariant }) {
  const iconClassName = "h-5 w-5";
  switch (variant) {
    case "success":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={iconClassName} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      );
    case "error":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={iconClassName} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
      );
    case "warning":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={iconClassName} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
        </svg>
      );
    case "info":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={iconClassName} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
        </svg>
      );
  }
}

// ============================================================================
// Single toast component
// ============================================================================
function ToastItem({ toast }: { toast: ToastNotification }) {
  const removeToast = useUIStore((s) => s.removeToast);
  const styles = VARIANT_STYLES[toast.variant];

  const handleDismiss = useCallback(() => {
    removeToast(toast.id);
  }, [removeToast, toast.id]);

  // Auto-dismiss
  useEffect(() => {
    const timer = setTimeout(() => {
      removeToast(toast.id);
    }, toast.durationMs);

    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs, removeToast]);

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-4 shadow-lg transition-all ${styles.container}`}
      role="alert"
      aria-live="assertive"
    >
      <span className={`mt-0.5 shrink-0 ${styles.icon}`}>
        <ToastIcon variant={toast.variant} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">
          {toast.title}
        </p>
        {toast.message && (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {toast.message}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-black/5 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-300"
        aria-label="Dismiss notification"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ============================================================================
// Toast container component
// ============================================================================
export function NotificationToast() {
  const toasts = useUIStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed right-4 top-4 z-50 flex w-80 flex-col gap-2"
      aria-label="Notifications"
    >
      {toasts.map((toast: ToastNotification) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

// ============================================================================
// Convenience hook for adding toasts
// ============================================================================
export function useToast() {
  const addToast = useUIStore((s) => s.addToast);

  return {
    success: (title: string, message?: string) =>
      addToast({ variant: "success", title, message, durationMs: 4000 }),
    error: (title: string, message?: string) =>
      addToast({ variant: "error", title, message, durationMs: 8000 }),
    warning: (title: string, message?: string) =>
      addToast({ variant: "warning", title, message, durationMs: 6000 }),
    info: (title: string, message?: string) =>
      addToast({ variant: "info", title, message, durationMs: 5000 }),
  };
}
