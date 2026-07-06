// Cascada — UI Zustand Store
// Manages UI state: sidebar, theme, modals, notifications, and toasts.

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ============================================================================
// Types
// ============================================================================

type Theme = "light" | "dark" | "system";

export interface Notification {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  timestamp: number;
  duration?: number;
  isRead: boolean;
}

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastNotification {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
  durationMs: number;
  createdAt: number;
}

type ModalName =
  | "createWorkflow"
  | "approveWorkflow"
  | "rejectWorkflow"
  | "decidePackage"
  | "erpConnection"
  | "regulatorySource"
  | "ingredientDetail"
  | "productDetail"
  | "settings"
  | null;

interface UIState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  sidebarMobileOpen: boolean;
  theme: Theme;
  activeModal: ModalName;
  activeModalProps: Record<string, unknown>;
  notifications: Notification[];
  toasts: ToastNotification[];
}

interface UIActions {
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarMobileOpen: (open: boolean) => void;
  setTheme: (theme: Theme) => void;
  openModal: (modal: ModalName, props?: Record<string, unknown>) => void;
  closeModal: () => void;
  addNotification: (notification: Omit<Notification, "id" | "timestamp" | "isRead">) => string;
  removeNotification: (id: string) => void;
  markNotificationRead: (id: string) => void;
  clearNotifications: () => void;
  addToast: (toast: Omit<ToastNotification, "id" | "createdAt">) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

type UIStore = UIState & UIActions;

// ============================================================================
// Initial state
// ============================================================================

const initialState: UIState = {
  sidebarOpen: true,
  sidebarCollapsed: false,
  sidebarMobileOpen: false,
  theme: "system",
  activeModal: null,
  activeModalProps: {},
  notifications: [],
  toasts: [],
};

// ============================================================================
// Helpers
// ============================================================================

let notificationCounter = 0;
function generateNotificationId(): string {
  notificationCounter += 1;
  return `notif-${Date.now()}-${notificationCounter}`;
}

let toastCounter = 0;
function generateToastId(): string {
  toastCounter += 1;
  return `toast-${Date.now()}-${toastCounter}`;
}

// ============================================================================
// Store
// ============================================================================

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      ...initialState,

      toggleSidebar: () => {
        set((state) => ({ sidebarOpen: !state.sidebarOpen }));
      },

      setSidebarOpen: (open: boolean) => {
        set({ sidebarOpen: open });
      },

      setSidebarCollapsed: (collapsed: boolean) => {
        set({ sidebarCollapsed: collapsed });
      },

      setSidebarMobileOpen: (open: boolean) => {
        set({ sidebarMobileOpen: open });
      },

      setTheme: (theme: Theme) => {
        set({ theme });
      },

      openModal: (modal: ModalName, props: Record<string, unknown> = {}) => {
        set({ activeModal: modal, activeModalProps: props });
      },

      closeModal: () => {
        set({ activeModal: null, activeModalProps: {} });
      },

      addNotification: (notification) => {
        const id = generateNotificationId();
        const newNotification: Notification = {
          ...notification,
          id,
          timestamp: Date.now(),
          isRead: false,
        };

        set((state) => ({
          notifications: [newNotification, ...state.notifications].slice(0, 50),
        }));

        return id;
      },

      removeNotification: (id: string) => {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }));
      },

      markNotificationRead: (id: string) => {
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, isRead: true } : n
          ),
        }));
      },

      clearNotifications: () => {
        set({ notifications: [] });
      },

      addToast: (toast) => {
        const id = generateToastId();
        const createdAt = Date.now();
        set((state) => ({
          toasts: [...state.toasts, { ...toast, id, createdAt }],
        }));
      },

      removeToast: (id: string) => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      },

      clearToasts: () => {
        set({ toasts: [] });
      },
    }),
    {
      name: "cascada-ui",
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
      }),
    }
  )
);

/** @deprecated Use useUIStore instead — alias for backward compatibility */
export const useUiStore = useUIStore;
